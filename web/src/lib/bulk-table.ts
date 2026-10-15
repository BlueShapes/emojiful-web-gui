import { LocalizedError } from '../i18n';
import {
  emptyPack,
  MAX_EMOJIS,
  normalizeName,
  validateEmoji,
  validatePack,
} from './pack';
import type { EmojiEntry } from './pack';

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
      entry = validateEmoji({
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
  return validatePack({ ...emptyPack(), emojis: entries }).emojis;
}
