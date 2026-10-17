import type { EmojiEntry } from './pack';
import { normalizeName } from './pack';
import { isBuiltinEmojiName } from './builtin-emojis';
import {
  DEFAULT_NAME_WARNING_LENGTH,
  getNameLengthWarning,
} from './name-tools';

export const COLLECTION_VIEWS = ['cards', 'list', 'compact'] as const;
export const COLLECTION_SORTS = [
  'added-asc',
  'added-desc',
  'name-asc',
  'name-desc',
  'category-asc',
  'category-desc',
  'length-asc',
  'length-desc',
  'attention',
] as const;

export type CollectionView = (typeof COLLECTION_VIEWS)[number];
export type CollectionSort = (typeof COLLECTION_SORTS)[number];
export interface CollectionPreferences {
  view: CollectionView;
  sort: CollectionSort;
}

export const COLLECTION_PREFERENCES_KEY =
  'emojiful.pack-studio.collection-preferences';
export const DEFAULT_COLLECTION_PREFERENCES: CollectionPreferences = {
  view: 'cards',
  sort: 'added-asc',
};

export function parseCollectionPreferences(
  raw: string | null,
): CollectionPreferences {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? 'null');
  } catch {
    return { ...DEFAULT_COLLECTION_PREFERENCES };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ...DEFAULT_COLLECTION_PREFERENCES };
  const input = value as Record<string, unknown>;
  return {
    view:
      COLLECTION_VIEWS.find((view) => view === input.view) ??
      DEFAULT_COLLECTION_PREFERENCES.view,
    sort:
      COLLECTION_SORTS.find((sort) => sort === input.sort) ??
      DEFAULT_COLLECTION_PREFERENCES.sort,
  };
}

// Sort a display copy: workspace persistence and exports retain insertion order.
export function sortCollectionEmojis(
  entries: readonly EmojiEntry[],
  sort: CollectionSort,
  locale: string,
  warningThreshold = DEFAULT_NAME_WARNING_LENGTH,
): EmojiEntry[] {
  if (sort === 'added-asc') return [...entries];
  if (sort === 'added-desc') return [...entries].reverse();
  if (sort === 'attention') {
    return entries
      .map((entry, index) => ({
        entry,
        index,
        priority: isBuiltinEmojiName(entry.name)
          ? 0
          : getNameLengthWarning(entry.name, warningThreshold)
            ? 1
            : 2,
      }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .map(({ entry }) => entry);
  }

  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  });
  const direction = sort.endsWith('-desc') ? -1 : 1;
  return [...entries].sort((a, b) => {
    switch (sort) {
      case 'name-asc':
      case 'name-desc':
        return direction * collator.compare(a.name, b.name);
      case 'category-asc':
      case 'category-desc':
        return (
          direction * collator.compare(a.category, b.category) ||
          collator.compare(a.name, b.name)
        );
      case 'length-asc':
      case 'length-desc':
        return (
          direction *
            (Array.from(normalizeName(a.name)).length -
              Array.from(normalizeName(b.name)).length) ||
          collator.compare(a.name, b.name)
        );
      default:
        return 0;
    }
  });
}
