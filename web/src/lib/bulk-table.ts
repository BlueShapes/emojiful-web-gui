import { LocalizedError } from '../i18n';
import {
  emptyPack,
  MAX_EMOJIS,
  normalizeName,
  validateRegistrationEmoji,
  validateRegistrationPack,
} from './pack';
import type { EmojiEntry } from './pack';
import {
  DEFAULT_NAME_WARNING_LENGTH,
  getNameLengthWarning,
} from './name-tools';

export interface BulkTableIssue {
  field: keyof EmojiEntry;
  error: LocalizedError;
  severity?: 'warning';
}

function fieldForError(error: LocalizedError): keyof EmojiEntry {
  switch (error.key) {
    case 'error.emojiName':
    case 'error.builtinEmoji':
      return 'name';
    case 'error.urlFull':
    case 'error.urlSafe':
      return 'url';
    case 'error.fieldLength':
    case 'error.fieldString': {
      const field = error.args.field;
      if (field instanceof LocalizedError) {
        switch (field.key) {
          case 'field.emojiName':
            return 'name';
          case 'field.imageUrl':
            return 'url';
          case 'field.category':
            return 'category';
        }
      }
      break;
    }
  }
  return 'name';
}

export function getBulkTableIssues(
  rows: readonly EmojiEntry[],
  defaultCategory: string,
  existingNames: readonly string[] = [],
  warningThreshold = DEFAULT_NAME_WARNING_LENGTH,
): BulkTableIssue[][] {
  const issues = rows.map(() => [] as BulkTableIssue[]);
  const participatingRows = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) => row.name.trim() || row.url.trim() || row.category.trim(),
    );
  const normalizedExistingNames = new Set(existingNames.map(normalizeName));
  const rowsByName = new Map<string, number[]>();

  for (const { row, index } of participatingRows) {
    const name = normalizeName(row.name);
    if (!name) continue;
    const indices = rowsByName.get(name) ?? [];
    indices.push(index);
    rowsByName.set(name, indices);
  }

  for (const [name, indices] of rowsByName) {
    if (normalizedExistingNames.has(name)) {
      for (const index of indices) {
        issues[index].push({
          field: 'name',
          error: new LocalizedError('error.nameUsed', { name }),
        });
      }
    }
    if (indices.length > 1) {
      const firstIndex = indices[0];
      const nextIndex = indices[1];
      for (const index of indices) {
        issues[index].push({
          field: 'name',
          error: new LocalizedError('error.duplicate', {
            index: index === firstIndex ? nextIndex + 1 : firstIndex + 1,
            name,
          }),
        });
      }
    }
  }

  for (const { row, index } of participatingRows) {
    let invalidName = false;
    try {
      validateRegistrationEmoji({
        name: normalizeName(row.name),
        url: row.url,
        category: row.category.trim() || defaultCategory,
      });
    } catch (error) {
      const validationError =
        error instanceof LocalizedError
          ? error
          : new LocalizedError('error.failed');
      const field = fieldForError(validationError);
      invalidName = field === 'name';
      issues[index].push({
        field,
        error: validationError,
      });
    }
    const warning = invalidName
      ? null
      : getNameLengthWarning(row.name, warningThreshold);
    if (warning)
      issues[index].push({
        field: 'name',
        severity: 'warning',
        error: new LocalizedError('name.longWarning', warning),
      });
  }

  return issues;
}

export function importBulkTable(
  rows: readonly EmojiEntry[],
  defaultCategory: string,
): EmojiEntry[] {
  if (rows.length > MAX_EMOJIS)
    throw new LocalizedError('error.emojiCount', { min: 1, max: MAX_EMOJIS });

  const entries: EmojiEntry[] = [];
  const names = new Set<string>();
  rows.forEach((row, index) => {
    if (!row.name.trim() && !row.url.trim() && !row.category.trim()) return;
    let entry: EmojiEntry;
    try {
      entry = validateRegistrationEmoji({
        name: normalizeName(row.name),
        url: row.url,
        category: row.category.trim() || defaultCategory,
      });
    } catch (error) {
      // Keep the visible row number even when earlier blank rows are skipped.
      throw new LocalizedError('error.entry', {
        index: index + 1,
        detail:
          error instanceof LocalizedError
            ? error
            : new LocalizedError('error.failed'),
      });
    }
    if (names.has(entry.name))
      throw new LocalizedError('error.duplicate', {
        index: index + 1,
        name: entry.name,
      });
    names.add(entry.name);
    entries.push(entry);
  });
  if (!entries.length) throw new LocalizedError('error.inputEmpty');
  return validateRegistrationPack({ ...emptyPack(), emojis: entries }).emojis;
}
