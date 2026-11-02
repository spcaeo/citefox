import { describe, expect, it } from 'vitest'
import { computeMetrics } from '../../metrics/compute'
import type { MetricRow } from '../../metrics/types'
import { buildReport } from './build'
import { EMPTY_EXTRAS, type PageChangeNote, type ReportExtras } from './extras'
import { partsText } from './figures'
import { namedEnds, namedMovement, pointsText, sharePercent, splitTenths } from './named'
import { sampleContext, sampleMetrics, samplePages, sampleRows } from './sample.test-helper'
import type { Num, ReviewReport } from './types'

/**
 * What changed (Docs/REPORT-SPEC.md "What changed") on the two-check sample: Google, Sep
 * 16 → Oct 28. Hand-counted from sample.test-helper.ts: 12 questions compared; q1 q2 q9
 * q11 gained, q4 q5 q6 lost; the brand is named in answers to even-numbered questions.
 */

const SITE = 'https://textbolt.com'
const FEATURES = `${SITE}/features`

function nums(report: ReviewReport): { path: string; num: Num }[] {
  const out: { path: string; num: Num }[] = []
  const walk = (value: unknown, path: string): void => {
    if (path === '.drills' || value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.n === 'number' && typeof record.drill === 'string') {
      out.push({ path, num: record as unknown as Num })
      return
    }
    for (const [key, item] of Object.entries(record)) walk(item, `${path}.${key}`)
  }
  walk(report, '')
  return out
}

const change: PageChangeNote = {
  url: FEATURES,
  changedAt: '2026-10-20T10:00:00.000Z',
  sectionsAdded: 2,
  sectionsRemoved: 0,
  headingsChanged: 1,
  textChanged: 0,
  sections: ['Pricing'],
  wordsBefore: 900,
  wordsAfter: 1200
}

const target = (q: string): [string, string[]][] =>
  ['c1', 'c2', 'c3'].map((check) => [`google_aio:${check}:${q}`, [FEATURES]])

const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  targets: Object.fromEntries(['q4', 'q5', 'q6', 'q11'].flatMap(target)),
  pageChanges: { [FEATURES]: [change] },
  blocks: {
    'google_aio:c1:q1': ['A1', 'C4'],
    'google_aio:c3:q1': ['C4', 'A1', 'D2'],
    'google_aio:c1:q3': ['B3'],
    'google_aio:c3:q3': ['B3']
  },
  blockLabels: {
    A1: 'What / Definition',
    B3: 'Commercial / Pricing',
    C4: 'How / Procedural',
    D2: 'Risks / Limitations'
  }
}

describe('Brand named helpers', () => {
  const metrics = sampleMetrics({ engine: 'google_aio' })

  it('counts named answers and their share of AI answers at both ends', () => {
    const ends = namedEnds(metrics)
    // Sep 16: q4 q6 q8 q12 of 9 answers. Oct 28: q2 q4 q6 q8 q10 q12 of 11.
    expect(ends.before?.n).toBe(4)
    expect(ends.now.n).toBe(6)
    expect(sharePercent(ends.shareBefore)).toBe('44%')
    expect(sharePercent(ends.shareNow)).toBe('55%')
    const move = namedMovement(metrics)
    expect(move.newly.ids.map((id) => id.split(':').at(-1))).toEqual(['q2', 'q10'])
    expect(move.noLonger.n).toBe(0)
  })

  it('splits a change into market and your work that add up exactly', () => {
    // +2 named: (11 − 9) answers at the old 4/9 share is 0.9; your work is the other 1.1.
    expect(splitTenths(4, 6, 9, 11)).toEqual({ marketTenths: 9, workTenths: 11 })
    expect(pointsText(10)).toBe('+10 pts')
    expect(pointsText(-2.5)).toBe('−2.5 pts')
  })
})

