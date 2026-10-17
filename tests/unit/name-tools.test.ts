import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAME_WARNING_LENGTH,
  getNameLengthWarning,
  NameReplacementError,
  previewNameReplacement,
} from '../../web/src/lib/name-tools';
import { validateEmojiName } from '../../web/src/lib/pack';

describe('emoji name length warnings', () => {
  it('uses twelve as the default threshold and warns at the boundary', () => {
    expect(DEFAULT_NAME_WARNING_LENGTH).toBe(12);
    expect(getNameLengthWarning('abcdefghijk')).toBeNull();
    expect(getNameLengthWarning('abcdefghijkl')).toEqual({
      length: 12,
      threshold: 12,
    });
  });

  it('normalizes colons and case before counting Unicode code points', () => {
    expect(getNameLengthWarning(':ＡＢＣＤＥＦＧＨＩＪＫＬ:')).toEqual({
      length: 12,
      threshold: 12,
    });
    expect(getNameLengthWarning(':ÄBCDEFGHIJK:')).toBeNull();
  });

  it('accepts a custom integer threshold and falls back for invalid thresholds', () => {
    expect(getNameLengthWarning('abc', 3)).toEqual({
      length: 3,
      threshold: 3,
    });
    expect(getNameLengthWarning('abc', 4)).toBeNull();
    expect(getNameLengthWarning('abcdefghijkl', 0)).toEqual({
      length: 12,
      threshold: 12,
    });
    expect(getNameLengthWarning('abcdefghijkl', 65)).toEqual({
      length: 12,
      threshold: 12,
    });
    expect(getNameLengthWarning('abcdefghijkl', 1.5)).toEqual({
      length: 12,
      threshold: 12,
    });
  });
});

describe('emoji name validation', () => {
  it('extracts the trimmed name field and safe-name validation', () => {
    expect(validateEmojiName(' happy_cat ')).toBe('happy_cat');
    expect(() => validateEmojiName('UPPER')).toThrow();
    expect(() => validateEmojiName('bad:name')).toThrow();
    expect(() => validateEmojiName('')).toThrow();
    expect(() => validateEmojiName('a'.repeat(65))).toThrow();
  });
});

