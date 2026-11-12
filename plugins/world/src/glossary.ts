/*
 * The glossary's words for the book's spelling dictionary: every word of each term's name and other names, so the
 * spell checker stops marking them. Only words of two letters or more, made of letters (with ' or - inside).
 */
export function glossaryWords(names: string[]): string[] {
  const words = new Set<string>();
  for (const name of names)
    for (const word of name.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu) ?? []) if (word.length > 1) words.add(word);
  return [...words].sort((a, b) => a.localeCompare(b));
}
