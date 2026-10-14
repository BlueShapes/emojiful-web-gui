import Papa from 'papaparse';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { LocalizedError, localizedErrorMessage } from '../i18n';
import type { Locale, MessageKey } from '../i18n';

export const MAX_EMOJIS = 2000;
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_PACK_BYTES = 1536 * 1024;
export interface EmojiEntry {
  name: string;
  url: string;
  category: string;
}
export interface EmojiPack {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  emojis: EmojiEntry[];
}
export type BulkFormat = 'auto' | 'csv' | 'tsv' | 'json' | 'urls';

export function emptyPack(): EmojiPack {
  return {
    schemaVersion: 1,
    id: 'my_emojis',
    name: 'My Emoji Pack',
    description: '',
    emojis: [],
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new LocalizedError('error.object');
  return value as Record<string, unknown>;
}
function field(
  value: unknown,
  label: MessageKey,
  max: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string')
    throw new LocalizedError('error.fieldString', {
      field: new LocalizedError(label),
    });
  const result = value.trim();
  if (
    (!allowEmpty && !result) ||
    result.length > max ||
    /[\u0000-\u001f\u007f-\u009f]/.test(result)
  ) {
    throw new LocalizedError('error.fieldLength', {
      field: new LocalizedError(label),
      min: allowEmpty ? 0 : 1,
      max,
    });
  }
  return result;
}

export function validateEmoji(value: unknown): EmojiEntry {
  const input = object(value);
  const name = field(input.name, 'field.emojiName', 64);
  if (!/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(name))
    throw new LocalizedError('error.emojiName');
  const url = field(input.url, 'field.imageUrl', 2048);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LocalizedError('error.urlFull');
  }
  if (
    !/^https?:\/\//i.test(url) ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    /[\s\\]/.test(url) ||
    /%(?![a-f\d]{2})/i.test(url) ||
    parsed.href.length > 2048
  ) {
    throw new LocalizedError('error.urlSafe');
  }
  return {
    name,
    url: parsed.href,
    category: field(input.category, 'field.category', 80),
  };
}

export function validatePack(value: unknown, allowEmpty = false): EmojiPack {
  const input = object(value);
  if (input.schemaVersion !== 1) throw new LocalizedError('error.schema');
  const id = field(input.id, 'field.packId', 64);
  if (!/^[a-z0-9_]{1,64}$/.test(id)) throw new LocalizedError('error.packId');
  if (
    !Array.isArray(input.emojis) ||
    input.emojis.length > MAX_EMOJIS ||
    (!allowEmpty && !input.emojis.length)
  ) {
    throw new LocalizedError('error.emojiCount', {
      min: allowEmpty ? 0 : 1,
      max: MAX_EMOJIS,
    });
  }
  const names = new Set<string>();
  const emojis = input.emojis.map((entry, index) => {
    let emoji: EmojiEntry;
    try {
      emoji = validateEmoji(entry);
    } catch (error) {
      throw new LocalizedError('error.entry', {
        index: index + 1,
        detail:
          error instanceof LocalizedError
            ? error
            : new LocalizedError('error.failed'),
      });
    }
    if (names.has(emoji.name))
      throw new LocalizedError('error.duplicate', {
        index: index + 1,
        name: emoji.name,
      });
    names.add(emoji.name);
    return emoji;
  });
  const pack: EmojiPack = {
    schemaVersion: 1,
    id,
    name: field(input.name, 'field.packName', 100),
    description: field(input.description, 'field.description', 1000, true),
    emojis,
  };
  checkPackSize(pack);
  return pack;
}

function checkPackSize(pack: EmojiPack) {
  if (strToU8(JSON.stringify(pack)).length > MAX_PACK_BYTES)
    throw new LocalizedError('error.packSize');
}

// Draft metadata may be unfinished while someone is typing. Preserve it across reloads.
export function validateDraft(value: unknown): EmojiPack {
  const input = object(value);
  const valid = validatePack(
    { ...input, id: 'draft', name: 'Draft', description: '' },
    true,
  );
  for (const [key, limit] of [
    ['id', 64],
    ['name', 100],
    ['description', 1000],
  ] as const) {
    if (typeof input[key] !== 'string' || input[key].length > limit)
      throw new LocalizedError('error.draft');
  }
  const draft: EmojiPack = {
    ...valid,
    id: input.id as string,
    name: input.name as string,
    description: input.description as string,
  };
  checkPackSize(draft);
  return draft;
}

export function errorMessage(error: unknown, locale: Locale = 'ja'): string {
  return localizedErrorMessage(error, locale);
}
export function normalizeName(name: string): string {
  return name.trim().replace(/^:|:$/g, '').toLowerCase();
}
export function nameFromUrl(url: string, index: number): string {
  try {
    const filename = decodeURIComponent(
      new URL(url).pathname.split('/').pop() || '',
    );
    const name = filename
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^[-_]+|_+$/g, '')
      .slice(0, 64);
    return name || `emoji_${index + 1}`;
  } catch {
    return `emoji_${index + 1}`;
  }
}

