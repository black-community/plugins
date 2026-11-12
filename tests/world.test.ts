// World's kinds of entry, as the book keeps them, in English and Swedish.
import { describe, expect, it } from 'vitest'
import { translator } from '../shared/i18n'
import { KINDS, kindDefinitions, type Key } from '../plugins/world/src/kinds'
import en from '../plugins/world/locales/en.json'
import sv from '../plugins/world/locales/sv.json'
import { addLink, LINK_TYPES, linksOf, namesOf, readItem, removeLink, setNames } from '../plugins/world/src/links'
import { mentionFinder, otherNames } from '../plugins/world/src/mentions'
import { glossaryWords } from '../plugins/world/src/glossary'
import { bibleHtml, bibleMarkdown, type BibleInput } from '../plugins/world/src/bible'
import { readShared, withCopies } from '../plugins/world/src/sharing'
import { monthsText, parseMonths, readCalendar, worldDate, yearLabel } from '../plugins/world/src/calendar'
import { addPin, mapsWith, readPins, removePin } from '../plugins/world/src/maps'
import { worldChecks } from '../plugins/world/src/checks'

const locales = { en: en.messages, sv: sv.messages } as Record<string, Record<string, string>>
/** The rule the app checks a kind's and a section's ids against (src/lib/kinds.ts, KIND_ID). */
const KIND_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

