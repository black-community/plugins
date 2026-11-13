// Code shared by the build and the checks.
//
// All of a plugin's text is in its locales/ folder, with one file for each language:
//
//   locales/<language>.json   { "manifest": { "name", "description", "permissions": { "<permission>": "why" } }, "messages": { "<key>": "text" } }
//
// manifest.json holds everything else. The build combines them into the manifest the app reads, so a translator
// only edits one file, and adding a language only needs a new file.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The name the app knows the SDK by at run time. The plugins import '@black-studio/plugin', its package on npm, and the
 * build turns that into this, so they also work in app versions from before the package was renamed.
 */
const RUNTIME_SDK = '@black/plugin'
/** Modules the app provides at run time, so they're left out of the bundle. */
const PROVIDED = ['@black-studio/plugin', RUNTIME_SDK, 'react', 'react/jsx-runtime', '@tiptap/core', '@tiptap/pm/state', '@tiptap/pm/view', '@tiptap/pm/model']
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/
const LOCALES_MODULE = 'black:locales'

export function readLocales(dir) {
  const folder = path.join(dir, 'locales')
  if (!existsSync(folder)) throw new Error(`${dir} has no locales/ folder.`)
  const locales = {}
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.json')).sort()) {
    const language = file.slice(0, -'.json'.length)
    if (!LANGUAGE.test(language)) throw new Error(`locales/${file}: the file name must be a language code.`)
    locales[language] = JSON.parse(readFileSync(path.join(folder, file), 'utf8'))
  }
  if (!locales.en) throw new Error(`${dir} has no locales/en.json. English is required, because other languages fall back to it.`)
  return locales
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()

/** Lists problems in a plugin's translations. Missing text is fine, since it falls back to English. */
export function localeProblems(locales, source) {
  const problems = []
  const english = locales.en.messages ?? {}
  for (const [language, locale] of Object.entries(locales)) {
    for (const [key, text] of Object.entries(locale.messages ?? {})) {
      if (typeof text !== 'string') problems.push(`locales/${language}.json: ${key} must be text.`)
      else if (!(key in english)) problems.push(`locales/${language}.json: ${key} doesn't exist in en.json.`)
      else if (placeholders(text) !== placeholders(english[key])) problems.push(`locales/${language}.json: ${key} must have the same {placeholders} as en.json.`)
    }
    for (const permission of Object.keys(locale.manifest?.permissions ?? {}))
      if (!(locales.en.manifest?.permissions ?? {})[permission]) problems.push(`locales/${language}.json: the permission ${permission} doesn't exist in en.json.`)
  }
  if (!locales.en.manifest?.name) problems.push('locales/en.json: manifest.name is required.')
  if (!locales.en.manifest?.description) problems.push('locales/en.json: manifest.description is required.')
  for (const key of Object.keys(english)) if (!source.includes(`"${key}"`)) problems.push(`locales/en.json: ${key} isn't used in the source code.`)
  return problems
}

/** Builds the manifest the app reads, from manifest.json and the locales. */
export function composeManifest(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const locales = readLocales(dir)
  const { en, ...others } = locales
  const translated = {}
  for (const [language, locale] of Object.entries(others)) {
    const { name, description } = locale.manifest ?? {}
    if (name || description) translated[language] = { ...(name ? { name } : {}), ...(description ? { description } : {}) }
  }
  const reasons = {}
  for (const [language, locale] of Object.entries(locales))
    for (const [permission, why] of Object.entries(locale.manifest?.permissions ?? {})) (reasons[permission] ??= {})[language] = why
  return {
    ...manifest,
    name: en.manifest?.name,
    description: en.manifest?.description,
    ...(Object.keys(reasons).length ? { permissionReasons: reasons } : {}),
    ...(Object.keys(translated).length ? { locales: translated } : {}),
  }
}

function entryOf(dir) {
  for (const name of ['main.tsx', 'main.ts', 'main.jsx', 'main.js']) {
    const file = path.join(dir, 'src', name)
    if (existsSync(file)) return file
  }
  throw new Error(`${dir} has no src/main.ts (or .tsx, .js, .jsx).`)
}

/** Builds the plugin in `dir` into `outDir`: manifest.json, and main.js with the messages included. */
export async function buildPlugin(dir, outDir) {
  const { rolldown } = await import('rolldown')
  const manifest = composeManifest(dir)
  const messages = Object.fromEntries(Object.entries(readLocales(dir)).map(([language, locale]) => [language, locale.messages ?? {}]))
  const bundle = await rolldown({
    input: entryOf(dir),
    external: PROVIDED,
    transform: { jsx: { runtime: 'automatic' } },
    logLevel: 'warn',
    plugins: [
      {
        name: 'black-locales',
        resolveId: (id) => (id === LOCALES_MODULE ? `\0${LOCALES_MODULE}` : null),
        load: (id) => (id === `\0${LOCALES_MODULE}` ? `export default ${JSON.stringify(messages)}` : null),
      },
    ],
  })
  await bundle.write({
    file: path.join(outDir, manifest.main ?? 'main.js'),
    format: 'iife',
    // The app finds the plugin's class through this global.
    name: '__blackPlugin',
    exports: 'auto',
    globals: (id) => `__black.require(${JSON.stringify(id === '@black-studio/plugin' ? RUNTIME_SDK : id)})`,
    minify: true,
  })
  await bundle.close()
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  if (existsSync(path.join(dir, 'styles.css'))) writeFileSync(path.join(outDir, 'styles.css'), readFileSync(path.join(dir, 'styles.css')))
  return manifest
}

/** Zips the built plugin and returns the SHA-256. Files get a fixed date, so the same plugin always makes the same zip. */
export async function zipPlugin(outDir, zipFile) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const stamp = { date: new Date(Date.UTC(1980, 0, 1)) }
  const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))
  for (const file of ['manifest.json', manifest.main ?? 'main.js', 'styles.css'])
    if (existsSync(path.join(outDir, file))) zip.file(file, readFileSync(path.join(outDir, file)), stamp)
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
  writeFileSync(zipFile, data)
  return createHash('sha256').update(data).digest('hex')
}