export function importBulk(
  text: string,
  category: string,
  format: BulkFormat = 'auto',
): EmojiEntry[] {
  if (strToU8(text).length > MAX_IMPORT_BYTES)
    throw new LocalizedError('error.inputSize');
  const source = text.replace(/^\uFEFF/, '').trim();
  if (!source) throw new LocalizedError('error.inputEmpty');
  let entries: unknown[];
  if (format === 'json' || (format === 'auto' && /^[\[{]/.test(source))) {
    let json: unknown;
    try {
      json = JSON.parse(source);
    } catch {
      throw new LocalizedError('error.json');
    }
    entries = Array.isArray(json) ? json : (object(json).emojis as unknown[]);
    if (!Array.isArray(entries)) throw new LocalizedError('error.jsonArray');
    entries = entries.map((entry) => {
      const input = object(entry);
      return {
        ...input,
        name:
          typeof input.name === 'string'
            ? normalizeName(input.name)
            : input.name,
        category: input.category || category,
      };
    });
  } else if (
    format === 'urls' ||
    (format === 'auto' &&
      source
        .split(/\r?\n/)
        .every((line) => /^https?:\/\/[^\s,]+$/.test(line.trim())))
  ) {
    entries = source
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((url, index) => ({
        name: nameFromUrl(url.trim(), index),
        url: url.trim(),
        category,
      }));
  } else {
    const delimiter =
      format === 'tsv' ||
      (format === 'auto' && source.split(/\r?\n/)[0].includes('\t'))
        ? '\t'
        : ',';
    const parsed = Papa.parse<string[]>(source, {
      delimiter,
      skipEmptyLines: 'greedy',
    });
    if (parsed.errors.length) throw new LocalizedError('error.csv');
    const rows = parsed.data;
    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const nameIndex = header.findIndex((cell) =>
      ['name', '絵文字名', '画像名'].includes(cell),
    );
    const urlIndex = header.findIndex((cell) =>
      ['url', '画像url'].includes(cell),
    );
    const categoryIndex = header.findIndex((cell) =>
      ['category', 'カテゴリー'].includes(cell),
    );
    const hasHeader = nameIndex !== -1 && urlIndex !== -1;
    entries = rows.slice(hasHeader ? 1 : 0).map((row, index) => {
      if (
        hasHeader
          ? row.length !== header.length
          : row.length < 2 || row.length > 3
      )
        throw new LocalizedError('error.columns', {
          line: index + (hasHeader ? 2 : 1),
        });
      const urlFirst = !hasHeader && /^https?:\/\//i.test(row[0].trim());
      return {
        name: normalizeName(row[hasHeader ? nameIndex : urlFirst ? 1 : 0]),
        url: row[hasHeader ? urlIndex : urlFirst ? 0 : 1].trim(),
        category: (row[hasHeader ? categoryIndex : 2] || category).trim(),
      };
    });
  }
  return validatePack({ ...emptyPack(), emojis: entries }).emojis;
}

export function appendEntries(
  pack: EmojiPack,
  entries: EmojiEntry[],
): EmojiPack {
  return validatePack({ ...pack, emojis: [...pack.emojis, ...entries] });
}

export function exportPack(value: EmojiPack): Uint8Array {
  const pack = validatePack(value);
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': strToU8(
      JSON.stringify(
        {
          pack: { pack_format: 15, description: pack.description || pack.name },
        },
        null,
        2,
      ),
    ),
    'emojiful-web-gui.json': strToU8(JSON.stringify(pack, null, 2)),
  };
  for (const emoji of pack.emojis)
    files[`data/${pack.id}/recipes/${emoji.name}.json`] = strToU8(
      JSON.stringify({ type: 'emojiful:emoji_recipe', ...emoji }, null, 2),
    );
  return zipSync(files, { level: 6 });
}

export function importPackZip(bytes: Uint8Array): EmojiPack {
  if (bytes.length > MAX_IMPORT_BYTES)
    throw new LocalizedError('error.zipSize');
  let total = 0;
  let count = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (++count > MAX_EMOJIS + 100 || total > 8 * 1024 * 1024)
        throw new LocalizedError('error.zipExpanded');
      return (
        file.name === 'emojiful-web-gui.json' ||
        file.name === 'pack.mcmeta' ||
        /^data\/[a-z0-9_.-]+\/recipes\/[a-z0-9_./-]+\.json$/.test(file.name)
      );
    },
  });
  if (files['emojiful-web-gui.json'])
    return validatePack(JSON.parse(strFromU8(files['emojiful-web-gui.json'])));
  const entries: unknown[] = [];
  const namespaces = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('data/')) continue;
    const recipe = object(JSON.parse(strFromU8(content)));
    if (recipe.type !== 'emojiful:emoji_recipe') continue;
    namespaces.add(path.split('/')[1]);
    entries.push({
      name: recipe.name,
      category: recipe.category,
      url: recipe.url,
    });
  }
  let description = '';
  if (files['pack.mcmeta']) {
    const metadata = object(JSON.parse(strFromU8(files['pack.mcmeta'])));
    const info = object(metadata.pack);
    if (typeof info.description === 'string') description = info.description;
  }
  const id =
    namespaces.size === 1
      ? [...namespaces][0].replace(/[.-]/g, '_').slice(0, 64)
      : 'imported_pack';
  return validatePack({
    schemaVersion: 1,
    id,
    name: id,
    description,
    emojis: entries,
  });
}

export async function readPackFile(file: File): Promise<EmojiPack> {
  if (file.size > MAX_IMPORT_BYTES) throw new LocalizedError('error.fileSize');
  if (/\.zip$/i.test(file.name))
    return importPackZip(new Uint8Array(await file.arrayBuffer()));
  return validateDraft(JSON.parse(await file.text()));
}
