// World's kinds of entry, as the book keeps them, in English and Swedish.
import { describe, expect, it } from 'vitest'
import { translator } from '../shared/i18n'
import { KINDS, kindDefinitions, type Key } from '../plugins/world/src/kinds'
import en from '../plugins/world/locales/en.json'
import sv from '../plugins/world/locales/sv.json'
import { addLink, LINK_TYPES, linksOf, readItem, removeLink } from '../plugins/world/src/links'

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

describe('links between things in the world', () => {
  const exists = () => true

  it('are shown on both items, with the words for each end', () => {
    const ama = addLink(undefined, 'ama', 'memberOf', 'guild', 'l1')!
    const guild = addLink({ other: 'kept' }, 'guild', 'rules', 'bristol', 'l2')!
    expect(guild.other).toBe('kept')
    const all = { ama, guild }
    expect(linksOf('ama', all, exists)).toEqual([{ holder: 'ama', id: 'l1', type: 'memberOf', outgoing: true, label: 'link.memberOf.out', other: 'guild' }])
    expect(linksOf('guild', all, exists).map((l) => [l.label, l.other]).sort()).toEqual([
      ['link.memberOf.in', 'ama'],
      ['link.rules.out', 'bristol'],
    ])
    expect(linksOf('bristol', all, exists).map((l) => l.label)).toEqual(['link.rules.in'])
  })

  it('read the same both ways when they’re symmetric', () => {
    const all = { a: addLink(undefined, 'a', 'enemyOf', 'b', 'l1')! }
    expect(linksOf('b', all, exists)[0].label).toBe('link.enemyOf.out')
  })

  it('aren’t added to the item itself, or twice', () => {
    expect(addLink(undefined, 'a', 'rules', 'a')).toBeNull()
    const once = addLink(undefined, 'a', 'rules', 'b', 'l1')!
    expect(addLink(once, 'a', 'rules', 'b', 'l2')).toBeNull()
    expect(Object.keys(addLink(once, 'a', 'enemyOf', 'b', 'l2')!.links!)).toEqual(['l1', 'l2'])
  })

  it('are kept by id, so two people adding links at once both keep theirs when Bläck Sync merges key by key', () => {
    const before = addLink(undefined, 'a', 'rules', 'b', 'l1')!
    const mine = addLink(before, 'a', 'memberOf', 'c', 'l2')!
    const theirs = addLink(before, 'a', 'worships', 'd', 'l3')!
    const merged = { ...before, links: { ...mine.links, ...theirs.links } }
    expect(Object.keys(merged.links).sort()).toEqual(['l1', 'l2', 'l3'])
  })

  it('are removed one at a time, keeping the rest and anything unknown', () => {
    const data = { links: { l1: { type: 'rules', to: 'b' }, l9: { type: 'fromLater', to: 'x' } }, later: 1 }
    expect(removeLink(data, 'l1')).toEqual({ links: { l9: { type: 'fromLater', to: 'x' } }, later: 1 })
    // A link of a type this version doesn't know isn't shown, but stays.
    expect(readItem(data).links).toEqual({ l1: { type: 'rules', to: 'b' } })
    expect(Object.keys(addLink(data, 'a', 'memberOf', 'c', 'l2')!.links!).sort()).toEqual(['l1', 'l2', 'l9'])
  })

  it('leave out an item that isn’t there any more, without forgetting the link', () => {
    const all = { a: addLink(undefined, 'a', 'rules', 'gone', 'l1')! }
    expect(linksOf('a', all, (id) => id !== 'gone')).toEqual([])
    expect(all.a.links).toEqual({ l1: { type: 'rules', to: 'gone' } })
  })

  it('have words in both languages for every type', () => {
    for (const lt of LINK_TYPES) for (const key of [lt.out, lt.in]) {
      expect(en.messages[key as keyof typeof en.messages], key).toBeTruthy()
      expect(sv.messages[key as keyof typeof sv.messages], key).toBeTruthy()
    }
  })
})
