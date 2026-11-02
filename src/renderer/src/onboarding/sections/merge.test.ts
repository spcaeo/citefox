import { describe, expect, it } from 'vitest'
import type { SetupItem, SetupRow } from '@shared/ipc'
import {
  addItem,
  applyMore,
  applyRedo,
  clearFresh,
  editItem,
  freshCount,
  itemsFromNames,
  itemsFromRows,
  keptCount,
  makeItemId,
  removeItem,
  restoreItem,
  rowKey,
  toggleItem
} from './merge'

function ids(): () => string {
  let n = 0
  return () => {
    n += 1
    return `n${n}`
  }
}

function row(name: string, extra: Partial<SetupRow> = {}): SetupRow {
  return { name, detail: '', url: null, tag: null, ...extra }
}

function item(id: string, name: string, extra: Partial<SetupItem> = {}): SetupItem {
  return {
    id,
    name,
    detail: '',
    url: null,
    tag: null,
    origin: 'ai',
    kept: true,
    edited: false,
    fresh: false,
    ...extra
  }
}

describe('rowKey', () => {
  it('folds case, spacing, punctuation and a scheme', () => {
    expect(rowKey('Text Bolt')).toBe(rowKey('text-bolt'))
    expect(rowKey('https://www.TextBolt.com')).toBe(rowKey('textbolt.com'))
    expect(rowKey('  ')).toBe('')
  })
})

describe('makeItemId', () => {
  it('makes distinct opaque ids', () => {
    const a = makeItemId()
    const b = makeItemId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^it[a-z0-9]+$/)
  })
})

describe('itemsFromRows', () => {
  it('makes ticked AI items, without empty or repeated names', () => {
    const out = itemsFromRows([row('Twilio'), row(''), row('twilio'), row('Textmagic')], ids())
    expect(out.map((entry) => [entry.id, entry.name, entry.origin, entry.kept])).toEqual([
      ['n1', 'Twilio', 'ai', true],
      ['n2', 'Textmagic', 'ai', true]
    ])
  })
})

describe('applyMore (Find more and a pasted answer)', () => {
  it('adds fresh rows on top and leaves every existing row as it was', () => {
    const before = [
      item('a', 'Textmagic', { kept: false }),
      item('b', 'SMS API', { origin: 'user' })
    ]
    const { items, added } = applyMore(before, [row('Notifyre'), row('TXTImpact')], ids())
    expect(added).toBe(2)
    expect(items.map((entry) => entry.name)).toEqual([
      'Notifyre',
      'TXTImpact',
      'Textmagic',
      'SMS API'
    ])
    expect(
      items.slice(0, 2).every((entry) => entry.fresh && entry.kept && entry.origin === 'ai')
    ).toBe(true)
    expect(items[2]).toEqual(before[0])
    expect(items[3]).toEqual(before[1])
  })

  it('skips a row already listed, even unticked', () => {
    const before = [item('a', 'ClickSend', { kept: false })]
    const { items, added } = applyMore(before, [row('clicksend'), row('Notifyre')], ids())
    expect(added).toBe(1)
    expect(items.map((entry) => entry.name)).toEqual(['Notifyre', 'ClickSend'])
  })

  it('clears the older "new" marks', () => {
    const before = [item('a', 'Old new', { fresh: true })]
    const { items } = applyMore(before, [row('Newer')], ids())
    expect(items.map((entry) => [entry.name, entry.fresh])).toEqual([
      ['Newer', true],
      ['Old new', false]
    ])
  })
})

describe('applyRedo', () => {
  const before = [
    item('ai1', 'IT sysadmin'),
    item('ai2', 'Library systems admin', { kept: false }),
    item('ai3', 'Practice manager', { kept: false }),
    item('ed1', 'Clinic owner', { origin: 'user', edited: true }),
    item('us1', 'Property manager', { origin: 'user', kept: false })
  ]

  it('replaces untouched AI rows and keeps user and edited rows with their ticks', () => {
    const { items, added } = applyRedo(
      before,
      [row('Alarm installer'), row('Office manager')],
      ids()
    )
    expect(added).toBe(2)
    expect(items.map((entry) => [entry.name, entry.origin, entry.kept])).toEqual([
      ['Alarm installer', 'ai', true],
      ['Office manager', 'ai', true],
      ['Clinic owner', 'user', true],
      ['Property manager', 'user', false]
    ])
  })

  it('keeps the id and the tick of an AI row that comes back', () => {
    const { items } = applyRedo(before, [row('practice manager'), row('IT sysadmin')], ids())
    const back = items.find((entry) => entry.id === 'ai3')
    expect(back?.kept).toBe(false)
    expect(back?.name).toBe('practice manager')
    expect(items.find((entry) => entry.id === 'ai1')?.kept).toBe(true)
    expect(items.some((entry) => entry.id === 'ai2')).toBe(false)
  })

  it('drops a replacement that repeats a user row', () => {
    const { items } = applyRedo(before, [row('Clinic Owner'), row('New one')], ids())
    expect(items.filter((entry) => rowKey(entry.name) === 'clinicowner')).toHaveLength(1)
    expect(items.find((entry) => rowKey(entry.name) === 'clinicowner')?.id).toBe('ed1')
  })

  it('never marks redo rows as new and clears old marks', () => {
    const { items } = applyRedo(
      [item('f', 'Fresh one', { fresh: true, origin: 'user' })],
      [row('Other')],
      ids()
    )
    expect(freshCount(items)).toBe(0)
  })
})

