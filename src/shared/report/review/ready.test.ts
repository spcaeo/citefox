import { describe, expect, test } from 'vitest'
import { computeMetrics } from '../../metrics/compute'
import type { MetricsResult } from '../../metrics/types'
import { buildReport, REPORT_SECTIONS } from './build'
import { EMPTY_EXTRAS, type ReportExtras } from './extras'
import { sampleContext, sampleMetrics, samplePages, sampleRows } from './sample.test-helper'
import { EMPTY_ANSWER_EXTRAS } from './sources-types'
import type { Num, Part, ReportKind, ReviewReport } from './types'
import { EMPTY_VISIBILITY } from './visibility-extras'
import type { ContentRow } from './ready-types'

/**
 * The short ready reports (ready.ts): Pitch / audit, Content plan and Head-to-head. Each
 * works from one check, says what it needs with none, keeps to seven tabs, and every
 * number opens a list of exactly that size.
 */

const SITE = 'https://textbolt.com'

function oneCheck(engine: 'all' | 'google_aio' = 'google_aio'): MetricsResult {
  return computeMetrics({
    rows: sampleRows().filter((row) => row.checkId === 'c3'),
    pages: samplePages(),
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine,
    window: { from: null, to: null }
  })
}

function empty(): MetricsResult {
  return computeMetrics({
    rows: [],
    pages: [],
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine: 'all',
    window: { from: null, to: null }
  })
}

function build(
  kind: ReportKind,
  metrics: MetricsResult,
  extras: ReportExtras = EMPTY_EXTRAS,
  rival?: string
): ReviewReport {
  return buildReport(metrics, { ...sampleContext(kind), ...(rival ? { rival } : {}) }, extras)
}

function expectCounted(report: ReviewReport, num: Num): void {
  expect(report.drills[num.drill]?.ids.length).toBe(num.n)
}

function nums(parts: readonly Part[]): Num[] {
  return parts.filter((part): part is Num => typeof part !== 'string')
}

describe('every short report', () => {
  test('keeps to seven tabs or fewer', () => {
    for (const kind of ['pitch', 'content', 'rival'] as const) {
      expect(REPORT_SECTIONS[kind].length).toBeLessThanOrEqual(7)
    }
  })

  test('works from one check: no "needs" panel', () => {
    for (const kind of ['pitch', 'content', 'rival'] as const) {
      const report = build(kind, oneCheck())
      expect(report.needs).toBeNull()
      expect(report.sections.map((s) => s.id)).toEqual(REPORT_SECTIONS[kind])
    }
  })

  test('an empty project says what each needs, never zeros', () => {
    for (const kind of ['pitch', 'content', 'rival'] as const) {
      const report = build(kind, empty())
      expect(report.needs?.items[0]?.text).toContain('first check')
      const first = report.sections[0]
      expect(first?.empty).toBeTruthy()
    }
    expect(build('pitch', empty()).ready.pitch.plan).toEqual([])
    expect(build('content', empty()).ready.content.groups).toEqual([])
    expect(build('rival', empty()).ready.rival.domain).toBeNull()
  })
})

describe('Pitch / audit', () => {
  test('four tiles, the top five sites and up to five numbered steps with live numbers', () => {
    const report = build('pitch', oneCheck())
    const pitch = report.ready.pitch
    expect(pitch.kpis.map((kpi) => kpi.label)).toEqual([
      'Show an AI answer',
      'Cite your pages',
      'Name your brand',
      'Answer without you'
    ])
    expect(pitch.kpiNotes).toHaveLength(4)
    expect(pitch.sites.length).toBeLessThanOrEqual(5)
    expect(pitch.sites).toEqual(report.competition.sites.slice(0, 5))
    expect(pitch.plan.length).toBeGreaterThan(0)
    expect(pitch.plan.length).toBeLessThanOrEqual(5)
    for (const step of pitch.plan) {
      const list = nums(step.parts)
      expect(list.length).toBeGreaterThan(0)
      for (const num of list) expectCounted(report, num)
    }
    // q3 and q9 cite /pricing, not the page set: the wrong-page step comes first.
    expect(pitch.plan[0]?.lead).toContain('right page')
    expect(nums(pitch.plan[0]?.parts ?? [])[0]?.n).toBe(2)
    // Competitors to beat never include Reddit.
    expect(pitch.plan.some((step) => step.lead.includes('reddit'))).toBe(false)
  })
})

