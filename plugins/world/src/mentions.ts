/*
 * Finding the things in a world where the text mentions them: an entry's name and its other names, as whole words,
 * whatever their case, with an ending s for the genitive ("the Guild's", Swedish "Gillets"). Letters are Unicode
 * letters, so å, ä, ö and the like count as part of a word.
 */

/** A name to look for, and the entry it belongs to. */
export interface Name {
  name: string;
  entry: string;
}

/** A mention in a text: where it is, and whose name it is. */
export interface Mention {
  from: number;
  to: number;
  entry: string;
}

/** Returns an entry's other names from the text the writer typed: separated by commas, semicolons or new lines. */
export const otherNames = (text: string) =>
  text
    .split(/[,;\n]/)
    .map((n) => n.trim())
    .filter((n) => n.length > 1);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Makes a finder for these names, to call once for each paragraph. Longer names are tried first, so "The Iron Guild"
 * wins over "Guild". A name shorter than two letters is skipped, as it would match too much.
 */
export function mentionFinder(names: Name[]): (text: string) => Mention[] {
  const usable = names.map((n) => ({ ...n, name: n.name.trim() })).filter((n) => n.name.length > 1);
  if (!usable.length) return () => [];
  const byName = new Map<string, string>();
  for (const n of usable) if (!byName.has(n.name.toLocaleLowerCase())) byName.set(n.name.toLocaleLowerCase(), n.entry);
  const alternatives = [...byName.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives.join("|")})s?(?![\\p{L}\\p{N}])`, "giu");
  return (text) => {
    const out: Mention[] = [];
    for (const m of text.matchAll(pattern)) {
      const entry = byName.get(m[1].toLocaleLowerCase());
      if (entry) out.push({ from: m.index!, to: m.index! + m[0].length, entry });
    }
    return out;
  };
}
