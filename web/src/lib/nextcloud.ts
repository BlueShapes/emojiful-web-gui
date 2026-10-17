import { LocalizedError } from '../i18n';
import type { MessageKey } from '../i18n';
import {
  emptyPack,
  MAX_EMOJIS,
  MAX_IMPORT_BYTES,
  MAX_PACK_BYTES,
  nameFromUrl,
  validateEmoji,
} from './pack';
import type { EmojiEntry } from './pack';

export type NextcloudShell = 'powershell' | 'sh';

export interface NextcloudFolder {
  readonly davUrl: string;
  /** Decoded path components used to enforce the WebDAV listing scope. */
  readonly davPathSegments: readonly string[];
}

const DAV_NAMESPACE = 'DAV:';
const IMAGE_EXTENSIONS = new Set(['png', 'gif', 'jpg', 'jpeg', 'webp']);
const MAX_CURL_BYTES = 4 * 1024 * 1024;

function fail(key: MessageKey): never {
  throw new LocalizedError(key);
}

function encodeSegment(segment: string): string {
  try {
    return encodeURIComponent(segment).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    fail('nextcloud.invalidPath');
  }
}

function decodeSafeSegment(segment: string, errorKey: MessageKey): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return fail(errorKey);
  }
  if (
    decoded === '.' ||
    decoded === '..' ||
    /[\\/\u0000-\u001f\u007f-\u009f]/.test(decoded)
  ) {
    return fail(errorKey);
  }
  return decoded;
}

function readPathSegments(path: string, errorKey: MessageKey): string[] {
  if (!path.startsWith('/')) return fail(errorKey);
  let body = path.slice(1);
  if (body.endsWith('/')) body = body.slice(0, -1);
  if (!body) return [];
  const rawSegments = body.split('/');
  if (rawSegments.some((segment) => !segment)) return fail(errorKey);
  return rawSegments.map((segment) => decodeSafeSegment(segment, errorKey));
}

function readFolderInput(path: string): string[] {
  if (typeof path !== 'string' || /[\\\u0000-\u001f\u007f-\u009f]/.test(path))
    return fail('nextcloud.invalidPath');
  if (!path || path === '/') return [];

  let body = path;
  if (body.startsWith('/')) body = body.slice(1);
  if (body.endsWith('/')) body = body.slice(0, -1);
  if (!body) return fail('nextcloud.invalidPath');

  const segments = body.split('/');
  if (segments.some((segment) => !segment))
    return fail('nextcloud.invalidPath');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') fail('nextcloud.invalidPath');
  }
  return segments;
}

