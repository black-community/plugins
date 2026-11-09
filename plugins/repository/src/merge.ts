/*
 * Syncs a book between devices with a three-way merge of the book's files: the common
 * ancestor (base), this device's version (ours) and the repository's version (theirs).
 * It never touches the disk.
 *
 * Whatever only one side changed is taken from that side. Where both changed:
 * - a book's or project's file (book.json, project.json) is merged key by
 *   key, and lists of ids, or of things with ids, are merged item by item, so a scene
 *   added here and another added there are both kept;
 * - a document keeps this device's text, and the repository's version is kept
 *   as a snapshot of the document, which the writer can compare and restore
 *   from the document's history;
 * - anything else keeps this device's version.
 * Nothing is lost. A version that isn't used stays in the history, and for
 * documents also in their snapshots.
 */

/** Returns whether a path in a repository is a book's manifest, in any book. */
const isBookFilePath = (p: string) => p === 'book.json' || p.endsWith('/book.json')
/** Returns whether a path in a repository is a project's file. It's always at the top level. */
const isProjectFilePath = (p: string) => p === 'project.json'

export type Files = Map<string, Uint8Array>

export interface MergeResult {
  files: Files
  /** Documents that both sides changed. This device's version is kept and the other version is saved as a snapshot. */
  conflicts: string[]
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export const sameBytes = (a?: Uint8Array, b?: Uint8Array) => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasId = (v: unknown): v is { id: string } => isObject(v) && typeof v.id === 'string'

/**
 * Merges a list that both sides changed, keeping our order. Items removed in theirs are dropped, and items
 * added in theirs are inserted after the item they followed there. Plain items are matched
 * by value (ids, names), and items that have ids are matched by id and merged.
 */
function mergeList(base: unknown[], ours: unknown[], theirs: unknown[]): unknown[] {
  const byId = [...base, ...ours, ...theirs].every((x) => hasId(x))
  const plain = [...base, ...ours, ...theirs].every((x) => typeof x === 'string' || typeof x === 'number')
  if (!byId && !plain) return ours
  const key = (x: unknown) => (byId ? (x as { id: string }).id : String(x))
  const keys = (list: unknown[]) => new Set(list.map(key))
  const inBase = keys(base)
  const inTheirs = keys(theirs)
  const inOurs = keys(ours)
  const find = (list: unknown[], k: string) => list.find((x) => key(x) === k)
  // Start with ours, minus anything they removed that we didn't change, and merge each item with theirs.
  const out: unknown[] = []
  for (const item of ours) {
    const k = key(item)
    if (inBase.has(k) && !inTheirs.has(k) && sameValue(find(base, k), item)) continue
    out.push(byId && inTheirs.has(k) ? mergeValue(find(base, k), item, find(theirs, k)) : item)
  }
  // Insert what they added after the item it followed in theirs, and after anything we added at that spot.
  const oursAdded = (x: unknown) => !inBase.has(key(x)) && !inTheirs.has(key(x))
  theirs.forEach((item, i) => {
    const k = key(item)
    if (inBase.has(k) || inOurs.has(k)) return
    const before = i > 0 ? key(theirs[i - 1]) : null
    let at = before === null ? 0 : out.findIndex((x) => key(x) === before) + 1
    if (before !== null && at === 0) at = out.length
    while (at < out.length && oursAdded(out[at])) at++
    out.splice(at, 0, item)
  })
  return out
}

/** Merges a value that both sides may have changed: takes whichever side changed it, merges if both did, and uses ours if they can't be merged. */
export function mergeValue(base: unknown, ours: unknown, theirs: unknown): unknown {
  if (sameValue(ours, theirs)) return ours
  if (sameValue(ours, base)) return theirs
  if (sameValue(theirs, base)) return ours
  if (isObject(ours) && isObject(theirs)) {
    const b = isObject(base) ? base : {}
    const out: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const v = mergeValue(b[k], ours[k], theirs[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (Array.isArray(ours) && Array.isArray(theirs)) return mergeList(Array.isArray(base) ? base : [], ours, theirs)
  return ours
}

/**
 * Repairs a book's binder after a merge, so that every item is listed in its
 * folder (an item added on each side may have lost its place), nothing is listed that
 * isn't there, and nothing is listed twice.
 */
export function mendBinder(project: Record<string, unknown>) {
  const nodes = project.nodes as Record<string, { id: string; parentId: string | null; children: string[] }> | undefined
  if (!nodes) return project
  const seen = new Set<string>()
  for (const node of Object.values(nodes)) {
    node.children = (node.children ?? []).filter((c) => nodes[c] && nodes[c].parentId === node.id && !seen.has(c) && seen.add(c))
  }
  const roots = new Set((project.rootIds as string[] | undefined) ?? [])
  for (const node of Object.values(nodes)) {
    if (seen.has(node.id) || roots.has(node.id)) continue
    const parent = node.parentId && nodes[node.parentId] ? nodes[node.parentId] : nodes.manuscript
    if (!parent) continue
    node.parentId = parent.id
    parent.children.push(node.id)
  }
  return project
}

const DOC = /^(.*\/)?docs\/([0-9a-z_-]+)\.html$/i

/** Builds a snapshot of the repository's version of a document, at the path where the book keeps its snapshots. */
function snapshotOf(path: string, html: string, label: string, now: string): [string, Uint8Array] | null {
  const m = DOC.exec(path)
  if (!m) return null
  const book = m[1] ?? ''
  const file = `${book}snapshots/${m[2]}/${now.replace(/[:.]/g, '-')}-sync.html`
  return [file, encoder.encode(JSON.stringify({ label, taken: now, html }))]
}

/**
 * Merges the files into one set. `label` names the repository's version of a document
 * that both sides changed ("From the repository, 19 Oct 10:42"); `now` is the time
 * the snapshot is taken.
 */
export function mergeFiles(base: Files, ours: Files, theirs: Files, opts: { label: string; now: string }): MergeResult {
  const files: Files = new Map()
  const conflicts: string[] = []
  for (const path of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
    const b = base.get(path)
    const o = ours.get(path)
    const t = theirs.get(path)
    let merged: Uint8Array | undefined
    if (sameBytes(o, t)) merged = o
    else if (sameBytes(o, b)) merged = t
    else if (sameBytes(t, b)) merged = o
    else if (!o || !t) merged = o ?? t // Removed on one side and changed on the other, so keep the changed version.
    else if (isBookFilePath(path) || isProjectFilePath(path)) {
      try {
        const value = mergeValue(b ? JSON.parse(decoder.decode(b)) : {}, JSON.parse(decoder.decode(o)), JSON.parse(decoder.decode(t)))
        const out = isBookFilePath(path) ? mendBinder(value as Record<string, unknown>) : value
        merged = encoder.encode(JSON.stringify(out, null, 2))
      } catch {
        merged = o
      }
    } else {
      merged = o
      const snap = snapshotOf(path, decoder.decode(t), opts.label, opts.now)
      if (snap) {
        files.set(snap[0], snap[1])
        conflicts.push(path)
      }
    }
    if (merged) files.set(path, merged)
  }
  return { files, conflicts }
}
