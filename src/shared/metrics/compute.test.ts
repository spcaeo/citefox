import { describe, expect, test } from 'vitest'
import { domainMovers, SEGMENT_NOT_SET } from './breakdowns'
import { computeMetrics } from './compute'
import { C1, C2, C3, expectEveryCountDrills, input, pageRows, row } from './fixtures.test-helper'
import type { MetricPage, MetricRow, MetricsInput } from './types'

const segments = (topic: string, funnel: string | null): MetricRow['segments'] => ({
  topic,
  group: null,
  funnel,
  intent: null,
  pageType: null
})

describe('segments', () => {
  const rows = pageRows().map((item) =>
    item.questionId === 'q1' || item.questionId === 'q2'
      ? { ...item, segments: segments('Integrations', 'BOFU') }
      : item.questionId === 'q3'
        ? { ...item, segments: segments('Pricing', 'TOFU') }
        : item
  )
  const result = computeMetrics(input(rows))

  test('one row per value; the rows add up to the whole', () => {
    const byTopic = result.segments.topic
    expect(byTopic.map((item) => item.value)).toEqual(['Pricing', 'Integrations'])
    expect(byTopic.reduce((sum, item) => sum + item.questions.n, 0)).toBe(result.now.checked.n)
    const integrations = byTopic.find((item) => item.value === 'Integrations')
    expect(integrations?.cited.before?.ids).toEqual(['q2@c1'])
    expect(integrations?.cited.after?.ids).toEqual(['q1@c2', 'q2@c2'])
    expect(integrations?.rateBefore).toBe(1 / 2)
    expect(integrations?.rateAfter).toBe(1)
    const pricing = byTopic.find((item) => item.value === 'Pricing')
    expect(pricing?.open.ids).toEqual(['q3@c2', 'q4@c2'])
  })

  test('questions without a value sit under "Not set", last', () => {
    const funnel = result.segments.funnel
    expect(funnel.at(-1)?.value).toBe(SEGMENT_NOT_SET)
    expect(funnel.map((item) => item.value)).toEqual(['BOFU', 'TOFU', SEGMENT_NOT_SET])
    expect(funnel.reduce((sum, item) => sum + item.questions.n, 0)).toBe(result.now.checked.n)
  })
})

describe('sites', () => {
  const result = computeMetrics(input(pageRows()))

  test('questions citing each site before → after, you included', () => {
    const g2 = result.domains.find((item) => item.domain === 'g2.com')
    expect(g2?.cited.before?.ids).toEqual(['q2@c1'])
    expect(g2?.cited.after?.ids).toEqual(['q1@c2', 'q2@c2', 'q3@c2'])
    expect(g2?.change).toBe(2)
    expect(g2?.withYou.ids).toEqual(['q1@c2', 'q2@c2'])
    const reddit = result.domains.find((item) => item.domain === 'reddit.com')
    expect(reddit?.cited.before?.ids).toEqual(['q1@c1', 'q2@c1'])
    expect(reddit?.cited.after?.ids).toEqual(['q3@c2', 'q4@c2'])
    const you = result.domains.find((item) => item.own)
    expect(you?.domain).toBe('textbolt.com')
    expect(you?.cited.now).toEqual(result.now.cited)
    expect(you?.cited.after).toEqual(result.comparison?.after.cited)
  })

  test('movers: gained most first, lost most first; unchanged left out', () => {
    const movers = domainMovers(result.domains)
    expect(movers.gained.map((item) => item.domain)).toEqual(['g2.com'])
    expect(movers.lost).toEqual([])
    // You and g2.com are both cited on 3 questions now: on a tie you come first.
    expect(result.domains.slice(0, 2).map((item) => item.domain)).toEqual([
      'textbolt.com',
      'g2.com'
    ])
  })
})

