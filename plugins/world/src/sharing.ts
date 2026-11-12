/*
 * Entries shared with the series: the writer chooses which, and World keeps a copy of each in its shared data, in the
 * form the series bible reads (`entries`, black/src/lib/kinds.ts, sharedEntries). The copies are World's: the bible
 * only shows them. A copy is updated when its entry changes in the book it's in, and a book that doesn't have the
 * entry leaves its copy alone, since it belongs to another book of the series.
 */

export interface SharedCopy {
  id: string;
  /** The kind's id, without World's: "faction". */
  kind: string;
  title: string;
  synopsis: string;
  fields: Record<string, string>;
}

/** Reads World's shared data, keeping anything else in it as it is. */
export function readShared(value: unknown): { entries: SharedCopy[]; rest: Record<string, unknown> } {
  const data = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const { entries, ...rest } = data;
  const list = Array.isArray(entries) ? entries.filter((e): e is SharedCopy => !!e && typeof e === "object" && typeof (e as SharedCopy).id === "string") : [];
  return { entries: list, rest };
}

/**
 * Returns World's shared data with copies replaced (an entry), added, or removed (null), or null if nothing changed.
 * Entries not in `changes` are kept as they are.
 */
export function withCopies(value: unknown, changes: Map<string, SharedCopy | null>): Record<string, unknown> | null {
  const { entries, rest } = readShared(value);
  let changed = false;
  const next: SharedCopy[] = [];
  for (const e of entries) {
    if (!changes.has(e.id)) next.push(e);
    else {
      const now = changes.get(e.id);
      if (now) next.push(now);
      if (JSON.stringify(now) !== JSON.stringify(e)) changed = true;
    }
  }
  for (const [id, copy] of changes) if (copy && !entries.some((e) => e.id === id)) (next.push(copy), (changed = true));
  return changed ? { ...rest, entries: next } : null;
}
