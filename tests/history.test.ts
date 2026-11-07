// The version history, with a real repository served over http, as two devices would use it. These replace the tests of
// the app's git code, which is gone. Each checks the same behaviour through the plugin's code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clone, commit, fileAt, initRepo, log, remoteBooks, sync } from '../plugins/repository/src/history'
import { netClient, withHead } from '../plugins/repository/src/http'
import { exists, gitServer, LOGIN, now, plainNet, read, repoAt, sh, TEXTS, write } from './helpers'

let dir: string
let server: Awaited<ReturnType<typeof gitServer>>
let count = 0
const remote = () => {
  const name = `remote-${++count}.git`
  sh(dir, ['init', '-q', '--bare', path.join(dir, name)])
  sh(path.join(dir, name), ['config', 'http.receivepack', 'true'])
  return { bare: path.join(dir, name), url: server.url(name) }
}
const book = (name: string) => path.join(dir, name)
const manifest = (scenes: string[]) =>
  JSON.stringify(
    {
      title: 'Saga',
      rootIds: ['manuscript'],
      nodes: {
        manuscript: { id: 'manuscript', parentId: null, children: ['ch'] },
        ch: { id: 'ch', parentId: 'manuscript', children: scenes },
        ...Object.fromEntries(scenes.map((s) => [s, { id: s, parentId: 'ch', children: [] }])),
      },
    },
    null,
    2,
  )

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'black-plugin-')))
  server = await gitServer(dir)
})
afterAll(async () => {
  await server.close()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('the version history', () => {
  it('commits, skips empty commits, and reads old versions back', async () => {
    const root = book('Book.black')
    await write(root, 'docs/abc.html', '<p>First version</p>')
    const r = repoAt(root)
    expect(await commit(r, 'one')).toBeTruthy()
    expect(await commit(r, 'again')).toBeNull()
    await write(root, 'docs/abc.html', '<p>Second version</p>')
    await commit(r, 'two')
    const entries = await log(r, 'docs/abc.html')
    expect(entries.map((l) => l.message)).toEqual(['two', 'one'])
    expect(new TextDecoder().decode((await fileAt(r, entries[1].hash, 'docs/abc.html'))!)).toBe('<p>First version</p>')
    // The real git reads what isomorphic-git wrote.
    expect(sh(root, ['log', '--format=%s']).trim().split('\n')).toEqual(['two', 'one'])
    expect(sh(root, ['status', '--porcelain'])).toBe('')
  })

  it('refuses a version that looks like an option', async () => {
    const r = repoAt(book('Book.black'))
    expect(await fileAt(r, '--output=/tmp/x', 'docs/abc.html')).toBeNull()
    expect(await fileAt(r, 'a'.repeat(40), '../x')).toBeNull()
  })

  it('ignores temporary files, and adds to a .gitignore that’s there', async () => {
    const root = book('Ignoring.black')
    await write(root, '.gitignore', 'mine\n')
    await write(root, 'a.tmp', 'x')
    await write(root, 'b.html', 'x')
    const r = repoAt(root)
    await commit(r, 'one')
    expect(await read(root, '.gitignore')).toBe('mine\n*.tmp\n.DS_Store\n')
    expect(sh(root, ['ls-files']).split('\n')).not.toContain('a.tmp')
  })

  it('keeps one history at the top of a project, with all its books, and a document’s history from there', async () => {
    const saga = book('Saga.black')
    await write(saga, 'project.json', '{"name":"Saga","books":[{"id":"one"}]}')
    await write(saga, 'books/one/docs/d2.html', '<p>In the saga.</p>')
    const r = repoAt(saga)
    await commit(r, 'from the book')
    expect(sh(saga, ['ls-files'])).toContain('books/one/docs/d2.html')
    expect(sh(saga, ['ls-files'])).toContain('project.json')
    expect(await exists(path.join(saga, 'books/one/.git'))).toBe(false)
    expect((await log(r, 'books/one/docs/d2.html')).map((l) => l.message)).toEqual(['from the book'])
  })

  it('never commits into some other repository a project happens to lie in', async () => {
    const outer = book('Documents')
    await fs.mkdir(outer)
    sh(outer, ['init', '-q'])
    const root = path.join(outer, 'Alone.black')
    await write(root, 'project.json', '{}')
    await commit(repoAt(root), 'mine')
    expect(await exists(path.join(root, '.git'))).toBe(true)
    expect(sh(outer, ['status', '--porcelain']).trim()).toBe('?? Alone.black/')
  })

  it('takes commits one after another, whichever book they come from', async () => {
    const saga = book('Race.black')
    await write(saga, 'project.json', '{}')
    const r = repoAt(saga)
    await commit(r, 'first')
    let chain: Promise<unknown> = Promise.resolve()
    const work = Array.from({ length: 8 }, (_, i) => {
      chain = chain.then(async () => {
        await write(saga, `books/b${i % 2}/docs/d${i}.html`, `<p>${i}</p>`)
        return commit(r, `commit ${i}`)
      })
      return chain
    })
    await Promise.all(work)
    expect(sh(saga, ['status', '--porcelain'])).toBe('')
    expect(sh(saga, ['rev-list', '--count', 'HEAD']).trim()).toBe('9')
  })
})

describe('syncing through a repository', () => {
  it('pushes the first time, brings the other copy up to date, and merges what both changed', async () => {
    const { bare, url } = remote()
    const a = book('A.black')
    const b = book('B.black')
    const ra = repoAt(a)
    await write(a, 'project.json', manifest(['s1']))
    await write(a, 'docs/s1.html', '<p>One</p>')
    await commit(ra, 'Begun')
    expect(await sync(ra, url, 'saga', 'From the repository', TEXTS, now)).toMatchObject({ ok: true, changed: [] })
    expect(sh(bare, ['rev-parse', 'refs/heads/saga']).trim()).toBe(sh(a, ['rev-parse', 'HEAD']).trim())

    // B clones a copy from the repository.
    const rb = repoAt(b)
    await fs.mkdir(b)
    await clone(rb, url, 'saga')
    expect(await read(b, 'docs/s1.html')).toBe('<p>One</p>')
    expect(sh(b, ['status', '--porcelain'])).toBe('')

    // A keeps writing, and B syncs and catches up.
    await write(a, 'docs/s1.html', '<p>One, and more</p>')
    await commit(ra, 'More')
    await sync(ra, url, 'saga', '', TEXTS, now)
    expect(await sync(rb, url, 'saga', '', TEXTS, now)).toMatchObject({ ok: true, changed: ['docs/s1.html'] })
    expect(await read(b, 'docs/s1.html')).toBe('<p>One, and more</p>')

    // Each device adds a scene and changes the first scene.
    await write(a, 'project.json', manifest(['s1', 'sa']))
    await write(a, 'docs/sa.html', '<p>From A</p>')
    await write(a, 'docs/s1.html', '<p>A’s ending</p>')
    await commit(ra, 'A')
    await sync(ra, url, 'saga', '', TEXTS, now)
    await write(b, 'project.json', manifest(['s1', 'sb']))
    await write(b, 'docs/sb.html', '<p>From B</p>')
    await write(b, 'docs/s1.html', '<p>B’s ending</p>')
    await commit(rb, 'B')
    const merged = await sync(rb, url, 'saga', 'From the repository', TEXTS, now)
    expect(merged.ok).toBe(true)
    expect(merged.conflicts).toEqual(['docs/s1.html'])
    expect(JSON.parse(await read(b, 'project.json')).nodes.ch.children).toEqual(['s1', 'sb', 'sa'])
    expect(await read(b, 'docs/sa.html')).toBe('<p>From A</p>')
    // B's text stays, and A's is kept as a snapshot of it.
    expect(await read(b, 'docs/s1.html')).toBe('<p>B’s ending</p>')
    const snaps = await fs.readdir(path.join(b, 'snapshots', 's1'))
    expect(JSON.parse(await read(b, path.join('snapshots', 's1', snaps[0])))).toMatchObject({ html: '<p>A’s ending</p>', label: 'From the repository' })
    // The merge comes after both and is in the repository.
    expect(sh(b, ['log', '-1', '--format=%P']).trim().split(' ')).toHaveLength(2)
    expect(sh(b, ['status', '--porcelain']).trim()).toBe('')

    // A then gets the merge, so both have the same book, with A's ending among the first scene's snapshots.
    const back = await sync(ra, url, 'saga', '', TEXTS, now)
    expect(back.changed.filter((f) => !f.startsWith('snapshots/')).sort()).toEqual(['docs/s1.html', 'docs/sb.html', 'project.json'])
    expect(JSON.parse(await read(a, 'project.json')).nodes.ch.children).toEqual(['s1', 'sb', 'sa'])
    expect(await read(a, 'docs/s1.html')).toBe('<p>B’s ending</p>')
    expect(await read(a, path.join('snapshots', 's1', snaps[0]))).toContain('A’s ending')
    // The system's git agrees that the repository is whole.
    expect(sh(bare, ['fsck', '--no-progress'])).toBe('')
  })

  it('commits what isn’t in the history yet before moving forward to the repository', async () => {
    const { url } = remote()
    const a = book('Ahead.black')
    const b = book('Behind.black')
    const ra = repoAt(a)
    await write(a, 'docs/x.html', 'x')
    await commit(ra, 'x')
    await sync(ra, url, 'saga', '', TEXTS, now)
    await fs.mkdir(b)
    const rb = repoAt(b)
    await clone(rb, url, 'saga')
    await write(a, 'docs/y.html', 'y')
    await commit(ra, 'y')
    await sync(ra, url, 'saga', '', TEXTS, now)
    await write(b, 'docs/z.html', 'not committed yet')
    expect((await sync(rb, url, 'saga', '', TEXTS, now)).ok).toBe(true)
    expect(await read(b, 'docs/z.html')).toBe('not committed yet')
    expect(await read(b, 'docs/y.html')).toBe('y')
    expect(sh(b, ['log', '--format=%s'])).toContain('Before syncing')
  })

  it('fetches and merges again if another device pushes first', async () => {
    const { bare, url } = remote()
    const root = book('Racing.black')
    const r0 = repoAt(root)
    await write(root, 'docs/a.html', 'a')
    await commit(r0, 'a')
    await sync(r0, url, 'saga', '', TEXTS, now)
    // Another device pushes just as this one is about to.
    const other = book('Rival')
    sh(dir, ['clone', '-q', '--branch', 'saga', bare, other])
    await write(other, 'docs/rival.html', 'rival')
    sh(other, ['add', '-A'])
    sh(other, ['-c', 'user.name=R', '-c', 'user.email=r@x', 'commit', '-q', '-m', 'Rival'])
    const { net } = plainNet()
    let raced = false
    const racing = {
      async streamBytes(...args: Parameters<typeof net.streamBytes>) {
        if (args[0].endsWith('/git-receive-pack') && !raced) {
          raced = true
          sh(other, ['push', '-q', bare, 'HEAD:refs/heads/saga'])
        }
        return net.streamBytes(...args)
      },
    }
    const r = repoAt(root, racing)
    await write(root, 'docs/a.html', 'a, and more')
    await commit(r, 'more')
    const result = await sync(r, url, 'saga', '', TEXTS, now)
    expect(raced).toBe(true)
    expect(result).toMatchObject({ ok: true, changed: ['docs/rival.html'] })
    expect(await read(root, 'docs/rival.html')).toBe('rival')
    expect(sh(bare, ['rev-parse', 'refs/heads/saga']).trim()).toBe(sh(root, ['rev-parse', 'HEAD']).trim())
  })

  it('says why it can’t reach a repository, and asks for a sign-in', async () => {
    const root = book('Lonely.black')
    await write(root, 'a.html', 'a')
    const r = repoAt(root)
    await commit(r, 'a')
    const missing = await sync(r, server.url('missing.git'), 'main', '', TEXTS, now)
    expect(missing.ok).toBe(false)
    expect(missing.message).toMatch(/404/)
    const { url } = remote()
    const out = repoAt(root, plainNet().net, { user: 'writer', token: 'wrong' })
    const refused = await sync(out, url, 'main', '', TEXTS, now)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/401|cancel/i)
  })

  it('sends the token only as a header and never writes it to .git', async () => {
    const { url } = remote()
    const root = book('Token.black')
    await write(root, 'a.html', 'a')
    const { net, seen } = plainNet()
    const r = repoAt(root, net)
    await commit(r, 'a')
    expect((await sync(r, url, 'main', '', TEXTS, now)).ok).toBe(true)
    expect(seen.some((s) => (s.headers.Authorization ?? s.headers.authorization ?? '').startsWith('Basic '))).toBe(true)
    for (const s of seen) expect(s.url).not.toContain(LOGIN.token)
    expect(await read(root, '.git/config')).not.toContain(LOGIN.token)
  })
})

describe('what a repository holds', () => {
  it('lists its projects without letting a branch named like an option do anything', async () => {
    const { bare, url } = remote()
    const work = book('Lister.black')
    const r = repoAt(work)
    await write(work, 'project.json', JSON.stringify({ name: 'The Book', books: [{ id: 'one', title: 'The Book' }] }))
    await commit(r, 'one')
    await sync(r, url, 'book', '', TEXTS, now)
    // A branch that `git branch` would refuse to make, but update-ref will, and a push could carry.
    sh(bare, ['update-ref', 'refs/heads/--output=written', 'refs/heads/book'])
    const books = await remoteBooks(netClient(plainNet().net), () => LOGIN, url)
    expect(books).toEqual([{ branch: 'book', kind: 'book', title: 'The Book' }])
    expect((await fs.readdir(dir)).filter((f) => f.includes('written'))).toEqual([])
  })

  it('leaves out a branch that isn’t a project', async () => {
    const { url } = remote()
    const work = book('Other.black')
    const r = repoAt(work)
    await write(work, 'README.md', 'not a project')
    await commit(r, 'one')
    await sync(r, url, 'readme', '', TEXTS, now)
    expect(await remoteBooks(netClient(plainNet().net), () => LOGIN, url)).toEqual([])
  })
})

describe('a list of refs with no HEAD', () => {
  const pkt = (l: string) => (l === '' ? '0000' : (l.length + 4).toString(16).padStart(4, '0') + l)
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
  it('gets one, so a fetch can carry on', () => {
    const oid = 'a'.repeat(40)
    const body = pkt('# service=git-upload-pack\n') + '0000' + pkt(`${oid} refs/heads/book\0caps\n`) + '0000'
    const mended = new TextDecoder().decode(withHead(bytes(body)))
    expect(mended).toContain(`${oid} HEAD\0caps`)
    expect(mended).toContain(`${oid} refs/heads/book`)
  })
  it('stays as it is if it has one, or is protocol 2', () => {
    const v2 = bytes(pkt('# service=git-upload-pack\n') + '0000' + pkt('version 2\n') + '0000')
    expect(withHead(v2)).toBe(v2)
  })
})

describe('setting up', () => {
  it('won’t use a .git that’s a file, which could point anywhere', async () => {
    const root = book('Pointing.black')
    await write(root, '.git', 'gitdir: ../../somewhere-else\n')
    await write(root, 'a.html', 'a')
    await expect(initRepo(repoAt(root))).rejects.toThrow('not-a-folder')
  })
})