describe('the next action clears "new"', () => {
  const fresh = [item('a', 'A', { fresh: true }), item('b', 'B')]

  it('tick', () => {
    const out = toggleItem(fresh, 'b')
    expect(freshCount(out)).toBe(0)
    expect(out[1]?.kept).toBe(false)
  })

  it('edit', () => {
    expect(freshCount(editItem(fresh, 'b', { name: 'B2' }))).toBe(0)
  })

  it('add', () => {
    expect(freshCount(addItem(fresh, row('C'), ids()).items)).toBe(0)
  })

  it('remove', () => {
    expect(freshCount(removeItem(fresh, 'b').items)).toBe(0)
  })

  it('clearFresh leaves rows without marks alone', () => {
    expect(clearFresh([item('x', 'X')])).toEqual([item('x', 'X')])
  })
})

describe('editItem', () => {
  it('makes an edited AI row the user’s own', () => {
    const out = editItem([item('a', 'Email-to-SMS')], 'a', {
      name: ' Two-way texting ',
      url: '/business-texting/'
    })
    expect(out[0]).toMatchObject({
      name: 'Two-way texting',
      url: '/business-texting/',
      origin: 'user',
      edited: true
    })
  })

  it('leaves a row alone when nothing changed', () => {
    const before = [item('a', 'Same')]
    expect(editItem(before, 'a', { name: 'Same' })[0]).toEqual(before[0])
  })

  it('keeps a user row unedited-flagged as it was', () => {
    const out = editItem([item('u', 'Mine', { origin: 'user' })], 'u', { detail: 'More' })
    expect(out[0]).toMatchObject({ origin: 'user', edited: false, detail: 'More' })
  })
})

describe('addItem', () => {
  it('adds the user’s row at the end, ticked', () => {
    const { items, added, id } = addItem([item('a', 'A')], row('SMS API'), ids())
    expect(added).toBe(true)
    expect(id).toBe('n1')
    expect(items[1]).toMatchObject({ name: 'SMS API', origin: 'user', kept: true, fresh: false })
  })

  it('refuses an empty or repeated name and points at the row that has it', () => {
    expect(addItem([item('a', 'A')], row('  '), ids()).added).toBe(false)
    const same = addItem([item('a', 'Text Bolt')], row('textbolt'), ids())
    expect(same.added).toBe(false)
    expect(same.id).toBe('a')
  })
})

describe('removeItem and restoreItem', () => {
  it('puts a removed row back at its place', () => {
    const before = [item('a', 'A'), item('b', 'B'), item('c', 'C')]
    const { items, removed } = removeItem(before, 'b')
    expect(items.map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(removed?.index).toBe(1)
    const back = restoreItem(items, removed!)
    expect(back.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(restoreItem(back, removed!)).toHaveLength(3)
  })

  it('returns null for an unknown id', () => {
    expect(removeItem([item('a', 'A')], 'zzz').removed).toBeNull()
  })

  it('restores at the end when the list got shorter', () => {
    const back = restoreItem([], { item: item('z', 'Z'), index: 5 })
    expect(back.map((entry) => entry.id)).toEqual(['z'])
  })
})

describe('itemsFromNames', () => {
  it('keeps known names, adds new ones as the user’s, drops the rest', () => {
    const before = [item('a', 'AT&T'), item('b', 'Verizon')]
    const out = itemsFromNames(before, ['Verizon', 'T-Mobile', ' ', 'verizon'], ids())
    expect(out.map((entry) => [entry.id, entry.name, entry.origin])).toEqual([
      ['b', 'Verizon', 'ai'],
      ['n1', 'T-Mobile', 'user']
    ])
  })
})

describe('keptCount', () => {
  it('counts ticked rows', () => {
    expect(keptCount([item('a', 'A'), item('b', 'B', { kept: false })])).toBe(1)
  })
})