describe('World’s kinds', () => {
  it('are the plan’s seven and the glossary’s terms, with valid ids, in one World section', () => {
    const kinds = kindDefinitions(translator<Key>(locales, 'en'))
    expect(kinds.map((k) => k.name)).toEqual(['Faction', 'Culture', 'Religion', 'Creature', 'Artifact', 'Magic', 'Map', 'Term', 'Language'])
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

describe('mentions of things in the world', () => {
  const find = mentionFinder([
    { name: 'The Guild', entry: 'guild' },
    { name: 'Guild', entry: 'guild' },
    { name: 'The Iron Guild', entry: 'iron' },
    { name: 'Ödemarken', entry: 'waste' },
    { name: 'Ama', entry: 'ama' },
    { name: 'x', entry: 'too-short' },
  ])
  const words = (text: string) => find(text).map((m) => [text.slice(m.from, m.to), m.entry])

  it('are found as whole words, whatever their case, with the longest name first', () => {
    expect(words('The Iron Guild met the Guild.')).toEqual([
      ['The Iron Guild', 'iron'],
      ['the Guild', 'guild'],
    ])
    expect(words('Guildhall and Amalia aren’t mentions.')).toEqual([])
  })

  it('include the genitive, in English and Swedish', () => {
    expect(words('the Guild’s seal')).toEqual([['the Guild', 'guild']])
    expect(words('Amas svärd och Ödemarkens sand')).toEqual([
      ['Amas', 'ama'],
      ['Ödemarkens', 'waste'],
    ])
  })

  it('count å, ä and ö as letters, so they don’t end a word', () => {
    expect(words('Amaä och Ödemarkenå')).toEqual([])
  })

  it('come from an entry’s other names too, as the writer typed them', () => {
    expect(otherNames('The Hand, Iron Hand; x\n  Gillet ')).toEqual(['The Hand', 'Iron Hand', 'Gillet'])
    const names = mentionFinder(otherNames('The Hand, Gillet').map((name) => ({ name, entry: 'guild' })))
    expect(names('Gillets folk och the hand').map((m) => m.entry)).toEqual(['guild', 'guild'])
  })

  it('are kept with the item’s other data', () => {
    const data = setNames({ links: { l1: { type: 'rules', to: 'b' } } }, 'The Hand')
    expect(namesOf(data)).toBe('The Hand')
    expect(data.links).toEqual({ l1: { type: 'rules', to: 'b' } })
    expect(namesOf(undefined)).toBe('')
  })
})

describe('the glossary', () => {
  it('gives each word of its terms’ names to the dictionary once', () => {
    expect(glossaryWords(['Ödemark', 'the Iron-hand', 'Kel’tar sword', 'a', 'Ödemark'])).toEqual(['Iron-hand', 'Kel’tar', 'Ödemark', 'sword', 'the'])
  })
})

describe('the world bible', () => {
  const input: BibleInput = {
    title: 'Saga *one*',
    kinds: [
      {
        plural: 'Factions',
        entries: [
          {
            title: 'The <Iron> Guild',
            names: 'Gillet',
            synopsis: 'Merchants',
            fields: [['Leader', 'Ama']],
            links: [{ label: 'Members', other: 'Jim' }],
            text: 'First line.\n\nSecond line.',
          },
        ],
      },
      { plural: 'Cultures', entries: [] },
    ],
    words: { otherNames: 'Other names', links: 'Links', empty: 'Nothing yet.' },
  }

  it('is Markdown, kind by kind, with what Markdown would read escaped', () => {
    const md = bibleMarkdown(input)
    expect(md).toContain('# Saga \\*one\\*')
    expect(md).toContain('## Factions')
    expect(md).not.toContain('## Cultures')
    expect(md).toContain('### The \\<Iron\\> Guild')
    expect(md).toContain('- **Leader:** Ama')
    expect(md).toContain('- Members: Jim')
    expect(md).toContain('Second line.')
  })

  it('is a whole HTML page, with everything escaped', () => {
    const html = bibleHtml(input, 'sv')
    expect(html).toContain('<html lang="sv">')
    expect(html).toContain('<h3>The &lt;Iron&gt; Guild</h3>')
    expect(html).toContain('<dt>Leader</dt><dd>Ama</dd>')
    expect(html).not.toContain('<Iron>')
  })

  it('says so when the world is empty', () => {
    expect(bibleMarkdown({ ...input, kinds: [] })).toContain('Nothing yet.')
  })
})

describe('entries shared with the series', () => {
  const guild = { id: 'g1', kind: 'faction', title: 'The Guild', synopsis: '', fields: {} }

  it('are added, updated and removed, keeping other books’ copies and anything else', () => {
    const start = { entries: [guild, { ...guild, id: 'other-book' }], settings: { x: 1 } }
    const renamed = withCopies(start, new Map([['g1', { ...guild, title: 'The Iron Guild' }]]))!
    expect(readShared(renamed).entries.map((e) => [e.id, e.title])).toEqual([
      ['g1', 'The Iron Guild'],
      ['other-book', 'The Guild'],
    ])
    expect(renamed.settings).toEqual({ x: 1 })
    const removed = withCopies(renamed, new Map([['g1', null]]))!
    expect(readShared(removed).entries.map((e) => e.id)).toEqual(['other-book'])
    const added = withCopies(undefined, new Map([['g2', { ...guild, id: 'g2' }]]))!
    expect(readShared(added).entries.map((e) => e.id)).toEqual(['g2'])
  })

  it('aren’t written when nothing changed', () => {
    expect(withCopies({ entries: [guild] }, new Map([['g1', { ...guild }]]))).toBeNull()
    expect(withCopies({ entries: [guild] }, new Map([['gone', null]]))).toBeNull()
  })
})

describe('the world’s calendar', () => {
  const calendar = { months: parseMonths('Frostmoon 30\nThaw: 20\n\nnot a month\nHarvest 10'), startYear: 1203, era: 'AE' }

  it('reads months from what the writer typed', () => {
    expect(calendar.months).toEqual([
      { name: 'Frostmoon', days: 30 },
      { name: 'Thaw', days: 20 },
      { name: 'Harvest', days: 10 },
    ])
    expect(monthsText(calendar.months)).toBe('Frostmoon 30\nThaw 20\nHarvest 10')
  })

  it('turns story days into the world’s dates, with day 1 the first day of the start year', () => {
    expect(worldDate(1, calendar)).toEqual({ year: 1203, month: 0, day: 1 })
    expect(worldDate(31, calendar)).toEqual({ year: 1203, month: 1, day: 1 })
    expect(worldDate(60, calendar)).toEqual({ year: 1203, month: 2, day: 10 })
    expect(worldDate(61, calendar)).toEqual({ year: 1204, month: 0, day: 1 })
    expect(worldDate(0, calendar)).toEqual({ year: 1202, month: 2, day: 10 })
    expect(yearLabel(1204, calendar)).toBe('1204 AE')
  })

  it('is read from the shared data, or is null until it’s set up', () => {
    expect(readCalendar({ calendar })).toEqual(calendar)
    expect(readCalendar({ calendar: { months: [] } })).toBeNull()
    expect(readCalendar(undefined)).toBeNull()
  })
})

describe('maps', () => {
  it('keep pins by id, on the picture, and know which maps an item is on', () => {
    const map = addPin(addPin({ other: 1 }, { x: 0.5, y: 0.25, to: 'guild' }, 'p1'), { x: 2, y: -1, to: 'bristol' }, 'p2')
    expect(readPins(map)).toEqual({ p1: { x: 0.5, y: 0.25, to: 'guild' }, p2: { x: 1, y: 0, to: 'bristol' } })
    expect((map as Record<string, unknown>).other).toBe(1)
    expect(mapsWith('guild', { m1: map, m2: {} })).toEqual(['m1'])
    expect(readPins(removePin(map, 'p1'))).toEqual({ p2: { x: 1, y: 0, to: 'bristol' } })
    expect(readPins({ pins: { bad: { x: 'a', to: 'x' } } })).toEqual({})
  })
})

describe('World’s continuity checks', () => {
  const link = (type: string, to: string, id: string) => ({ links: { [id]: { type, to } } })
  const title = (id: string) => id.toUpperCase()

  it('find someone in a scene set where their faction is banned, also inside the banned place', () => {
    const all = {
      ama: link('memberOf', 'guild', 'l1'),
      guild: link('bannedFrom', 'city', 'l2'),
      harbour: link('locatedIn', 'city', 'l3'),
    }
    const scenes = [
      { id: 's1', title: 'At the harbour', povId: 'ama', castIds: [], placeId: 'harbour' },
      { id: 's2', title: 'Elsewhere', povId: '', castIds: ['ama'], placeId: 'forest' },
      { id: 's3', title: 'In the city', povId: '', castIds: ['ama', 'ama'], placeId: 'city' },
    ]
    const found = worldChecks(scenes, all, title)
    expect(found.map((f) => [f.itemId, f.values.place])).toEqual([
      ['s1', 'CITY'],
      ['s3', 'CITY'],
    ])
    expect(found[0]).toMatchObject({ kind: 'banned', values: { name: 'AMA', group: 'GUILD', scene: 'At the harbour' } })
  })

  it('find a place located inside itself', () => {
    const all = { a: link('locatedIn', 'b', 'l1'), b: link('locatedIn', 'c', 'l2'), c: link('locatedIn', 'a', 'l3'), d: link('locatedIn', 'a', 'l4') }
    expect(worldChecks([], all, title).map((f) => f.itemId).sort()).toEqual(['a', 'b', 'c'])
  })
})
