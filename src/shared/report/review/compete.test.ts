import { describe, expect, it } from 'vitest'
import { donutChart } from '../../charts'
import { computeMetrics } from '../../metrics/compute'
import type { MetricRow, MetricsResult } from '../../metrics/types'
import { buildReport } from './build'
import { sovChart } from './compete-charts'
import { EMPTY_EXTRAS } from './extras'
import { sampleContext, samplePages, sampleRows } from './sample.test-helper'
import { changeTabs, drawerStrip, inChangeTab, positionMove, searchReport } from './search'

/** Sample rows with each other site's source position: reddit #2, twilio #3, … in order. */
function rowsWithPositions(): MetricRow[] {
  return sampleRows().map((row) => ({
    ...row,
    sitePositions: Object.fromEntries(row.domains.map((domain, index) => [domain, index + 2]))
  }))
}

function metrics(
  from: string | null = '2026-09-16T15:00:00.000Z',
  engine: 'all' | 'google_aio' = 'all'
): MetricsResult {
  return computeMetrics({
    rows: rowsWithPositions(),
    pages: samplePages(),
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine,
    window: { from, to: null }
  })
}

const EXTRAS = {
  ...EMPTY_EXTRAS,
  siteKinds: { 'twilio.com': 'competitors', 'simpletexting.com': 'competitors' } as const,
  questionTargets: {
    'topic-1|q1': ['https://textbolt.com/email-to-sms-outlook', 'https://textbolt.com/features'],
    'topic-1|q3': ['https://textbolt.com/pricing']
  }
}

describe('Competitors tab model', () => {
  const report = buildReport(metrics(null, 'google_aio'), sampleContext('visibility'), EXTRAS)
  const c = report.competition

  it('five tiles; the rival and the gap drill to their questions', () => {
    expect(c.tiles.map((tile) => tile.label)).toEqual([
      'Other sites cited',
      'Your reach',
      expect.stringMatching(/^Most-cited rival, \d+ questions?$/),
      'Their lead, in questions',
      'Gap questions'
    ])
    const rival = c.sites.find((site) => !site.own)
    expect(c.tiles[2]?.value).toBe(rival?.domain)
    expect(report.drills[c.tiles[2]?.drill ?? '']?.ids).toHaveLength(rival?.now.n ?? -1)
    const gap = report.drills['cmp:gap']
    expect(gap?.ids.length).toBe(Number(c.tiles[4]?.value))
  })

  it('every site: rank, kind, with you + gap add up to now, average position', () => {
    expect(c.sites.map((site) => site.rank)).toEqual(c.sites.map((_, index) => index + 1))
    for (let index = 1; index < c.sites.length; index += 1) {
      expect(c.sites[index - 1]!.now.n).toBeGreaterThanOrEqual(c.sites[index]!.now.n)
    }
    const own = c.sites.find((site) => site.own)
    expect(own).toMatchObject({ kind: null, kindLabel: 'You', withYou: null, gap: null })
    const twilio = c.sites.find((site) => site.domain === 'twilio.com')
    expect(twilio?.kind).toBe('competitors')
    expect(c.sites.find((site) => site.domain === 'reddit.com')?.kind).toBe('video_social')
    for (const site of c.sites.filter((item) => !item.own)) {
      expect((site.withYou?.n ?? 0) + (site.gap?.n ?? 0), site.domain).toBe(site.now.n)
      expect(site.positionNow, site.domain).not.toBeNull()
    }
    // reddit.com is always listed first among the answer's sites: source #2.
    expect(c.sites.find((site) => site.domain === 'reddit.com')?.positionNow).toBe(2)
    // Your own average position reads your cited rows.
    expect(own?.positionNow).toBeGreaterThan(0)
  })

  it('kinds of site sum the sites in each kind', () => {
    const competitors = c.kinds.find((row) => row.kind === 'competitors')
    const sum = c.sites
      .filter((site) => site.kind === 'competitors')
      .reduce((total, site) => total + site.now.n, 0)
    expect(competitors?.now).toBe(sum)
    expect(competitors?.sites).toBe(2)
    expect(c.namedCompetitors).toBe(2)
  })

  it('share of voice adds up to the answers shown and draws as a ring', () => {
    const sov = c.sov
    expect(sov).not.toBeNull()
    if (sov === null) return
    expect(sov.you.n + sov.competitor.n + sov.others.n + sov.none.n).toBe(sov.total.n)
    expect(sov.total.n).toBe(report.standing.funnel[1]?.value)
    const ring = donutChart({ ...sovChart(report), width: 520, titles: true })
    expect(ring.marks).toBe(
      [sov.you, sov.competitor, sov.others, sov.none].filter((p) => p.n > 0).length
    )
    expect(ring.svg).toContain('Named competitors')
  })

  it('without another site: no tiles, so the tab says what it needs', () => {
    const empty = computeMetrics({
      rows: rowsWithPositions().map((row) => ({ ...row, domains: [], sitePositions: {} })),
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'google_aio',
      window: { from: null, to: null }
    })
    expect(buildReport(empty, sampleContext('visibility'), EXTRAS).competition.tiles).toEqual([])
  })
})

describe('Questions and drawers', () => {
  const report = buildReport(metrics(), sampleContext('impact'), EXTRAS)
  const q1 = Object.values(report.questionsById).find((item) => item.text.startsWith('Question 1:'))

  it('questions carry target pages, cited-through pages, named and positions at both ends', () => {
    expect(q1?.targets).toEqual([
      'https://textbolt.com/email-to-sms-outlook',
      'https://textbolt.com/features'
    ])
    expect(q1).toMatchObject({ pageBefore: null, positionBefore: null, change: 'gained' })
    expect(q1?.pageNow).toBe('https://textbolt.com/email-to-sms-outlook')
    expect(q1?.namedNow).toBe(false)
    expect(positionMove(3, 1)).toEqual({ tone: 'up', text: '▲ 2' })
    expect(positionMove(1, 4)).toEqual({ tone: 'down', text: '▼ 3' })
    expect(positionMove(null, 1)).toBeNull()
  })

  it('the drawer strip and change tabs count the same rows', () => {
    const rows = Object.values(report.questionsById)
    const strip = drawerStrip(rows)
    expect(strip.questions).toBe(rows.length)
    expect(strip.gap).toBe(strip.answered - strip.cited)
    const tabs = changeTabs(rows)
    expect(tabs.map((tab) => tab.id)).toEqual(['all', 'gained', 'kept', 'lost', 'notcited'])
    const sum = tabs.slice(1).reduce((total, tab) => total + tab.count, 0)
    expect(sum).toBe(rows.filter((row) => row.change !== null).length)
    expect(inChangeTab('noanswer', 'notcited')).toBe(true)
    const single = buildReport(metrics(null), sampleContext('visibility'), EXTRAS)
    expect(changeTabs(Object.values(single.questionsById))).toEqual([])
  })

  it('the report-wide search finds questions, sites and pages', () => {
    const found = searchReport(report, 'twilio')
    expect(found.sites.map((site) => site.domain)).toEqual(['twilio.com'])
    expect(searchReport(report, 'pricing').pages.map((page) => page.path)).toContain('/pricing')
    expect(searchReport(report, 'question 12').questions).toHaveLength(1)
    expect(searchReport(report, '   ').total).toBe(0)
  })

  it('the history strip shows named-not-cited squares and positions', () => {
    const cells = report.changed.movers.flatMap((mover) => mover.cells)
    expect(cells.some((cell) => cell.state === 'named')).toBe(true)
    expect(cells.some((cell) => cell.position !== null)).toBe(true)
  })
})
