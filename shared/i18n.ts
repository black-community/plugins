/**
 * Reads a plugin's text from its locales/ folder. Anything missing from a language falls back to English.
 * `{name}` in a text is replaced with the value given for `name`.
 */
export type Translate<Key extends string> = (key: Key, values?: Record<string, string>) => string;

export function translator<Key extends string>(
  locales: Record<string, Record<string, string>>,
  language: string,
): Translate<Key> {
  const chosen = locales[language] ?? locales[language.split("-")[0]] ?? {};
  const english = locales.en ?? {};
  return (key, values = {}) =>
    (chosen[key] ?? english[key] ?? key).replace(
      /\{(\w+)\}/g,
      (whole, name: string) => values[name] ?? whole,
    );
}