describe('Content plan', () => {
  const extras: ReportExtras = {
    ...EMPTY_EXTRAS,
    questionTargets: {
      'topic-1|q3': [`${SITE}/plans`],
      'topic-1|q9': [`${SITE}/plans`],
      'topic-1|q4': [`${SITE}/features`]
    },
    aiPages: { 'topic-1|q5': `${SITE}/guide` },
    answers: {
      ...EMPTY_ANSWER_EXTRAS,
      blocks: { 'google_aio:c3:q4': ['A1', 'C4'] }
    }
  }

  test('one row per answer without the right page, grouped by topic, with page, shape and sites', () => {
    const report = build('content', oneCheck(), extras)
    const plan = report.ready.content
    const rows = plan.groups.flatMap((group) => group.rows)
    const ids = rows.map((row) => row.question.id).sort()
    // Not cited with an answer: q4, q5, q6, q8, q10. Wrong page: q3, q9. No answer (q7) is left out.
    expect(ids).toEqual(
      ['q10', 'q3', 'q4', 'q5', 'q6', 'q8', 'q9'].map((q) => `google_aio:c3:${q}`).sort()
    )
    expectCounted(report, plan.total)
    expect(plan.total.n).toBe(7)
    for (const group of plan.groups) {
      expectCounted(report, group.questions)
      expect(group.rows.every((row) => row.question.topic === group.topic)).toBe(true)
    }
    for (const tile of plan.tiles) {
      expect(String(report.drills[tile.drill ?? '']?.ids.length)).toBe(tile.value)
    }
    const byQ = (q: string): ContentRow =>
      rows.find((row) => row.question.id === `google_aio:c3:${q}`)!
    expect(byQ('q3')).toMatchObject({
      reason: 'wrongpage',
      page: `${SITE}/plans`,
      pageSource: 'primary'
    })
    expect(byQ('q5')).toMatchObject({ reason: 'notcited', page: `${SITE}/guide`, pageSource: 'ai' })
    expect(byQ('q6')).toMatchObject({ page: null, pageSource: 'new', pageLabel: 'New page' })
    // q4's own answer was read: its blocks, in order.
    expect(byQ('q4').shape).toMatchObject({ own: true })
    expect(byQ('q4').shape?.outline).toHaveLength(2)
    expect(byQ('q4').sites).toEqual(['twilio.com', 'simpletexting.com'])
    // Other questions follow the most common shape.
    expect(byQ('q6').shape?.own).toBe(false)
    const brief = byQ('q4').brief
    expect(brief).toContain(byQ('q4').question.text)
    expect(brief).toContain(`Page: ${SITE}/features (Primary page)`)
    expect(brief).toContain('Sites to beat: twilio.com, simpletexting.com')
    expect(brief.indexOf('1. ')).toBeLessThan(brief.indexOf('2. '))
    // Wrong page rows come first in their topic.
    const pricing = plan.groups.find((group) => group.topic === 'Pricing')!
    expect(pricing.rows.every((row) => row.reason === 'wrongpage')).toBe(true)
  })

  test('without stored answers the shape says so (null), not a guess', () => {
    const report = build('content', oneCheck())
    const rows = report.ready.content.groups.flatMap((group) => group.rows)
    expect(rows.every((row) => row.shape === null)).toBe(true)
  })
})

describe('Head-to-head', () => {
  test('defaults to the top competitor, never Reddit', () => {
    const report = build('rival', oneCheck())
    const rival = report.ready.rival
    expect(rival.domain).not.toBeNull()
    expect(rival.options).not.toContain('reddit.com')
    expect(rival.domain).toBe(rival.options[0])
  })

  test('the tiles add up and every row has a winner', () => {
    const report = build('rival', oneCheck(), EMPTY_EXTRAS, 'twilio.com')
    const rival = report.ready.rival
    expect(rival.domain).toBe('twilio.com')
    const [them, you, both, gap, onlyYou] = rival.tiles.map((tile) => {
      const n = report.drills[tile.drill ?? '']?.ids.length ?? -1
      expect(String(n)).toBe(tile.value)
      return n
    })
    expect(them).toBe((both ?? 0) + (gap ?? 0))
    expect(you).toBe((both ?? 0) + (onlyYou ?? 0))
    expect(rival.rows.length).toBe((them ?? 0) + (onlyYou ?? 0))
    expect(rival.rows[0]?.winner).toBe('them')
    for (const row of rival.rows) {
      if (row.theirsCited && !row.yoursCited) expect(row.winner).toBe('them')
      if (row.yoursCited && !row.theirsCited) expect(row.winner).toBe('you')
    }
    expect(rival.pagesNote).toContain('stored AI answers')
    expect(rival.brandsNote).toBeTruthy()
  })

  test('their cited pages and how AI describes each brand', () => {
    const extras: ReportExtras = {
      ...EMPTY_EXTRAS,
      answers: {
        ...EMPTY_ANSWER_EXTRAS,
        citations: {
          'google_aio:c3:q4': [
            {
              url: 'https://www.twilio.com/docs/sms',
              domain: 'twilio.com',
              title: 'SMS docs',
              who: 'competitor',
              type: 'web'
            }
          ]
        }
      },
      visibility: {
        ...EMPTY_VISIBILITY,
        reputation: {
          brand: 'TextBolt',
          answers: 9,
          read: 9,
          claims: { positive: 1, neutral: 0, negative: 0 },
          rows: [],
          issues: [],
          trend: [],
          themes: [],
          brands: [
            {
              brand: 'TextBolt',
              own: true,
              rowIds: ['google_aio:c3:q2'],
              first: 1,
              positive: 1,
              neutral: 0,
              negative: 0
            },
            {
              brand: 'Twilio',
              own: false,
              rowIds: ['google_aio:c3:q4'],
              first: 1,
              positive: 0,
              neutral: 1,
              negative: 0
            },
            {
              brand: 'Zapier',
              own: false,
              rowIds: ['google_aio:c3:q5'],
              first: 0,
              positive: 0,
              neutral: 1,
              negative: 0
            }
          ]
        }
      }
    }
    const report = build('rival', oneCheck(), extras, 'twilio.com')
    const rival = report.ready.rival
    expect(rival.pages.map((page) => page.url)).toEqual(['https://www.twilio.com/docs/sms'])
    expectCounted(report, rival.pages[0]!.questions)
    expect(rival.brands.map((brand) => brand.brand)).toEqual(['TextBolt', 'Twilio'])
    expect(rival.brandsNote).toBeNull()
  })

  test('a rival the answers never cite still builds, with zeros that open empty lists', () => {
    const report = build('rival', sampleMetrics({ from: null }), EMPTY_EXTRAS, 'nobody.example')
    const rival = report.ready.rival
    expect(rival.domain).toBe('nobody.example')
    expect(rival.options[0]).toBe('nobody.example')
    expect(rival.tiles[0]?.value).toBe('0')
  })
})
