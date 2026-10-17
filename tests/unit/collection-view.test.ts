import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLLECTION_PREFERENCES,
  parseCollectionPreferences,
  sortCollectionEmojis,
} from '../../web/src/lib/collection-view';
import type { CollectionSort } from '../../web/src/lib/collection-view';

const entries = [
  { name: 'u10', category: 'Z' },
  { name: 'u2', category: 'A' },
  { name: 'b99', category: 'A' },
  { name: 'a', category: 'A' },
].map((entry) => ({ ...entry, url: `https://example.com/${entry.name}.png` }));

describe('collection display preferences', () => {
  it.each([null, '', '{broken', 'null', 'false', '42', '[]', '"compact"'])(
    'uses the existing card layout and insertion order for invalid saved preferences: %s',
    (raw) =>
      expect(parseCollectionPreferences(raw)).toEqual({
        view: 'cards',
        sort: 'added-asc',
      }),
  );

  it('restores known values independently and does not carry unrecognized data', () => {
    expect(
      parseCollectionPreferences(
        '{"view":"compact","sort":"name-desc","other":true}',
      ),
    ).toEqual({ view: 'compact', sort: 'name-desc' });
    expect(
      parseCollectionPreferences('{"view":"invalid","sort":"length-desc"}'),
    ).toEqual({ view: 'cards', sort: 'length-desc' });
    expect(parseCollectionPreferences('{"view":"list","sort":5}')).toEqual({
      view: 'list',
      sort: 'added-asc',
    });
    expect(parseCollectionPreferences('{"view":"list"}')).toEqual({
      view: 'list',
      sort: 'added-asc',
    });
    expect(
      parseCollectionPreferences('{"view":"toString","sort":"__proto__"}'),
    ).toEqual(DEFAULT_COLLECTION_PREFERENCES);
  });
});

describe('collection sorting', () => {
  it.each<[CollectionSort, string[]]>([
    ['added-asc', ['u10', 'u2', 'b99', 'a']],
    ['added-desc', ['a', 'b99', 'u2', 'u10']],
    ['name-asc', ['a', 'b99', 'u2', 'u10']],
    ['name-desc', ['u10', 'u2', 'b99', 'a']],
    ['category-asc', ['a', 'b99', 'u2', 'u10']],
    ['category-desc', ['u10', 'a', 'b99', 'u2']],
    ['length-asc', ['a', 'u2', 'b99', 'u10']],
    ['length-desc', ['b99', 'u10', 'u2', 'a']],
    ['attention', ['u10', 'u2', 'b99', 'a']],
  ])(
    'sorts %s without changing the stored insertion order',
    (sort, expected) => {
      const frozen = Object.freeze(
        entries.map((entry) => Object.freeze({ ...entry })),
      );
      expect(
        sortCollectionEmojis(frozen, sort, 'en').map((entry) => entry.name),
      ).toEqual(expected);
      expect(frozen.map((entry) => entry.name)).toEqual([
        'u10',
        'u2',
        'b99',
        'a',
      ]);
    },
  );

  it('keeps both natural-number ties in the original order', () => {
    const input = [entries[0], { ...entries[1], name: 'u02' }, entries[1]];
    expect(
      sortCollectionEmojis(input, 'name-asc', 'en').map((entry) => entry.name),
    ).toEqual(['u02', 'u2', 'u10']);
  });

  it('uses the selected language for category order and keeps names ascending within each category', () => {
    const input = [
      { ...entries[0], category: 'か' },
      { ...entries[1], category: 'あ' },
      { ...entries[2], category: 'あ' },
    ];
    expect(
      sortCollectionEmojis(input, 'category-asc', 'ja').map(
        (entry) => entry.name,
      ),
    ).toEqual(['b99', 'u2', 'u10']);
    expect(
      sortCollectionEmojis(input, 'category-desc', 'ja').map(
        (entry) => entry.name,
      ),
    ).toEqual(['u10', 'b99', 'u2']);
  });

  it('prioritizes errors, then length warnings using the current threshold, with stable order inside each group', () => {
    const input = [
      entries[0],
      { ...entries[1], name: 'very_long_custom_name' },
      { ...entries[2], name: 'cat' },
      { ...entries[3], name: 'smile' },
      { ...entries[0], name: 'a2' },
    ];
    expect(
      sortCollectionEmojis(input, 'attention', 'ja', 12).map(
        (entry) => entry.name,
      ),
    ).toEqual(['cat', 'smile', 'very_long_custom_name', 'u10', 'a2']);
    expect(
      sortCollectionEmojis(input, 'attention', 'ja', 24).map(
        (entry) => entry.name,
      ),
    ).toEqual(['cat', 'smile', 'u10', 'very_long_custom_name', 'a2']);
    expect(
      sortCollectionEmojis(input, 'attention', 'ja', 3).map(
        (entry) => entry.name,
      ),
    ).toEqual(['cat', 'smile', 'u10', 'very_long_custom_name', 'a2']);
  });
});