describe('What changed model', () => {
  const report = buildReport(
    sampleMetrics({ engine: 'google_aio' }),
    { ...sampleContext('changed'), engineLabel: 'Google AI Overview' },
    EXTRAS
  )

  it('every number opens exactly its list, and every listed question resolves', () => {
    for (const { path, num } of nums(report)) {
      expect(report.drills[num.drill]?.ids.length, path).toBe(num.n)
    }
    for (const [id, drill] of Object.entries(report.drills)) {
      for (const item of drill.ids) {
        const known = drill.kind === 'pages' ? report.pagesByUrl[item] : report.questionsById[item]
        expect(known, `${id} → ${item}`).toBeDefined()
      }
    }
  })

  it('adds Your pages and Published pages to the report', () => {
    const ids = report.sections.map((section) => section.id)
    expect(ids).toContain('pages')
    expect(ids).toContain('published')
    expect(ids[0]).toBe('verdict')
  })

  it('leads with a Brand named tile and a split table for citing and named', () => {
    const named = report.verdict.kpis.find((kpi) => kpi.label === 'Brand named')
    expect(named).toMatchObject({ now: '6', before: '4', trend: 'up' })
    expect(named?.note).toBe('44% → 55% of AI answers')
    const [cited, brand] = report.named.splitRows
    expect(cited).toMatchObject({ key: 'cited', change: 1 })
    expect(brand).toMatchObject({ key: 'named', change: 2, marketTenths: 9, workTenths: 11 })
    for (const row of report.named.splitRows) {
      expect(row.marketTenths + row.workTenths).toBe(row.change * 10)
    }
    expect(report.named.tiles.map((tile) => [tile.label, tile.value])).toEqual([
      ['Newly named', '+2'],
      ['No longer named', '0']
    ])
  })

  it('gives each Topics lens its named share before → now', () => {
    const basics = report.named.lenses.topic['Email to SMS basics']
    // Before: q4 q6 named of 5 answers; now q2 q4 q6 of 6.
    expect(basics).toMatchObject({ shareBefore: 0.4, shareNow: 0.5, change: 10 })
    expect(basics?.now.n).toBe(3)
    for (const row of report.topics.lenses.topic) {
      expect(report.named.lenses.topic[row.value], row.value).toBeDefined()
    }
  })

  it('shows the cover strip and what the comparison covers', () => {
    const { cover, coverage } = report.whatChanged
    expect(cover).toMatchObject({ fromLabel: 'Sep 16', toLabel: 'Oct 28', inScope: 12 })
    expect(cover.compared.n).toBe(12)
    expect(cover.answersFrom?.n).toBe(9)
    expect(cover.answersTo.n).toBe(11)
    expect(cover.line).toBe('Every number covers the 12 questions checked on both dates.')
    expect(coverage).toMatchObject({ percent: 100, nothingLeftOut: true })
    expect(coverage.footer).toBe('12 compared of 12 in scope (100%)')
    expect(report.whatChanged.waiting).toBeNull()
  })

  it('splits questions not compared into new, no longer checked and failed', () => {
    // From Sep 30: q11's search failed then; q13 is first checked on Oct 28.
    const q12 = sampleRows().find((row) => row.id === 'google_aio:c3:q12') as MetricRow
    const rows = [
      ...sampleRows(),
      { ...q12, id: 'google_aio:c3:q13', questionId: 'topic-1|q13', text: 'Question 13' }
    ]
    const metrics = computeMetrics({
      rows,
      pages: samplePages(),
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'google_aio',
      window: { from: '2026-09-30T15:00:00.000Z', to: null }
    })
    const r = buildReport(metrics, sampleContext('changed'), EMPTY_EXTRAS)
    const cov = r.whatChanged.coverage
    expect(cov.failed.n).toBe(1)
    expect(cov.newSince.n).toBe(1)
    expect(cov.noLonger.n).toBe(0)
    expect(cov.nothingLeftOut).toBe(false)
    expect(cov.inScope).toBe(13)
    expect(cov.percent).toBe(85)
    expect(r.whatChanged.cover.line).toBe(
      'Every number covers the 11 questions checked on both dates.'
    )
  })

  it('lists the four movements separately', () => {
    const lists = Object.fromEntries(
      report.whatChanged.lists.map((list) => [
        list.id,
        list.items.map((item) => item.id.split(':').at(-1))
      ])
    )
    expect(lists).toEqual({
      gained: ['q1', 'q2', 'q9', 'q11'],
      lost: ['q4', 'q5', 'q6'],
      named: ['q2', 'q10'],
      unnamed: []
    })
  })

  it('names the drivers and starts the next steps with the win-back list', () => {
    const { drivers } = report.whatChanged
    expect(drivers.position).toMatchObject({ before: 2.2, now: 2 })
    expect(drivers.winBack.n).toBe(3)
    if (drivers.gainer) {
      expect(drivers.gainer.change).toBeGreaterThan(0)
      expect(drivers.gainer.nowNum.n - drivers.gainer.beforeNum.n).toBe(drivers.gainer.change)
    }
    if (drivers.loser) expect(drivers.loser.change).toBeLessThan(0)
    const leads = report.verdict.findings.map((finding) => finding.lead)
    expect(leads).toContain('You sit higher among the sources.')
    expect(report.verdict.next[0]?.lead).toBe('Win back 3 questions that stopped citing you.')
    expect(partsText(report.verdict.next[0]?.parts ?? [])).toContain('cited you on Sep 16')
  })

  it("compares changed pages' target questions with the rest", () => {
    const { rows, compare } = report.whatChanged.pages
    const features = rows.find((row) => row.page.url === FEATURES)
    expect(features).toMatchObject({ daysBefore: 8, tooRecent: true })
    expect(features?.size).toBe('2 new sections, 1 heading reworded, 900 → 1,200 words.')
    expect(features?.targets.n).toBe(4)
    expect(features?.citedBefore?.n).toBe(3)
    expect(features?.citedNow.n).toBe(1)
    const outlook = rows.find((row) => row.page.path === '/email-to-sms-outlook')
    expect(outlook).toMatchObject({ daysBefore: 26, tooRecent: false, size: null })
    expect(compare?.changed).toMatchObject({ shareBefore: 0.75, shareNow: 0.25 })
    expect(compare?.changed.questions.n).toBe(4)
    expect(compare?.rest).toMatchObject({ shareBefore: 2 / 8, shareNow: 5 / 8 })
  })

  it('compares answer blocks in plain names', () => {
    const s = report.whatChanged.structure
    expect(s?.analysed.n).toBe(2)
    expect(s?.changedOpener.n).toBe(1)
    expect(s?.changedShape.n).toBe(1)
    expect(s?.blocks[0]).toMatchObject({ label: 'Risks / Limitations', before: 0, now: 1 })
    expect(s?.changes[0]).toMatchObject({
      before: 'What / Definition → How / Procedural',
      after: 'How / Procedural → What / Definition → Risks / Limitations',
      opener: true
    })
  })

  it('lists questions no longer named', () => {
    const rows: MetricRow[] = sampleRows().map((row) =>
      row.id === 'google_aio:c3:q12' ? { ...row, named: false } : row
    )
    const metrics = computeMetrics({
      rows,
      pages: samplePages(),
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'google_aio',
      window: { from: '2026-09-16T15:00:00.000Z', to: null }
    })
    const r = buildReport(metrics, sampleContext('changed'), EMPTY_EXTRAS)
    expect(r.named.noLonger.n).toBe(1)
    expect(r.whatChanged.lists.find((list) => list.id === 'unnamed')?.items[0]?.id).toBe(
      'google_aio:c3:q12'
    )
  })
})

describe('What changed with one check', () => {
  const rows = sampleRows().filter((row) => row.checkId === 'c1')
  const metrics = computeMetrics({
    rows,
    pages: samplePages(),
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine: 'all',
    window: { from: '2026-09-16T15:00:00.000Z', to: null }
  })

  it('shows one panel that says it needs a second check, with the next check', () => {
    const report = buildReport(metrics, sampleContext('changed'), {
      ...EMPTY_EXTRAS,
      nextCheckAt: '2026-09-30T15:00:00.000Z',
      intervalDays: 14
    })
    expect(report.sections.map((section) => section.id)).toEqual(['changed'])
    expect(report.whatChanged.waiting).toMatchObject({
      title: 'What changed needs a second check',
      next: 'Next check on Sep 30, then every 14 days.'
    })
    expect(report.whatChanged.waiting?.line).toContain('only one check so far (Sep 16)')
  })

  it('keeps every section of the other reports', () => {
    const impact = buildReport(metrics, sampleContext('impact'), EMPTY_EXTRAS)
    expect(impact.sections.length).toBeGreaterThan(5)
    expect(impact.whatChanged.waiting).not.toBeNull()
  })
})
