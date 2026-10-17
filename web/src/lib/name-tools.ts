import { MAX_EMOJIS, normalizeName, validateEmojiName } from './pack';

export const DEFAULT_NAME_WARNING_LENGTH = 12;

export function getNameLengthWarning(
  name: string,
  threshold = DEFAULT_NAME_WARNING_LENGTH,
): { length: number; threshold: number } | null {
  const normalizedThreshold =
    Number.isInteger(threshold) && threshold >= 1 && threshold <= 64
      ? threshold
      : DEFAULT_NAME_WARNING_LENGTH;
  const length = Array.from(normalizeName(name)).length;
  return length >= normalizedThreshold
    ? { length, threshold: normalizedThreshold }
    : null;
}

export type NameReplacementMode = 'literal' | 'regex';

export interface NameReplacementRequest {
  names: readonly string[];
  search: string;
  replacement: string;
  mode: NameReplacementMode;
  existingNames?: readonly string[];
}

export type NameReplacementProblemKind = 'invalid' | 'duplicate' | 'existing';

export interface NameReplacementPreview {
  names: string[];
  changes: { index: number; before: string; after: string }[];
  problems: { index: number; kind: NameReplacementProblemKind }[];
}

export type NameReplacementErrorCode =
  'emptySearch' | 'invalidPattern' | 'invalidMode' | 'tooLarge';

export class NameReplacementError extends Error {
  constructor(readonly code: NameReplacementErrorCode) {
    super(code);
    this.name = 'NameReplacementError';
  }
}

const MAX_SEARCH_LENGTH = 256;
const MAX_REPLACEMENT_LENGTH = 256;
const MAX_RESULT_LENGTH = 4096;

export function previewNameReplacement(
  request: NameReplacementRequest,
): NameReplacementPreview {
  if (request.mode !== 'literal' && request.mode !== 'regex')
    throw new NameReplacementError('invalidMode');
  if (request.search === '') throw new NameReplacementError('emptySearch');
  if (
    !Array.isArray(request.names) ||
    request.names.length > MAX_EMOJIS ||
    typeof request.search !== 'string' ||
    request.search.length > MAX_SEARCH_LENGTH ||
    typeof request.replacement !== 'string' ||
    request.replacement.length > MAX_REPLACEMENT_LENGTH ||
    request.names.some((name) => typeof name !== 'string') ||
    (request.existingNames !== undefined &&
      (!Array.isArray(request.existingNames) ||
        request.existingNames.some((name) => typeof name !== 'string')))
  ) {
    throw new NameReplacementError('tooLarge');
  }

  let pattern: RegExp | undefined;
  if (request.mode === 'regex') {
    try {
      pattern = new RegExp(request.search, 'g');
    } catch {
      throw new NameReplacementError('invalidPattern');
    }
  }

  const names = [...request.names];
  const changes: NameReplacementPreview['changes'] = [];
  const problemsByIndex = names.map(
    () => new Set<NameReplacementProblemKind>(),
  );

  for (let index = 0; index < names.length; index += 1) {
    const before = names[index];
    if (before === '') continue;

    const replaced =
      request.mode === 'literal'
        ? before.split(request.search).join(request.replacement)
        : before.replace(pattern!, request.replacement);
    if (replaced.length > MAX_RESULT_LENGTH)
      throw new NameReplacementError('tooLarge');

    if (replaced !== before) {
      const after = normalizeName(replaced);
      if (after.length > MAX_RESULT_LENGTH)
        throw new NameReplacementError('tooLarge');
      names[index] = after;
      changes.push({ index, before, after });

      try {
        validateEmojiName(after);
      } catch {
        problemsByIndex[index].add('invalid');
      }
    } else if (before.length > MAX_RESULT_LENGTH) {
      throw new NameReplacementError('tooLarge');
    }
  }

  const participants = new Map<string, number[]>();
  for (let index = 0; index < request.names.length; index += 1) {
    if (request.names[index] === '') continue;
    const normalized = normalizeName(names[index]);
    if (!normalized) continue;
    const rows = participants.get(normalized) ?? [];
    rows.push(index);
    participants.set(normalized, rows);
  }
  for (const rows of participants.values()) {
    if (rows.length > 1) {
      for (const index of rows) problemsByIndex[index].add('duplicate');
    }
  }

  const existingNames = new Set(
    (request.existingNames ?? [])
      .map(normalizeName)
      .filter((name) => name !== ''),
  );
  if (existingNames.size) {
    for (let index = 0; index < request.names.length; index += 1) {
      if (request.names[index] === '') continue;
      if (existingNames.has(normalizeName(names[index])))
        problemsByIndex[index].add('existing');
    }
  }

  const problemOrder: NameReplacementProblemKind[] = [
    'invalid',
    'duplicate',
    'existing',
  ];
  const problems = problemsByIndex.flatMap((kinds, index) =>
    problemOrder
      .filter((kind) => kinds.has(kind))
      .map((kind) => ({ index, kind })),
  );

  return { names, changes, problems };
}
