import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  appendEntries,
  emptyPack,
  exportPack,
  importBulk,
  importPackZip,
  validateDraft,
  validateEmoji,
  validateEmojiName,
  normalizeName,
  validatePack,
} from '../../web/src/lib/pack';

const cat = {
  name: 'happy_cat',
  url: 'https://example.com/cat.png?size=128',
  category: '動物',
};
const pack = { ...emptyPack(), emojis: [cat] };

describe('Emojiful 1.20.1 pack compatibility', () => {
  it('roundtrips a large accepted pack within import and API budgets', () => {
    const large = {
      ...pack,
      emojis: Array.from({ length: 700 }, (_, index) => ({
        ...cat,
        name: `cat_${index}`,
        url: 'https://example.com/'.padEnd(2048, 'a'),
      })),
    };
    expect(importPackZip(exportPack(large))).toEqual(large);
    expect(
      new TextEncoder().encode(
        JSON.stringify({ pack: large, overwrite: false }),
      ).length,
    ).toBeLessThan(2 * 1024 * 1024);
    const excessive = {
      ...large,
      emojis: Array.from({ length: 800 }, (_, index) => ({
        ...large.emojis[0],
        name: `cat_${index}`,
      })),
    };
    expect(() => exportPack(excessive)).toThrow('1.5 MiB');
  });
  it('imports legal Minecraft namespace and recipe paths containing dots and dashes', () => {
    const zip = zipSync({
      'data/my-emojis.v1/recipes/nested/cat.emoji.json': strToU8(
        JSON.stringify({ type: 'emojiful:emoji_recipe', ...cat }),
      ),
    });
    expect(importPackZip(zip)).toMatchObject({
      id: 'my_emojis_v1',
      emojis: [cat],
    });
  });
  it('exports standard format-15 datapack recipes without packaging remote images', () => {
    const files = unzipSync(exportPack(pack));
    expect(Object.keys(files).sort()).toEqual([
      'data/my_emojis/recipes/happy_cat.json',
      'emojiful-web-gui.json',
      'pack.mcmeta',
    ]);
    expect(JSON.parse(strFromU8(files['pack.mcmeta']))).toEqual({
      pack: { pack_format: 15, description: 'My Emoji Pack' },
    });
    expect(
      JSON.parse(strFromU8(files['data/my_emojis/recipes/happy_cat.json'])),
    ).toEqual({ type: 'emojiful:emoji_recipe', ...cat });
    expect(importPackZip(exportPack(pack))).toEqual(pack);
  });
  it('imports third-party packs with nested recipe paths and filters other recipes', () => {
    const zip = zipSync({
      'pack.mcmeta': strToU8(
        JSON.stringify({
          pack: { pack_format: 15, description: '外部パック' },
        }),
      ),
      'data/custom/recipes/animals/cat.json': strToU8(
        JSON.stringify({ type: 'emojiful:emoji_recipe', ...cat }),
      ),
      'data/custom/recipes/craft.json': strToU8(
        JSON.stringify({ type: 'minecraft:crafting_shapeless' }),
      ),
    });
    expect(importPackZip(zip)).toEqual({
      schemaVersion: 1,
      id: 'custom',
      name: 'custom',
      description: '外部パック',
      emojis: [cat],
    });
  });
  it('rejects expanded ZIPs that exceed the size bound', () => {
    const bomb = zipSync({ 'ignored.txt': new Uint8Array(9 * 1024 * 1024) });
    expect(() => importPackZip(bomb)).toThrow('展開サイズ');
  });
});