describe('pages', () => {
  const pages: MetricPage[] = [
    {
      url: 'https://textbolt.com/pricing/',
      title: 'Pricing',
      kind: 'rewrite',
      liveSince: '2026-09-01T00:00:00.000Z',
      indexed: true
    },
    {
      url: 'https://www.textbolt.com/new-guide',
      title: 'Guide',
      kind: 'new',
      liveSince: '2026-10-13T00:00:00.000Z',
      indexed: false
    },
    {
      url: 'https://textbolt.com/old',
      title: 'Old',
      kind: 'new',
      liveSince: '2026-09-20T00:00:00.000Z',
      indexed: true
    },
    {
      url: 'https://textbolt.com/lost',
      title: 'Lost',
      kind: 'rewrite',
      liveSince: '2026-09-02T00:00:00.000Z',
      indexed: null
    }
  ]
  const lostRow = (id: string, before: boolean): MetricRow[] => [
    row(id, C1, before ? 'target' : 'not_cited', {
      citedUrl: before ? 'https://textbolt.com/lost' : null
    }),
    row(id, C2, 'not_cited', { citedUrl: null })
  ]
  const rows: MetricRow[] = [
    ...pageRows(),
    row('g1', C1, 'not_cited', { citedUrl: null }),
    row('g1', C2, 'target', { citedUrl: 'https://textbolt.com/new-guide/' }),
    ...lostRow('l1', true),
    ...lostRow('l2', true),
    ...lostRow('l3', true)
  ]
  const result = computeMetrics(input(rows, { pages }))

  test('each page before → after, keyed by the page whatever its form', () => {
    const pricing = result.pages.rows.find((item) => item.title === 'Pricing')
    // q2 (other) and q3 (target) cited /pricing before; q1, q2 and q7 now.
    expect(pricing?.cited.before?.ids).toEqual(['q2@c1', 'q3@c1'])
    expect(pricing?.cited.after?.ids).toEqual(['q1@c2', 'q2@c2'])
    expect(pricing?.cited.now.ids).toEqual(['q1@c2', 'q2@c2', 'q7@c2'])
    expect(pricing?.daysLive).toBe(44)
    const guide = result.pages.rows.find((item) => item.title === 'Guide')
    expect(guide?.cited.now.ids).toEqual(['g1@c2'])
    expect(guide).toMatchObject({ kind: 'new', daysLive: 2, indexed: false, status: 'cited' })
  })

  test('the Fixes screen’s status rule: lost ground, cited, too new, not cited yet', () => {
    const status = new Map(result.pages.rows.map((item) => [item.title, item.status]))
    expect(status.get('Lost')).toBe('lost')
    expect(status.get('Pricing')).toBe('cited')
    expect(status.get('Old')).toBe('not_cited')
    expect(result.pages.lostGround.ids).toEqual(['https://textbolt.com/lost'])
    expect(result.pages.notIndexed.ids).toEqual(['https://www.textbolt.com/new-guide'])
    expect(result.pages.published.n).toBe(4)
    expect(result.pages.newPages.n).toBe(2)
    expect(result.pages.rewrites.n).toBe(2)
    expect(result.pages.citedNow.n).toBe(2)
  })

  test('groups: cited questions by the kind of page cited', () => {
    const group = new Map(result.pages.groups.map((item) => [item.kind, item.cited]))
    expect(group.get('new')?.now.ids).toEqual(['g1@c2'])
    expect(group.get('rewrite')?.before?.ids).toEqual(['q2@c1', 'q3@c1', 'l1@c1', 'l2@c1', 'l3@c1'])
    const total = ['new', 'rewrite', 'other'].reduce(
      (sum, kind) => sum + (group.get(kind as 'new')?.now.n ?? 0),
      0
    )
    expect(total).toBe(result.now.cited.n)
  })

  test('speed: published pages by days live, with the questions citing them now', () => {
    const speed = new Map(result.pages.speed.map((item) => [item.id, item]))
    expect(speed.get('0-3')?.pages.ids).toEqual(['https://www.textbolt.com/new-guide'])
    expect(speed.get('0-3')?.citedPages.n).toBe(1)
    expect(speed.get('0-3')?.questions.ids).toEqual(['g1@c2'])
    expect(speed.get('14+')?.pages.n).toBe(3)
    expect(speed.get('14+')?.questions.ids).toEqual(['q1@c2', 'q2@c2', 'q7@c2'])
  })

  test('a page an answer cites but nobody logged is listed, with no facts', () => {
    const extra = computeMetrics(
      input([row('x', C2, 'other', { citedUrl: 'https://textbolt.com/blog/x' })], { pages })
    )
    const blog = extra.pages.rows.find((item) => item.url === 'https://textbolt.com/blog/x')
    expect(blog).toMatchObject({ kind: null, liveSince: null, status: 'cited' })
    expect(extra.pages.published.n).toBe(4)
  })
})

describe('history', () => {
  const rows = [
    row('h', C1, 'not_cited'),
    row('h', C2, 'other'),
    row('h', C3, 'target'),
    row('k', C3, 'no_answer', { sourceId: 'p2' })
  ]

  test('each question’s checks inside the window, oldest first', () => {
    const previous = computeMetrics(input(rows))
    const h = previous.history.find((item) => item.questionId === 'h')
    expect(h?.points.map((point) => point.result)).toEqual(['other', 'target'])
    const all = computeMetrics(input(rows, { window: { from: null, to: null } }))
    expect(
      all.history.find((item) => item.questionId === 'h')?.points.map((p) => p.checkId)
    ).toEqual(['c1', 'c2', 'c3'])
    const since = computeMetrics(input(rows, { window: { from: C1, to: C2 } }))
    expect(
      since.history.find((item) => item.questionId === 'h')?.points.map((p) => p.rowId)
    ).toEqual(['h@c1', 'h@c2'])
    expect(previous.history.find((item) => item.questionId === 'k')?.points).toHaveLength(1)
  })
})

describe('every number drills', () => {
  const pages: MetricPage[] = [
    {
      url: 'https://textbolt.com/pricing',
      title: 'Pricing',
      kind: 'new',
      liveSince: C1,
      indexed: false
    }
  ]
  const variants: [string, Partial<MetricsInput>][] = [
    ['previous', {}],
    ['latest only', { window: { from: null, to: null } }],
    ['a time window', { window: { from: C1, to: C2 } }],
    ['one engine', { engine: 'google_aio' }],
    ['one page', { scope: { kind: 'page', id: 'p1' } }],
    ['an empty scope', { scope: { kind: 'topic', id: 'none' } }]
  ]
  for (const [name, extra] of variants) {
    test(`count === rows for ${name}`, () => {
      const result = computeMetrics(input(pageRows(), { pages, ...extra }))
      expect(expectEveryCountDrills(result)).toBeGreaterThan(40)
    })
  }
})
