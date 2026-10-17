import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  locales,
  translate,
  localePath,
  resolveLocale,
} from '../../web/src/i18n';
import english from '../../web/src/i18n/messages/en.json';
import { errorMessage, importBulk } from '../../web/src/lib/pack';
import { installPack } from '../../web/src/lib/runtime';
import { emptyPack } from '../../web/src/lib/pack';

const dictionaries = import.meta.glob<{ default: Record<string, string> }>(
  '../../web/src/i18n/messages/*.json',
  { eager: true },
);
const placeholders = (text: string) => (text.match(/\{\w+\}|%s/g) ?? []).sort();

describe('all supported translations', () => {
  it('contains the first and second language scopes with complete interpolation keys', () => {
    expect(locales.map((locale) => locale.code)).toEqual([
      'ja',
      'en',
      'hi',
      'zh-hk',
      'zh-tw',
      'zh-cn',
      'ru',
      'pt-br',
      'pt-pt',
      'es',
      'de',
      'cs',
      'pl',
      'ms',
      'ro',
      'fr',
      'ar',
      'id',
      'ko',
      'vi',
      'tr',
      'it',
    ]);
    for (const locale of locales) {
      const messages =
        dictionaries[`../../web/src/i18n/messages/${locale.code}.json`].default;
      expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(english)) {
        expect(messages[key].trim(), `${locale.code}:${key}`).not.toBe('');
        expect(placeholders(messages[key]), `${locale.code}:${key}`).toEqual(
          placeholders(text),
        );
      }
    }
  });
  it('uses safe English routes for unsupported values', () => {
    expect(localePath('ja')).toBe('/ja/');
    expect(localePath('zh-hk')).toBe('/zh-hk/');
    for (const locale of locales) {
      expect(localePath(locale.code)).toBe(`/${locale.code}/`);
    }
    for (const value of ['nl', '../../bad', 'JA', '', undefined, null]) {
      expect(resolveLocale(value)).toBe('en');
    }
  });
  it('renders nested validation errors and interpolated values in the selected language', () => {
    let error: unknown;
    try {
      importBulk(
        'custom_cat,https://example.com/cat.png\ncustom_cat,https://example.com/other.png',
        'Custom',
      );
    } catch (caught) {
      error = caught;
    }
    expect(errorMessage(error, 'en')).toBe(
      'Entry 2: duplicate emoji name “custom_cat”.',
    );
    expect(errorMessage(error, 'ja')).toContain(
      '2件目: 絵文字名「custom_cat」が重複',
    );
    expect(errorMessage(error, 'de')).toContain('custom_cat');
    let nested: unknown;
    try {
      importBulk('[{"name":"custom_cat","url":null}]', 'Custom');
    } catch (caught) {
      nested = caught;
    }
    expect(errorMessage(nested, 'en')).toBe(
      'Entry 1: Enter Image URL as text.',
    );
    expect(translate('en', 'notice.bulkAdded', { count: 3 })).toBe(
      'Added 3 emojis.',
    );
    expect(errorMessage(new SyntaxError('raw English'), 'ja')).toBe(
      translate('ja', 'error.json'),
    );
  });
});

describe('localized backend errors', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('blocks built-in emoji names before sending an install request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      installPack(
        {
          mode: 'mod',
          token: 'a'.repeat(64),
          gameVersion: '1.20.1',
          loader: 'Forge',
          port: 8765,
        },
        {
          ...emptyPack(),
          emojis: [
            {
              name: 'smile',
              url: 'https://example.com/smile.png',
              category: 'Custom',
            },
          ],
        },
        false,
      ),
    ).rejects.toMatchObject({ key: 'error.builtinEmoji' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates conflicts without showing raw backend text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'raw backend message' }), {
          status: 409,
        }),
      ),
    );
    let error: unknown;
    try {
      await installPack(
        {
          mode: 'mod',
          token: 'a'.repeat(64),
          gameVersion: '1.20.1',
          loader: 'Forge',
          port: 8765,
        },
        {
          ...emptyPack(),
          emojis: [
            {
              name: 'custom_smile',
              url: 'https://example.com/smile.png',
              category: 'Custom',
            },
          ],
        },
        false,
      );
    } catch (caught) {
      error = caught;
    }
    expect(errorMessage(error, 'ja')).toBe(translate('ja', 'error.conflict'));
    expect(errorMessage(error, 'en')).toBe(translate('en', 'error.conflict'));
  });
  it('translates connection failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    let error: unknown;
    try {
      await installPack(
        {
          mode: 'mod',
          token: 'a'.repeat(64),
          gameVersion: '1.20.1',
          loader: 'Forge',
          port: 8765,
        },
        {
          ...emptyPack(),
          emojis: [
            {
              name: 'custom_smile',
              url: 'https://example.com/smile.png',
              category: 'Custom',
            },
          ],
        },
        false,
      );
    } catch (caught) {
      error = caught;
    }
    expect(errorMessage(error, 'en')).toBe(translate('en', 'error.network'));
  });
});
