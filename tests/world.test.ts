// World's kinds of entry, as the book keeps them, in English and Swedish.
import { describe, expect, it } from 'vitest'
import { translator } from '../shared/i18n'
import { KINDS, kindDefinitions, type Key } from '../plugins/world/src/kinds'
import en from '../plugins/world/locales/en.json'
import sv from '../plugins/world/locales/sv.json'

const locales = { en: en.messages, sv: sv.messages } as Record<string, Record<string, string>>
/** The rule the app checks a kind's and a section's ids against (src/lib/kinds.ts, KIND_ID). */
const KIND_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

describe('World’s kinds', () => {
  it('are the plan’s seven, with valid ids, in one World section', () => {
    const kinds = kindDefinitions(translator<Key>(locales, 'en'))
    expect(kinds.map((k) => k.name)).toEqual(['Faction', 'Culture', 'Religion', 'Creature', 'Artifact', 'Magic', 'Language'])
    for (const k of kinds) {
      expect(k.id).toMatch(KIND_ID)
      expect(k.section).toEqual({ id: 'world', name: 'World' })
      expect(new Set(k.fields).size).toBe(k.fields!.length)
    }
    expect(kinds[0].fields).toEqual(['Leader', 'Seat', 'Goals', 'Allies', 'Enemies', 'Symbol', 'Founded'])
  })

  it('are written in the book’s language', () => {
    const kinds = kindDefinitions(translator<Key>(locales, 'sv-SE'))
    expect(kinds[0]).toMatchObject({ name: 'Fraktion', plural: 'Fraktioner', section: { id: 'world', name: 'Världen' } })
    expect(kinds[0].fields).toEqual(['Ledare', 'Säte', 'Mål', 'Allierade', 'Fiender', 'Symbol', 'Grundad'])
    // A language World has no words for gets English.
    expect(kindDefinitions(translator<Key>(locales, 'de'))[0].name).toBe('Faction')
  })

  it('have every word in Swedish too', () => {
    expect(Object.keys(sv.messages).sort()).toEqual(Object.keys(en.messages).sort())
    const keys = KINDS.flatMap((k) => [k.name, k.plural, ...k.fields])
    for (const key of keys) expect(sv.messages[key as keyof typeof sv.messages], key).toBeTruthy()
  })
})
