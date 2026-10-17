import { describe, expect, it } from 'vitest';
import {
  getBulkTableIssues,
  importBulkTable,
} from '../../web/src/lib/bulk-table';
import { LocalizedError } from '../../web/src/i18n';
import { appendEntries, emptyPack, MAX_EMOJIS } from '../../web/src/lib/pack';

const blank = () => ({ name: '', url: '', category: '' });
const cat = {
  name: 'cat',
  url: 'https://example.com/cat.png',
  category: 'Animals',
};

describe('table bulk input', () => {
  it('marks Japanese names as errors instead of length-only warnings', () => {
    const rows = [{ ...cat, name: '日本語を含む長い絵文字名です' }];
    const issues = getBulkTableIssues(rows, 'Custom');
    expect(issues[0]).toEqual([
      {
        field: 'name',
        error: expect.objectContaining({ key: 'error.emojiName' }),
      },
    ]);
    expect(() => importBulkTable(rows, 'Custom')).toThrow();
  });
  it('flags names at the configurable length threshold without blocking valid imports', () => {
    const rows = [
      { ...cat, name: 'a'.repeat(11) },
      { ...cat, name: 'b'.repeat(12) },
    ];
    const issues = getBulkTableIssues(rows, 'Custom');
    expect(issues[0]).toEqual([]);
    expect(issues[1]).toContainEqual({
      field: 'name',
      severity: 'warning',
      error: expect.objectContaining({
        key: 'name.longWarning',
        args: { length: 12, threshold: 12 },
      }),
    });
    expect(importBulkTable(rows, 'Custom')).toHaveLength(2);
    expect(getBulkTableIssues(rows, 'Custom', [], 13)).toEqual([[], []]);
  });
  it('reports every row participating in normalized duplicates, even with invalid URLs', () => {
    const rows = [
      { ...cat, name: ':Medetai-Nya:' },
      { ...cat, name: 'MEDETAI-NYA', url: 'not a URL' },
      { ...cat, name: 'medetai-nya' },
    ];

    const issues = getBulkTableIssues(rows, 'Custom');

    expect(
      issues.map((rowIssues) =>
        rowIssues
          .filter(({ error }) => error.key === 'error.duplicate')
          .map(({ field, error }) => [field, error.args]),
      ),
    ).toEqual([
      [['name', { index: 2, name: 'medetai-nya' }]],
      [['name', { index: 1, name: 'medetai-nya' }]],
      [['name', { index: 1, name: 'medetai-nya' }]],
    ]);
    expect(issues[1]).toContainEqual({
      field: 'url',
      error: expect.objectContaining({ key: 'error.urlFull' }),
    });
  });

  it('reports conflicts with existing names and skips blank rows', () => {
    const rows = [blank(), { ...cat, name: ' :MEDETAI-NYA: ' }, blank()];

    const issues = getBulkTableIssues(rows, 'Custom', [':medetai-nya']);

    expect(issues).toHaveLength(3);
    expect(issues[0]).toEqual([]);
    expect(issues[1]).toEqual([
      {
        field: 'name',
        error: expect.objectContaining({
          key: 'error.nameUsed',
          args: { name: 'medetai-nya' },
        }),
      },
    ]);
    expect(issues[2]).toEqual([]);
  });

  it('uses the default category and maps the first validation error to its field', () => {
    const rows = [
      { ...cat, name: 'invalid name' },
      { ...cat, name: 'bad_url', url: 'not a URL', category: '   ' },
      { ...cat, name: 'bad_category', category: 'x'.repeat(81) },
      { ...cat, name: 'uses_default', category: '  ' },
    ];

    const issues = getBulkTableIssues(rows, 'Custom');

    expect(
      issues.map((rowIssues) =>
        rowIssues
          .filter((issue) => issue.severity !== 'warning')
          .map(({ field, error }) => [field, error.key]),
      ),
    ).toEqual([
      [['name', 'error.emojiName']],
      [['url', 'error.urlFull']],
      [['category', 'error.fieldLength']],
      [],
    ]);
    const categoryError = issues[2].find(
      (issue) => issue.field === 'category',
    )!.error;
    expect(categoryError.args.field).toBeInstanceOf(LocalizedError);
    expect((categoryError.args.field as LocalizedError).key).toBe(
      'field.category',
    );
  });

  it('removes corrected-row issues and leaves the input rows unchanged', () => {
    const rows = [blank(), { ...cat, name: 'invalid name' }];
    const original = structuredClone(rows);

    expect(
      getBulkTableIssues(rows, 'Custom').map((rowIssues) =>
        rowIssues.filter((issue) => issue.severity !== 'warning'),
      ),
    ).toMatchObject([
      [],
      [{ field: 'name', error: { key: 'error.emojiName' } }],
    ]);
    expect(rows).toEqual(original);
    expect(
      getBulkTableIssues([rows[0], { ...cat, name: 'fixed_name' }], 'Custom'),
    ).toEqual([[], []]);
    expect(rows).toEqual(original);
  });

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
      importBulkTable(
        [blank(), cat, { ...blank(), category: 'Animals' }],
        'Custom',
      ),
    ).toThrow('3件目');
    expect(() =>
      importBulkTable(
        [blank(), { ...cat, url: 'javascript:alert(1)' }],
        'Custom',
      ),
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