describe('name replacement preview', () => {
  it('replaces every literal match and treats replacement tokens as literal text', () => {
    const preview = previewNameReplacement({
      names: ['cat_cat', 'dog_cat'],
      search: 'cat',
      replacement: '$1',
      mode: 'literal',
    });

    expect(preview.names).toEqual(['$1_$1', 'dog_$1']);
    expect(preview.changes).toEqual([
      { index: 0, before: 'cat_cat', after: '$1_$1' },
      { index: 1, before: 'dog_cat', after: 'dog_$1' },
    ]);
    expect(preview.problems.map(({ index, kind }) => [index, kind])).toEqual([
      [0, 'invalid'],
      [1, 'invalid'],
    ]);
  });

  it('supports regex capture replacement and global anchors', () => {
    expect(
      previewNameReplacement({
        names: ['happy_cat', 'happy_dog', 'not_happy_cat'],
        search: '^(happy)_(cat|dog)$',
        replacement: '$2-$1',
        mode: 'regex',
      }).names,
    ).toEqual(['cat-happy', 'dog-happy', 'not_happy_cat']);
  });

  it('supports zero-width global matches', () => {
    const preview = previewNameReplacement({
      names: ['ab'],
      search: '(?=b)',
      replacement: 'x',
      mode: 'regex',
    });

    expect(preview.names).toEqual(['axb']);
    expect(preview.changes).toEqual([{ index: 0, before: 'ab', after: 'axb' }]);
  });

  it('rejects empty searches, invalid patterns, and unsupported modes with stable codes', () => {
    const expectCode = (run: () => unknown, code: string) => {
      try {
        run();
        throw new Error('Expected replacement preview to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(NameReplacementError);
        expect((error as NameReplacementError).code).toBe(code);
      }
    };

    expectCode(
      () =>
        previewNameReplacement({
          names: ['cat'],
          search: '',
          replacement: 'dog',
          mode: 'literal',
        }),
      'emptySearch',
    );
    expectCode(
      () =>
        previewNameReplacement({
          names: ['cat'],
          search: '[',
          replacement: 'dog',
          mode: 'regex',
        }),
      'invalidPattern',
    );
    expectCode(
      () =>
        previewNameReplacement({
          names: ['cat'],
          search: 'cat',
          replacement: 'dog',
          mode: 'other' as 'literal',
        }),
      'invalidMode',
    );
  });

  it('reports duplicates on every participant including the first row', () => {
    const preview = previewNameReplacement({
      names: ['foo', ':bar:'],
      search: 'bar',
      replacement: 'FOO',
      mode: 'literal',
    });

    expect(preview.names).toEqual(['foo', 'foo']);
    expect(preview.problems).toEqual([
      { index: 0, kind: 'duplicate' },
      { index: 1, kind: 'duplicate' },
    ]);
  });

  it('detects collisions with existing names after normalization', () => {
    const preview = previewNameReplacement({
      names: ['old'],
      search: 'old',
      replacement: ':ALREADY_USED:',
      mode: 'literal',
      existingNames: ['already_used'],
    });

    expect(preview.names).toEqual(['already_used']);
    expect(preview.problems).toEqual([{ index: 0, kind: 'existing' }]);
  });

  it('reports invalid names and empty replacement results', () => {
    const invalid = previewNameReplacement({
      names: ['good', 'remove_me'],
      search: 'good|remove_me',
      replacement: '',
      mode: 'regex',
    });

    expect(invalid.names).toEqual(['', '']);
    expect(invalid.problems).toEqual([
      { index: 0, kind: 'invalid' },
      { index: 1, kind: 'invalid' },
    ]);
  });

  it('normalizes only changed replacements and skips empty table rows', () => {
    const preview = previewNameReplacement({
      names: ['', ':OLD:', ':Keep:'],
      search: 'OLD',
      replacement: 'New',
      mode: 'literal',
    });

    expect(preview.names).toEqual(['', 'new', ':Keep:']);
    expect(preview.changes).toEqual([
      { index: 1, before: ':OLD:', after: 'new' },
    ]);
    expect(preview.problems).toEqual([]);
  });

  it('leaves unchanged invalid names alone', () => {
    const preview = previewNameReplacement({
      names: ['Bad Name', 'good'],
      search: 'missing',
      replacement: 'replacement',
      mode: 'literal',
    });

    expect(preview.names).toEqual(['Bad Name', 'good']);
    expect(preview.changes).toEqual([]);
    expect(preview.problems).toEqual([]);
  });

  it('does not mutate request arrays or names', () => {
    const names = ['old', ':UNCHANGED:'];
    const existingNames = ['taken'];
    const request = {
      names,
      search: 'old',
      replacement: 'new',
      mode: 'literal' as const,
      existingNames,
    };
    const beforeNames = [...names];
    const beforeExistingNames = [...existingNames];

    previewNameReplacement(request);

    expect(names).toEqual(beforeNames);
    expect(existingNames).toEqual(beforeExistingNames);
  });

  it('guards row count, search and replacement sizes, and result size', () => {
    const base = {
      names: ['a'],
      search: 'a',
      replacement: 'b',
      mode: 'literal' as const,
    };
    const expectTooLarge = (request: typeof base) => {
      try {
        previewNameReplacement(request);
        throw new Error('Expected replacement preview to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(NameReplacementError);
        expect((error as NameReplacementError).code).toBe('tooLarge');
      }
    };

    expectTooLarge({ ...base, names: Array(2001).fill('a') });
    expectTooLarge({ ...base, search: 'a'.repeat(257) });
    expectTooLarge({ ...base, replacement: 'b'.repeat(257) });
    expectTooLarge({
      ...base,
      names: ['a'.repeat(20)],
      replacement: 'b'.repeat(256),
    });
  });
});
