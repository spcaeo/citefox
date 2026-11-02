import { describe, expect, it } from 'vitest'
import { GOOGLE_UPDATES } from '@shared/google-updates'
import {
  eventDay,
  finishedText,
  googleEvents,
  hiddenKinds,
  joinCrowded,
  measuringBands,
  rolloutBands,
  soleFix,
  soleOpenable,
  stackMarkers,
  visibleEvents,
  type ChartEvent
} from './markers'
import { dayStartIso } from './scale'

const fix = (n: number, day: string): ChartEvent => ({
  id: `fix:${n}`,
  kind: 'fix',
  at: dayStartIso(day),
  title: `Fix ${n} · Added an FAQ`,
  line: '3 questions',
  number: n,
  fixId: `f${n}`
})

const google: ChartEvent = {
  id: 'google:core',
  kind: 'google',
  at: dayStartIso('2026-10-08'),
  title: 'October core update',
  line: 'Broad change.'
}

describe('marker stacks', () => {
  it('stacks events on one day into one circle with the count', () => {
    const stacks = stackMarkers([google, fix(2, '2026-10-08'), fix(1, '2026-09-20')])
    expect(stacks.map((stack) => stack.label)).toEqual(['1', '2'])
    const [first, second] = stacks
    expect(first?.kind).toBe('fix')
    expect(second?.kind).toBe('mixed')
    // Fixes come first in the card, then Google.
    expect(second?.events.map((event) => event.kind)).toEqual(['fix', 'google'])
    expect(second?.name).toMatch(/2 events: Fix 2 · Added an FAQ; October core update/)
  })

  it('shows G for a Google update and ? for a page change', () => {
    const page: ChartEvent = {
      ...google,
      id: 'page:1',
      kind: 'page',
      at: dayStartIso('2026-10-12')
    }
    const labels = stackMarkers([google, page]).map((stack) => stack.label)
    expect(labels).toEqual(['G', '?'])
  })

  it('names a single marker with who made it', () => {
    const [stack] = stackMarkers([fix(3, '2026-10-01')])
    expect(stack?.name).toMatch(/Your fix: Fix 3 · Added an FAQ$/)
    expect(stack && soleFix(stack)?.fixId).toBe('f3')
  })

  it('only a lone fix opens directly; a stacked day does not', () => {
    const [stack] = stackMarkers([fix(1, '2026-10-08'), google])
    expect(stack && soleFix(stack)).toBeNull()
    expect(stack && soleOpenable(stack)).toBeNull()
  })

  it('a lone page change opens what changed; a lone Google update does not', () => {
    const page: ChartEvent = { ...google, id: 'page:pc-1', kind: 'page' }
    const [alone] = stackMarkers([page])
    expect(alone && soleOpenable(alone)?.id).toBe('page:pc-1')
    const [g] = stackMarkers([google])
    expect(g && soleOpenable(g)).toBeNull()
  })
})

describe('crowded markers', () => {
  it('joins markers closer than a 24px target into one, at the first place', () => {
    const stacks = stackMarkers([fix(1, '2026-10-04'), google, fix(3, '2026-10-20')])
    const placed = stacks.map((stack, index) => ({ stack, x: [52, 62, 200][index] ?? 0 }))
    const joined = joinCrowded(placed)
    expect(joined.map((item) => item.x)).toEqual([52, 200])
    const [first] = joined
    expect(first?.stack.label).toBe('2')
    expect(first?.stack.kind).toBe('mixed')
    expect(first?.stack.name).toMatch(
      /^Oct 4 to Oct 8, 2 events: Fix 1 · Added an FAQ; October core update$/
    )
    expect(new Set(joined.map((item) => item.stack.key)).size).toBe(2)
  })

  it('leaves markers 24px apart alone', () => {
    const stacks = stackMarkers([fix(1, '2026-10-04'), fix(2, '2026-10-05')])
    const placed = stacks.map((stack, index) => ({ stack, x: 52 + index * 24 }))
    expect(joinCrowded(placed)).toEqual(placed)
  })
})