function rawPathFromShareUrl(value: string): string {
  const match = value.match(/^https:\/\/[^/?#]*(\/[^?#]*)?/i);
  if (!match) return fail('nextcloud.invalidUrl');
  return match[1] || '/';
}

function canonicalFolder(folder: NextcloudFolder): {
  url: URL;
  segments: string[];
} {
  let url: URL;
  try {
    url = new URL(folder.davUrl);
  } catch {
    return fail('nextcloud.invalidUrl');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/')
  ) {
    return fail('nextcloud.invalidUrl');
  }
  const segments = readPathSegments(url.pathname, 'nextcloud.invalidPath');
  if (
    segments.length !== folder.davPathSegments.length ||
    segments.some((segment, index) => segment !== folder.davPathSegments[index])
  ) {
    return fail('nextcloud.invalidPath');
  }
  const canonicalPath = `/${segments.map(encodeSegment).join('/')}/`;
  if (url.pathname !== canonicalPath) return fail('nextcloud.invalidPath');
  return { url, segments };
}

export function parseNextcloudFolder(
  shareUrl: string,
  folderPath = '',
): NextcloudFolder {
  if (
    typeof shareUrl !== 'string' ||
    !shareUrl ||
    /[\\\u0000-\u001f\u007f-\u009f\s]/.test(shareUrl)
  ) {
    return fail('nextcloud.invalidUrl');
  }

  let share: URL;
  try {
    share = new URL(shareUrl);
  } catch {
    return fail('nextcloud.invalidUrl');
  }
  if (
    share.protocol !== 'https:' ||
    !share.hostname ||
    share.username ||
    share.password ||
    share.hash
  ) {
    return fail('nextcloud.invalidUrl');
  }

  for (const [key] of share.searchParams) {
    if (/^(?:password|sharepassword|share_password|pass|pwd)$/i.test(key))
      return fail('nextcloud.invalidUrl');
  }

  const routeSegments = readPathSegments(
    rawPathFromShareUrl(shareUrl),
    'nextcloud.invalidUrl',
  );
  let token: string;
  let prefixSegments: string[];
  if (
    routeSegments.length >= 3 &&
    routeSegments[routeSegments.length - 3] === 'index.php' &&
    routeSegments[routeSegments.length - 2] === 's'
  ) {
    token = routeSegments[routeSegments.length - 1];
    prefixSegments = routeSegments.slice(0, -3);
  } else if (
    routeSegments.length >= 2 &&
    routeSegments[routeSegments.length - 2] === 's'
  ) {
    token = routeSegments[routeSegments.length - 1];
    prefixSegments = routeSegments.slice(0, -2);
  } else {
    return fail('nextcloud.invalidUrl');
  }
  if (!/^[a-z0-9]+$/i.test(token)) return fail('nextcloud.invalidUrl');

  let selectedPath = folderPath;
  if (selectedPath === '') {
    const paths = share.searchParams.getAll('path');
    if (paths.length > 1) return fail('nextcloud.invalidPath');
    selectedPath = paths[0] ?? '';
  }
  const folderSegments = readFolderInput(selectedPath);
  const davPathSegments = [
    ...prefixSegments,
    'public.php',
    'dav',
    'files',
    token,
    ...folderSegments,
  ];
  const davUrl = `${share.origin}/${davPathSegments.map(encodeSegment).join('/')}/`;
  return { davUrl, davPathSegments };
}

function shellQuote(value: string, shell: NextcloudShell): string {
  if (shell === 'powershell') return `'${value.replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildNextcloudCommand(
  folder: NextcloudFolder,
  shell: NextcloudShell,
): string {
  const { url, segments } = canonicalFolder(folder);
  if (shell !== 'powershell' && shell !== 'sh')
    return fail('nextcloud.invalidUrl');
  const davUrl = `${url.origin}/${segments.map(encodeSegment).join('/')}/`;
  const curl = shell === 'powershell' ? 'curl.exe' : 'curl';
  return [
    curl,
    '--fail',
    '--silent',
    '--show-error',
    '--globoff',
    '--max-time 30',
    `--max-filesize ${MAX_CURL_BYTES}`,
    "--proto '=https'",
    '--request PROPFIND',
    "--header 'Depth: 1'",
    "--header 'X-Requested-With: XMLHttpRequest'",
    shellQuote(davUrl, shell),
  ].join(' ');
}

export function nextcloudImageEntry(
  folder: NextcloudFolder,
  filename: string,
  index: number,
  category: string,
): EmojiEntry | null {
  const { url, segments } = canonicalFolder(folder);
  if (
    typeof filename !== 'string' ||
    !filename ||
    /[\\/\u0000-\u001f\u007f-\u009f]/.test(filename) ||
    filename === '.' ||
    filename === '..'
  ) {
    return fail('nextcloud.invalidPath');
  }
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!IMAGE_EXTENSIONS.has(extension)) return null;
  const imageUrl = `${url.origin}/${[...segments, filename]
    .map(encodeSegment)
    .join('/')}`;
  return validateEmoji({
    name: nameFromUrl(imageUrl, index),
    url: imageUrl,
    category,
  });
}

function directChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(
    (child) =>
      child.namespaceURI === DAV_NAMESPACE && child.localName === localName,
  );
}

export function disambiguateNextcloudNames(
  entries: readonly EmojiEntry[],
): EmojiEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  // Reserve every original name so a generated suffix cannot take another file's name.
  const used = new Set(counts.keys());
  return entries.map((entry) => {
    if (counts.get(entry.name) === 1) return { ...entry };
    const extension = new URL(entry.url).pathname
      .split('.')
      .pop()!
      .toLowerCase();
    let sequence = 1;
    let name: string;
    do {
      const suffix = `_${extension}${sequence === 1 ? '' : `_${sequence}`}`;
      name = entry.name.slice(0, 64 - suffix.length) + suffix;
      sequence += 1;
    } while (used.has(name));
    used.add(name);
    return { ...entry, name };
  });
}

function responseStatusCode(response: Element): number | null {
  const statuses = directChildren(response, 'status');
  if (statuses.length > 1) return fail('nextcloud.invalidXml');
  if (!statuses.length) return null;
  return parseStatus(statuses[0].textContent ?? '');
}

function parseStatus(status: string): number {
  const match = status.trim().match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/i);
  if (!match) return fail('nextcloud.invalidXml');
  return Number(match[1]);
}

function hrefLocation(
  href: string,
  folderUrl: URL,
  expectedSegments: readonly string[],
): { self: boolean; filename?: string } {
  const value = href.trim();
  if (!value || /[\\\u0000-\u001f\u007f-\u009f]/.test(value))
    return fail('nextcloud.scope');

  let rawPath: string;
  let url: URL;
  try {
    if (/^https:\/\//i.test(value)) {
      url = new URL(value);
      const match = value.match(/^https:\/\/[^/?#]*(\/[^?#]*)?/i);
      rawPath = match?.[1] || '/';
    } else {
      if (
        value.startsWith('//') ||
        /^[a-z][a-z\d+.-]*:/i.test(value) ||
        value.includes('?') ||
        value.includes('#')
      ) {
        return fail('nextcloud.scope');
      }
      rawPath = value;
      url = new URL(value, folderUrl);
    }
  } catch {
    return fail('nextcloud.scope');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== folderUrl.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return fail('nextcloud.scope');
  }

  // Check the supplied spelling before URL resolution can erase dot segments.
  const rawPathSegments = rawPath.startsWith('/')
    ? rawPath.slice(1).split('/')
    : rawPath.split('/');
  if (rawPathSegments[rawPathSegments.length - 1] === '') rawPathSegments.pop();
  if (
    rawPathSegments.some((segment) => !segment) ||
    rawPathSegments.some((segment) =>
      /[\\/\u0000-\u001f\u007f-\u009f]/.test(
        decodeSafeSegment(segment, 'nextcloud.scope'),
      ),
    )
  ) {
    return fail('nextcloud.scope');
  }
  const rawDecoded = rawPathSegments.map((segment) =>
    decodeSafeSegment(segment, 'nextcloud.scope'),
  );

  const targetSegments = readPathSegments(url.pathname, 'nextcloud.scope');
  if (
    targetSegments.length === expectedSegments.length &&
    targetSegments.every(
      (segment, index) => segment === expectedSegments[index],
    )
  ) {
    return { self: true };
  }
  if (
    targetSegments.length !== expectedSegments.length + 1 ||
    !expectedSegments.every(
      (segment, index) => targetSegments[index] === segment,
    )
  ) {
    return fail('nextcloud.scope');
  }
  const filename = rawDecoded.at(-1);
  if (!filename || targetSegments.at(-1) !== filename)
    return fail('nextcloud.scope');
  return { self: false, filename };
}

export function importNextcloudListing(
  xml: string,
  folder: NextcloudFolder,
  category: string,
): EmojiEntry[] {
  if (
    typeof xml !== 'string' ||
    new TextEncoder().encode(xml).byteLength > MAX_IMPORT_BYTES
  )
    return fail('error.inputSize');
  if (/<\s*!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    return fail('nextcloud.invalidXml');

  const source = xml.replace(/^\uFEFF/, '');
  const { url: folderUrl, segments: expectedSegments } =
    canonicalFolder(folder);
  let document: Document;
  try {
    document = new DOMParser().parseFromString(source, 'application/xml');
  } catch {
    return fail('nextcloud.invalidXml');
  }
  const root = document.documentElement;
  if (
    !root ||
    root.namespaceURI !== DAV_NAMESPACE ||
    root.localName !== 'multistatus' ||
    document.getElementsByTagName('parsererror').length > 0
  ) {
    return fail('nextcloud.invalidXml');
  }

  const responses = directChildren(root, 'response');
  if (!responses.length) return fail('nextcloud.invalidXml');
  const entries: EmojiEntry[] = [];
  for (const response of responses) {
    const hrefs = directChildren(response, 'href');
    if (hrefs.length !== 1) return fail('nextcloud.invalidXml');
    const location = hrefLocation(
      hrefs[0].textContent ?? '',
      folderUrl,
      expectedSegments,
    );
    const statusCode = responseStatusCode(response);
    if (statusCode !== null && (statusCode < 200 || statusCode >= 300))
      return fail('nextcloud.scope');

    const propstats = directChildren(response, 'propstat');
    if (!propstats.length) return fail('nextcloud.invalidXml');
    const successfulProperties: Element[] = [];
    for (const propstat of propstats) {
      const statuses = directChildren(propstat, 'status');
      const props = directChildren(propstat, 'prop');
      if (statuses.length !== 1 || props.length !== 1)
        return fail('nextcloud.invalidXml');
      const code = parseStatus(statuses[0].textContent ?? '');
      if (code >= 200 && code < 300) {
        if (!props[0].children.length) return fail('nextcloud.invalidXml');
        successfulProperties.push(props[0]);
      }
    }
    if (!successfulProperties.length) return fail('nextcloud.scope');

    // The current directory and child directories are expected in Depth: 1.
    if (location.self || !location.filename) continue;
    const isCollection = successfulProperties.some((properties) =>
      directChildren(properties, 'resourcetype').some(
        (resourceType) => directChildren(resourceType, 'collection').length > 0,
      ),
    );
    if (isCollection) continue;

    const entry = nextcloudImageEntry(
      folder,
      location.filename,
      entries.length,
      category,
    );
    if (entry) {
      entries.push(entry);
      if (entries.length > MAX_EMOJIS)
        throw new LocalizedError('error.emojiCount', {
          min: 0,
          max: MAX_EMOJIS,
        });
    }
  }

  if (!entries.length) return fail('nextcloud.noImages');
  const namedEntries = disambiguateNextcloudNames(entries);
  const normalizedPack = { ...emptyPack(), emojis: namedEntries };
  if (
    new TextEncoder().encode(JSON.stringify(normalizedPack)).byteLength >
    MAX_PACK_BYTES
  ) {
    throw new LocalizedError('error.packSize');
  }
  return namedEntries;
}
