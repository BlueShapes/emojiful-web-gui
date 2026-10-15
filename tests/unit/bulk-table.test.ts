import { describe, expect, it } from 'vitest';
import { importBulkTable } from '../../web/src/lib/bulk-table';
import { appendEntries, emptyPack, MAX_EMOJIS } from '../../web/src/lib/pack';

const blank = () => ({ name: '', url: '', category: '' });
const cat = {
  name: 'cat',
  url: 'https://example.com/cat.png',
  category: 'Animals',
};

describe('table bulk input', () => {
  it('normalizes names, skips empty rows and applies the default category', () => {
    const rows = [
      blank(),
      { name: ' :HAPPY_CAT: ', url: cat.url, category: '  ' },
      { ...cat, name: 'dog', category: ' Pets, friends ' },
      { name: ' ', url: ' ', category: ' ' },
    ];
    const original = structuredClone(rows);
    expect(importBulkTable(rows, ' Custom ')).toEqual([
      { ...cat, name: 'happy_cat', category: 'Custom' },
      { ...cat, name: 'dog', category: 'Pets, friends' },
    ]);
    expect(rows).toEqual(original);
  });

  it('rejects empty input and partially filled rows with their visible row number', () => {
    expect(() => importBulkTable([blank(), blank()], 'Custom')).toThrow(
      '取り込むデータを入力',
    );
    expect(() =>
      importBulkTable([blank(), cat, { ...blank(), category: 'Animals' }], 'Custom'),
    ).toThrow('3件目');
    expect(() =>
      importBulkTable([blank(), { ...cat, url: 'javascript:alert(1)' }], 'Custom'),
    ).toThrow('2件目');
  });

  it('rejects normalized duplicates with the original row number', () => {
    expect(() =>
      importBulkTable([cat, blank(), { ...cat, name: ':CAT:' }], 'Custom'),
    ).toThrow('3件目');
  });

  it('retains all-or-nothing validation against the existing collection', () => {
    const pack = { ...emptyPack(), emojis: [cat] };
    const entries = importBulkTable([{ ...cat, name: 'dog' }, cat], 'Custom');
    expect(() => appendEntries(pack, entries)).toThrow('重複');
    expect(pack.emojis).toEqual([cat]);
  });

  it('enforces row and pack size limits', () => {
    expect(() =>
      importBulkTable(Array.from({ length: MAX_EMOJIS + 1 }, blank), 'Custom'),
    ).toThrow('2000');
    expect(() =>
      importBulkTable(
        Array.from({ length: 800 }, (_, index) => ({
          ...cat,
          name: `cat_${index}`,
          url: 'https://example.com/'.padEnd(2048, 'a'),
        })),
        'Custom',
      ),
    ).toThrow('1.5 MiB');
  });
});