describe('which markers a chart shows', () => {
  const t0 = Date.parse(dayStartIso('2026-09-01'))
  const t1 = Date.parse(dayStartIso('2026-10-30'))

  it('drops hidden kinds and events outside the range', () => {
    const shown = visibleEvents(
      [fix(1, '2026-08-01'), fix(2, '2026-09-10'), google],
      new Set(['google']),
      t0,
      t1
    )
    expect(shown.map((event) => event.id)).toEqual(['fix:2'])
  })

  it('reads the URL list, keeping known kinds only', () => {
    expect([...hiddenKinds(['google', 'nope', 'page'])]).toEqual(['google', 'page'])
  })

  it('draws a 14-day band after each live fix, cut at the end of the chart', () => {
    const bands = measuringBands(
      [fix(1, '2026-10-20'), { ...fix(2, '2026-10-25'), planned: true }],
      t1
    )
    expect(bands).toHaveLength(1)
    expect(bands[0]?.to).toBe(t1)
  })

  it('places Google updates that touch the range, one still rolling out at the start at t0', () => {
    const events = googleEvents(GOOGLE_UPDATES, t0, t1)
    const ids = events.map((event) => event.id)
    expect(ids).toEqual(['google:2026-09-spam'])
    const early = googleEvents(
      GOOGLE_UPDATES,
      Date.parse(dayStartIso('2026-04-01')),
      Date.parse(dayStartIso('2026-04-30'))
    )
    expect(early.map((event) => event.id)).toEqual(['google:2026-03-core'])
    expect(early[0]?.at).toBe(new Date(Date.parse(dayStartIso('2026-04-01'))).toISOString())
    const march = early[0]
    expect(march && eventDay(march)).toBe('Mar 27 – Apr 8')
    expect(march?.span && finishedText(march.span)).toBe('Finished Apr 8, 2026.')
  })

  it('says when an update is still rolling out', () => {
    const span = { from: dayStartIso('2026-10-02'), to: null }
    expect(eventDay({ at: span.from, span })).toBe('Since Oct 2')
    expect(finishedText(span)).toBe('Still rolling out.')
  })

  it('shades each rollout, cut to the range, the finish day included', () => {
    const april = googleEvents(
      GOOGLE_UPDATES,
      Date.parse(dayStartIso('2026-04-01')),
      Date.parse(dayStartIso('2026-04-30'))
    )
    const [band] = rolloutBands(
      april,
      Date.parse(dayStartIso('2026-04-01')),
      Date.parse(dayStartIso('2026-04-30'))
    )
    expect(band?.from).toBe(Date.parse(dayStartIso('2026-04-01')))
    expect(band?.to).toBe(Date.parse(dayStartIso('2026-04-09')))
    expect(
      rolloutBands(
        [{ id: 'f', kind: 'fix', at: dayStartIso('2026-04-02'), title: '', line: '' }],
        0,
        Infinity
      )
    ).toEqual([])
  })
})

describe('the shipped Google updates list', () => {
  it('is oldest first, with unique ids, real days and Google’s page', () => {
    const ids = new Set(GOOGLE_UPDATES.map((update) => update.id))
    expect(ids.size).toBe(GOOGLE_UPDATES.length)
    for (let index = 1; index < GOOGLE_UPDATES.length; index += 1) {
      const before = GOOGLE_UPDATES[index - 1]
      const update = GOOGLE_UPDATES[index]
      expect(before && update && before.startedOn <= update.startedOn).toBe(true)
    }
    for (const update of GOOGLE_UPDATES) {
      expect(update.startedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (update.finishedOn) expect(update.finishedOn >= update.startedOn).toBe(true)
      expect(update.url.startsWith('https://status.search.google.com/')).toBe(true)
    }
  })
})
