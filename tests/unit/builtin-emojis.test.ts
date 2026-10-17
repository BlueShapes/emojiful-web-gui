import { describe, expect, it } from 'vitest';
import names from '../../web/src/data/builtin-emoji-names.json';
import { isBuiltinEmojiName } from '../../web/src/lib/builtin-emojis';

describe('Emojiful built-in name catalog', () => {
  it('contains a stable sorted snapshot without duplicate aliases or colon wrappers', () => {
    expect(names).toHaveLength(2082);
    expect(names).toEqual([...new Set(names)].sort());
    expect(
      names.every(
        (name) => name && name === name.toLowerCase() && !name.includes(':'),
      ),
    ).toBe(true);
  });

  it.each([
    'smile',
    'satisfied',
    'face_with_symbols_on_mouth',
    'swear',
    'thonk',
    'blobcatthinkOwO',
    'monka',
    'comfy',
    'kappa',
  ])(
    'recognizes built-in names and every alias case-insensitively: %s',
    (name) => {
      expect(isBuiltinEmojiName(name)).toBe(true);
      expect(isBuiltinEmojiName(` :${name.toUpperCase()}: `)).toBe(true);
    },
  );

  it.each([
    'my_smile',
    'smile_custom',
    'face-with-symbols-on-mouth',
    'my_blobcat',
    '__proto__',
    '',
    'ſmile',
  ])('does not reserve nonmatching custom names: %s', (name) =>
    expect(isBuiltinEmojiName(name)).toBe(false),
  );
});