describe('all-or-nothing bulk import', () => {
  it('accepts reordered CSV headers, quotes and category fallback', () => {
    expect(
      importBulk(
        'url,category,name\nhttps://example.com/cat.png,"Animals, pets",:happy_cat:\nhttps://example.com/dog.gif,,dog',
        'Custom',
      ),
    ).toEqual([
      {
        name: 'happy_cat',
        url: 'https://example.com/cat.png',
        category: 'Animals, pets',
      },
      { name: 'dog', url: 'https://example.com/dog.gif', category: 'Custom' },
    ]);
  });
  it('accepts TSV and URL-first rows without a header', () => {
    expect(
      importBulk(
        'https://example.com/cat.png\tcat\tAnimals\nhttps://example.com/dog.png\tdog',
        'Custom',
      ),
    ).toHaveLength(2);
  });
  it('derives URL list names from filenames and supports query strings', () => {
    expect(
      importBulk(
        'https://example.com/Happy%20Cat.png?x=1\nhttps://example.com/wave.gif',
        'Custom',
      ).map((entry) => entry.name),
    ).toEqual(['happy_cat', 'wave']);
  });
  it('accepts JSON arrays and draft documents', () => {
    expect(importBulk(JSON.stringify([cat]), 'Custom')).toEqual([cat]);
    expect(importBulk(JSON.stringify(pack), 'Custom')).toEqual([cat]);
  });
  it('rejects duplicate names, malformed quoting, and invalid rows instead of skipping them', () => {
    expect(() =>
      importBulk(
        'cat,https://example.com/cat.png\ncat,https://example.com/cat2.png',
        'Custom',
      ),
    ).toThrow('重複');
    expect(() => importBulk('"unclosed,url', 'Custom')).toThrow('構文');
    expect(() =>
      importBulk('cat,https://example.com/cat.png\nbad,not-a-url', 'Custom'),
    ).toThrow('2件目');
    expect(() => importBulk('name,url,category', 'Custom')).toThrow('1〜2000');
  });
  it('rejects collisions with existing names without mutating the draft', () => {
    expect(() => appendEntries(pack, [cat])).toThrow('重複');
    expect(pack.emojis).toEqual([cat]);
  });
});

describe('validation and draft persistence', () => {
  it.each([
    'にゃん',
    'cat猫',
    'ｶﾀｶﾅ',
    'ｃａｔ',
    'café',
    'cat😺',
    'catK',
    'İcat',
    '\u3000cat\u3000',
    '\u00a0cat',
  ])(
    'rejects non-ASCII emoji name %s before and after normalization',
    (name) => {
      expect(() => validateEmojiName(name)).toThrow();
      expect(() =>
        validateEmoji({ ...cat, name: normalizeName(name) }),
      ).toThrow();
      expect(() =>
        importBulk(`${name},https://example.com/cat.png`, '動物'),
      ).toThrow();
      expect(() =>
        exportPack({ ...pack, emojis: [{ ...cat, name }] }),
      ).toThrow();
    },
  );
  it('retains supported ASCII punctuation and allows Japanese categories and image URLs', () => {
    expect(
      validateEmoji({
        ...cat,
        name: normalizeName(' :CAT_2-NYA: '),
        url: 'https://example.com/猫.png',
        category: '日本語のカテゴリー',
      }),
    ).toMatchObject({ name: 'cat_2-nya', category: '日本語のカテゴリー' });
  });
  it('rejects control characters and malformed percent escapes accepted by browser URL parsing', () => {
    expect(() => validateEmoji({ ...cat, category: 'a\u0085b' })).toThrow();
    expect(() =>
      validateEmoji({ ...cat, url: 'https://example.com/%zz.png' }),
    ).toThrow();
  });
  it.each(['../outside', 'UPPER', 'bad:name', '-cat'])(
    'rejects unsafe recipe name %s',
    (name) => {
      expect(() => validateEmoji({ ...cat, name })).toThrow();
    },
  );
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com/x',
    'https://example.com/a b',
    'data:image/png;base64,AA',
    'http:example.com',
    'https://example.com/a\\b',
  ])('rejects URL %s', (url) => {
    expect(() => validateEmoji({ ...cat, url })).toThrow();
  });
  it('canonicalizes international hostnames and paths for Java URL compatibility', () => {
    expect(validateEmoji({ ...cat, url: 'https://例え.jp/猫.png' }).url).toBe(
      'https://xn--r8jz45g.jp/%E7%8C%AB.png',
    );
  });
  it('rejects namespace traversal, empty exports and too many entries', () => {
    expect(() => exportPack({ ...pack, id: '../evil' })).toThrow('パックID');
    expect(() => exportPack(emptyPack())).toThrow('1〜2000');
    expect(() =>
      validatePack({ ...pack, emojis: Array(2001).fill(cat) }),
    ).toThrow('1〜2000');
  });
  it('preserves unfinished metadata and empty collections as drafts', () => {
    const draft = { ...emptyPack(), id: 'unfinished-', name: '' };
    expect(validateDraft(draft)).toEqual(draft);
    expect(() => exportPack(draft)).toThrow();
  });
});
