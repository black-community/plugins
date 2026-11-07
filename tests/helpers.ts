// What the plugin's tests share: a project's folder on the disk, a network through plain fetch, and a repository served
// over http by git's own http-backend, as the real thing is. The app's own tests run the plugin in the app.
import { execFileSync, spawn } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { FolderAccess } from '../plugins/repository/src/fs'
import type { NetAccess } from '../plugins/repository/src/http'
import { makeRepo, type Texts } from '../plugins/repository/src/history'
import { netClient } from '../plugins/repository/src/http'

export const sh = (cwd: string, args: string[], input?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', input })

/** The app's checks on a path (electron/projectFolder.ts), as far as these tests need them: nothing leaves the folder. */
function inFolder(root: string, rel: string) {
  if (rel.startsWith('/') || rel.split('/').includes('..')) throw new Error(`Refused: ${rel}`)
  return rel ? path.join(root, ...rel.split('/')) : root
}

/** app.folder on a real folder. It remembers every path used, so a test can check that nothing outside was asked for. */
export function diskFolder(root: string): FolderAccess & { used: string[] } {
  const used: string[] = []
  const at = (rel: string) => {
    used.push(rel)
    return inFolder(root, rel)
  }
  return {
    used,
    async read(rel) {
      return fs.readFile(at(rel), { flag: constants.O_RDONLY | constants.O_NOFOLLOW }).then((b) => new Uint8Array(b), () => null)
    },
    async write(rel, data) {
      const full = at(rel)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, data)
    },
    async remove(rel) {
      return fs.unlink(at(rel)).then(() => true, () => false)
    },
    async list(rel) {
      const entries = await fs.readdir(at(rel), { withFileTypes: true }).catch(() => null)
      return entries && entries.filter((e) => e.name !== '.sync').map((e) => ({ name: e.name, folder: e.isDirectory(), link: e.isSymbolicLink() }))
    },
    async stat(rel) {
      const st = await fs.lstat(at(rel)).catch(() => null)
      return st && { folder: st.isDirectory(), link: st.isSymbolicLink(), size: st.size, mode: st.mode, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, uid: st.uid, gid: st.gid, dev: st.dev }
    },
    async mkdir(rel) {
      await fs.mkdir(at(rel), { recursive: true })
    },
    async rmdir(rel) {
      return fs.rmdir(at(rel)).then(() => true, () => false)
    },
  }
}

/** app.net.streamBytes through fetch. It refuses a redirect, and remembers every address asked for and the headers sent. */
export function plainNet() {
  const seen: { url: string; headers: Record<string, string> }[] = []
  const net: NetAccess = {
    async streamBytes(url, init, onChunk) {
      seen.push({ url, headers: init?.headers ?? {} })
      const res = await fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body as BodyInit | undefined, redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) throw new Error('answered with a redirect, and plugin requests don’t follow redirects.')
      onChunk(new Uint8Array(await res.arrayBuffer()))
      return { ok: res.ok, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers) }
    },
  }
  return { net, seen }
}

export const LOGIN = { user: 'writer', token: 'test-token' }
export const TEXTS: Texts = {
  beforeSync: 'Before syncing',
  merged: 'Synced with the repository',
  nothingToPush: 'There is no history to push yet.',
  describe: (err) => (err as Error).message ?? String(err),
}
export const now = <T>(work: () => Promise<T>) => work()

export function repoAt(root: string, net = plainNet().net, login = LOGIN) {
  const folder = diskFolder(root)
  return Object.assign(makeRepo(folder, netClient(net), () => login), { used: folder.used })
}

/** Serves the bare repositories in `root` over http. Anyone with the token may read and write. */
export async function gitServer(root: string) {
  const server = http.createServer((req, res) => {
    const auth = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString()
    if (auth.split(':')[1] !== LOGIN.token) return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' }).end()
    const url = new URL(req.url!, 'http://localhost')
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: auth.split(':')[0],
        REQUEST_METHOD: req.method,
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
      },
    })
    req.pipe(cgi.stdin)
    const parts: Buffer[] = []
    cgi.stdout.on('data', (c) => parts.push(c))
    cgi.stdout.on('end', () => {
      const whole = Buffer.concat(parts)
      const end = whole.indexOf('\r\n\r\n')
      if (end < 0) return res.writeHead(500).end()
      let status = 200
      const headers: Record<string, string> = {}
      for (const line of whole.subarray(0, end).toString().split('\r\n')) {
        const [k, ...v] = line.split(':')
        if (k.toLowerCase() === 'status') status = Number(v.join(':').trim().split(' ')[0])
        else headers[k] = v.join(':').trim()
      }
      res.writeHead(status, headers).end(whole.subarray(end + 4))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { url: (name: string) => `http://127.0.0.1:${port}/${name}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

export const write = (root: string, file: string, content: string) =>
  fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }).then(() => fs.writeFile(path.join(root, file), content))
export const read = (root: string, file: string) => fs.readFile(path.join(root, file), 'utf8')
export const exists = (p: string) => fs.access(p).then(() => true, () => false)
