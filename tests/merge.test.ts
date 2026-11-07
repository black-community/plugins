import { describe, expect, it } from 'vitest'
import { mendBinder, mergeFiles, mergeValue, type Files } from '../plugins/repository/src/merge'

const enc = new TextEncoder()
const dec = new TextDecoder()
const files = (entries: Record<string, string | object>): Files =>
  new Map(Object.entries(entries).map(([k, v]) => [k, enc.encode(typeof v === 'string' ? v : JSON.stringify(v))]))
const text = (f: Files, path: string) => (f.has(path) ? dec.decode(f.get(path)) : undefined)
const json = (f: Files, path: string) => JSON.parse(text(f, path)!)
const opts = { label: 'From the repository', now: '2026-10-19T10:00:00.000Z' }

describe('merging a book’s files from two devices', () => {
  it('takes what only one side changed, added or removed', () => {
    const base = files({ 'docs/a.html': 'A', 'docs/b.html': 'B', 'docs/c.html': 'C' })
    const ours = files({ 'docs/a.html': 'A here', 'docs/b.html': 'B', 'docs/c.html': 'C', 'docs/new-here.html': 'N' })
    const theirs = files({ 'docs/a.html': 'A', 'docs/b.html': 'B there', 'docs/new-there.html': 'M' })
    const { files: out, conflicts } = mergeFiles(base, ours, theirs, opts)
    expect(text(out, 'docs/a.html')).toBe('A here')
    expect(text(out, 'docs/b.html')).toBe('B there')
    expect(out.has('docs/c.html')).toBe(false)
    expect(text(out, 'docs/new-here.html')).toBe('N')
    expect(text(out, 'docs/new-there.html')).toBe('M')
    expect(conflicts).toEqual([])
  })

  it('keeps this device’s text of a document both changed, and the other as a snapshot of it', () => {
    const { files: out, conflicts } = mergeFiles(
      files({ 'Saga.black/docs/a.html': '<p>Once</p>' }),
      files({ 'Saga.black/docs/a.html': '<p>Once, here</p>' }),
      files({ 'Saga.black/docs/a.html': '<p>Once, there</p>' }),
      opts,
    )
    expect(text(out, 'Saga.black/docs/a.html')).toBe('<p>Once, here</p>')
    expect(conflicts).toEqual(['Saga.black/docs/a.html'])
    const snap = [...out.keys()].find((k) => k.startsWith('Saga.black/snapshots/a/'))!
    expect(json(out, snap)).toEqual({ label: 'From the repository', taken: opts.now, html: '<p>Once, there</p>' })
  })

  it('merges a book’s manifest key by key: a scene added on each side, both kept in the chapter', () => {
    const node = (id: string, parentId: string | null, children: string[] = []) => ({ id, parentId, children, type: 'text', title: id })
    const base = {
      title: 'Saga',
      nodes: { manuscript: node('manuscript', null, ['ch']), ch: node('ch', 'manuscript', ['s1']), s1: node('s1', 'ch') },
      meta: { s1: { synopsis: '', words: 10 } },
      labels: [{ id: 'l1', name: 'Red', color: '#ff0000' }],
    }
    const ours = structuredClone(base)
    ours.nodes.ch.children.push('s2')
    Object.assign(ours.nodes, { s2: node('s2', 'ch') })
    ours.meta.s1.words = 12
    const theirs = structuredClone(base)
    theirs.nodes.ch.children.push('s3')
    Object.assign(theirs.nodes, { s3: node('s3', 'ch') })
    theirs.meta.s1.synopsis = 'The ball.'
    theirs.labels.push({ id: 'l2', name: 'Blue', color: '#0000ff' })
    const { files: out } = mergeFiles(files({ 'book.json': base }), files({ 'book.json': ours }), files({ 'book.json': theirs }), opts)
    const merged = json(out, 'book.json')
    expect(merged.nodes.ch.children).toEqual(['s1', 's2', 's3'])
    expect(Object.keys(merged.nodes).sort()).toEqual(['ch', 'manuscript', 's1', 's2', 's3'])
    expect(merged.meta.s1).toEqual({ synopsis: 'The ball.', words: 12 })
    expect(merged.labels.map((l: { name: string }) => l.name)).toEqual(['Red', 'Blue'])
  })

  it('takes out what the other side removed from a list, unless it was changed here', () => {
    expect(mergeValue(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['a', 'c'])).toEqual(['a', 'c', 'd'])
    const base = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]
    expect(mergeValue(base, [{ id: 'x', name: 'X!' }, { id: 'y', name: 'Y' }], [{ id: 'y', name: 'Y' }])).toEqual([
      { id: 'x', name: 'X!' },
      { id: 'y', name: 'Y' },
    ])
    // Both sides changed one value: this side's version wins.
    expect(mergeValue({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 2 })
  })

  it('mends a binder: an item that lost its place is put back in its folder, and nothing is listed twice or missing', () => {
    const project = {
      rootIds: ['manuscript'],
      nodes: {
        manuscript: { id: 'manuscript', parentId: null, children: ['ch', 'ch'] },
        ch: { id: 'ch', parentId: 'manuscript', children: ['gone'] },
        lost: { id: 'lost', parentId: 'ch', children: [] },
      },
    }
    mendBinder(project)
    expect(project.nodes.manuscript.children).toEqual(['ch'])
    expect(project.nodes.ch.children).toEqual(['lost'])
  })
})

describe('a project’s two kinds of file, in one repository', () => {
  const opts = { label: 'From the repository', now: '2026-11-07T10:00:00.000Z' }
  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
  const files = (o: Record<string, unknown>) => new Map(Object.entries(o).map(([k, v]) => [k, bytes(v)]))
  const read = (m: Map<string, Uint8Array>, p: string) => JSON.parse(new TextDecoder().decode(m.get(p)))

  it('merges the project’s file item by item, so a book added on each side is kept', () => {
    const base = { name: 'Saga', books: [{ id: 'one', title: 'One', start: '' }] }
    const ours = { name: 'Saga', books: [...base.books, { id: 'two', title: 'Two', start: '' }] }
    const theirs = { name: 'Saga', books: [...base.books, { id: 'three', title: 'Three', start: '' }] }
    const { files: out, conflicts } = mergeFiles(files({ 'project.json': base }), files({ 'project.json': ours }), files({ 'project.json': theirs }), opts)
    expect(read(out, 'project.json').books.map((b: { id: string }) => b.id).sort()).toEqual(['one', 'three', 'two'])
    expect(conflicts).toEqual([])
  })

  it('merges a book’s manifest in its folder, and keeps the other version of a document beside its book', () => {
    const p = 'books/one/book.json'
    const { files: out } = mergeFiles(files({ [p]: { title: 'A', a: 1 } }), files({ [p]: { title: 'A', a: 2 } }), files({ [p]: { title: 'B', a: 1 } }), opts)
    expect(read(out, p)).toMatchObject({ title: 'B', a: 2 })
    const d = 'books/one/docs/s1.html'
    const merged = mergeFiles(files({ [d]: 'x' }), files({ [d]: 'here' }), files({ [d]: 'there' }), opts)
    expect(merged.conflicts).toEqual([d])
    expect([...merged.files.keys()].some((k) => k.startsWith('books/one/snapshots/s1/'))).toBe(true)
  })
})
