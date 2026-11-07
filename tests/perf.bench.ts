// How long the history takes on a real project: the Sherlock Holmes sample and a few hundred versions.
//   SAMPLE=<a project's folder> npx vitest run --config vitest.perf.config.mts
import { describe, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commit, log, sync } from '../plugins/repository/src/history'
import { gitServer, now, repoAt, sh, TEXTS } from './helpers'

const timed = async <T>(label: string, work: () => Promise<T>) => {
  const start = performance.now()
  const out = await work()
  console.log(`${label}: ${Math.round(performance.now() - start)} ms`)
  return out
}

describe('performance', () => {
  it('on the sample, with a long history', async () => {
    const sample = process.env.SAMPLE
    if (!sample) throw new Error('Set SAMPLE to a project’s folder.')
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'black-perf-')))
    const server = await gitServer(dir)
    try {
      const root = path.join(dir, 'Holmes.black')
      await fs.cp(sample, root, { recursive: true })
      const files = (await fs.readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile())
      const bytes = (await Promise.all(files.map((e) => fs.stat(path.join(e.parentPath, e.name))))).reduce((n, s) => n + s.size, 0)
      console.log(`${files.length} files, ${Math.round(bytes / 1024)} KB`)
      const r = repoAt(root)
      await timed('first commit, every file', () => commit(r, 'First'))
      const docs = files.filter((e) => e.name.endsWith('.html')).map((e) => path.join(e.parentPath, e.name))
      const history = Number(process.env.COMMITS ?? 300)
      const start = performance.now()
      for (let i = 0; i < history; i++) {
        const doc = docs[i % docs.length]
        await fs.appendFile(doc, `<p>Commit ${i}.</p>`)
        await commit(r, `Commit ${i}`)
      }
      console.log(`${history} commits, one document each: ${Math.round((performance.now() - start) / history)} ms each`)
      sh(dir, ['init', '-q', '--bare', path.join(dir, 'b.git')])
      const url = server.url('b.git')
      await timed(`first push of ${history} commits`, async () => {
        const res = await sync(r, url, 'main', '', TEXTS, now)
        if (!res.ok) throw new Error(res.message)
      })
      await fs.appendFile(docs[0], '<p>One more.</p>')
      await timed('commit with a long history', () => commit(r, 'One more'))
      await timed('push of one commit', async () => {
        const res = await sync(r, url, 'main', '', TEXTS, now)
        if (!res.ok) throw new Error(res.message)
      })
      await timed('nothing changed: check for a commit', () => commit(r, 'Nothing'))
      await timed('list of versions', () => log(r))
      const file = path.relative(root, docs[0]).split(path.sep).join('/')
      await timed('a document’s versions, first time', () => log(r, file))
      await timed('a document’s versions, again', () => log(r, file))
      await timed('system git: status, for comparison', async () => void sh(root, ['status', '--porcelain']))
    } finally {
      await server.close()
      await fs.rm(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
