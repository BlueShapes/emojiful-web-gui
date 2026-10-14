import manifest from '../../../shared/locales.json';
import english from './messages/en.json';

export type MessageKey = keyof typeof english;
export const locales = manifest;
export type Locale = (typeof manifest)[number]['code'];
export const DEFAULT_LOCALE = 'en';
const dictionaries = import.meta.glob<{ default: Record<MessageKey, string> }>(
  './messages/*.json',
  { eager: true },
);
export function resolveLocale(value: string | undefined | null): Locale {
  return (
    locales.find((locale) => locale.code === value)?.code ?? DEFAULT_LOCALE
  );
}
export function localePath(locale: string): string {
  return `/${resolveLocale(locale)}/`;
}
export type MessageArgs = Record<string, string | number | LocalizedError>;
export function translate(
  locale: Locale,
  key: MessageKey,
  args: MessageArgs = {},
): string {
  const messages =
    dictionaries[`./messages/${resolveLocale(locale)}.json`]?.default ??
    english;
  return (messages[key] ?? english[key]).replace(
    /\{(\w+)\}/g,
    (_, name: string) => {
      const value = args[name];
      return value instanceof LocalizedError
        ? translate(locale, value.key, value.args)
        : String(value ?? `{${name}}`);
    },
  );
}
// Keep errors structured so nested validation details use the page's language too.
export class LocalizedError extends Error {
  constructor(
    public readonly key: MessageKey,
    public readonly args: MessageArgs = {},
  ) {
    super(translate('ja', key, args));
  }
}
export function localizedErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof LocalizedError)
    return translate(locale, error.key, error.args);
  return translate(
    locale,
    error instanceof SyntaxError ? 'error.json' : 'error.failed',
  );
}
