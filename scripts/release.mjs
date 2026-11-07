// Builds each plugin into a zip in zips/, and writes plugins.json with each zip's address and SHA-256.
//
//   npm run release   build the plugins, and write zips/ and plugins.json (commit them)
//   npm run verify    build again, and check that zips/ and plugins.json match the source
//
// A listed version never changes, so a changed plugin needs a new version in its manifest.json.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlugin, localeProblems, readLocales, zipPlugin } from './lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
/** Where the app downloads zips from: the files in this repository. */
const RAW = 'https://raw.githubusercontent.com/black-community/plugins/main'

const allSources = (dir) =>
  readdirSync(dir, { recursive: true })
    .filter((f) => /\.[jt]sx?$/.test(String(f)))
    .map((f) => readFileSync(path.join(dir, String(f)), 'utf8'))
    .join('\n')

const work = mkdtempSync(path.join(os.tmpdir(), 'black-community-'))
const entries = []
const problems = []
try {
  for (const name of readdirSync(path.join(root, 'plugins')).sort()) {
    const dir = path.join(root, 'plugins', name)
    if (!statSync(dir).isDirectory()) continue
    problems.push(...localeProblems(readLocales(dir), allSources(path.join(dir, 'src'))).map((p) => `plugins/${name}: ${p}`))
    const manifest = await buildPlugin(dir, path.join(work, name))
    if (manifest.id !== name) problems.push(`plugins/${name}: the id in manifest.json must match the folder name, but it's ${manifest.id}.`)
    const file = `${manifest.id}-${manifest.version}.zip`
    const built = path.join(work, file)
    const sha256 = await zipPlugin(path.join(work, name), built)
    const kept = path.join(root, 'zips', file)
    const same = existsSync(kept) && createHash('sha256').update(readFileSync(kept)).digest('hex') === sha256
    if (check) {
      if (!same) problems.push(`zips/${file} doesn't match plugins/${name}. Run npm run release. If this version is already published, raise the version first.`)
    } else if (existsSync(kept) && !same) {
      problems.push(`plugins/${name} changed, but version ${manifest.version} is already published. Raise the version.`)
    } else {
      mkdirSync(path.dirname(kept), { recursive: true })
      writeFileSync(kept, readFileSync(built))
    }
    const { main: _main, ...listed } = manifest
    entries.push({ ...listed, download: `${RAW}/zips/${file}`, sha256 })
    console.log(`${manifest.id} ${manifest.version} ${sha256.slice(0, 12)}`)
  }
  const list = JSON.stringify({ name: 'Bläck Studio community', plugins: entries }, null, 2) + '\n'
  const listFile = path.join(root, 'plugins.json')
  if (check) {
    if (!existsSync(listFile) || readFileSync(listFile, 'utf8') !== list) problems.push('plugins.json is out of date. Run npm run release.')
  } else if (!problems.length) {
    writeFileSync(listFile, list)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`)
  process.exit(1)
}
console.log(check ? '✓ zips/ and plugins.json are up to date' : '✓ wrote zips/ and plugins.json')
