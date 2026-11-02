import { describe, expect, it } from 'vitest'
import { computeMetrics } from '../../metrics/compute'
import type { MetricsResult } from '../../metrics/types'
import { buildReport } from './build'
import { EMPTY_EXTRAS, type ReportExtras } from './extras'
import { partsText } from './figures'
import { outlineDiff } from './impact-asks'
import { pageStory } from './page-story'
import { sampleContext, sampleMetrics, sampleRows } from './sample.test-helper'
import type { Num, Part, ReportKind, ReviewReport } from './types'

/** Today's real data: one check, no fixes logged. */
function littleMetrics(): MetricsResult {
  return computeMetrics({
    rows: sampleRows().filter((row) => row.checkId === 'c3'),
    pages: [],
    ownDomain: 'textbolt.com',
    scope: { kind: 'project' },
    marketId: null,
    engine: 'all',
    window: { from: '2026-10-28T15:00:00.000Z', to: null }
  })
}

const OUTLINES: ReportExtras = {
  ...EMPTY_EXTRAS,
  nextCheckAt: '2026-11-11T15:00:00.000Z',
  intervalDays: 14,
  changes: {
    'https://textbolt.com/features': {
      url: 'https://textbolt.com/features',
      changedAt: '2026-10-10T00:00:00.000Z',
      sectionsAdded: 1,
      sectionsRemoved: 1,
      headingsChanged: 0,
      textChanged: 0,
      sections: ['Pricing'],
      wordsBefore: 1200,
      wordsAfter: 900,
      outlineBefore: [
        { level: 2, text: 'Send email to SMS' },
        { level: 2, text: 'Pricing' }
      ],
      outlineAfter: [
        { level: 2, text: 'Send email to SMS' },
        { level: 3, text: 'New FAQ' }
      ]
    }
  },
  questionsFor: { 'https://textbolt.com/textbolt-for-schools': 4 },
  pageDates: {
    'https://textbolt.com/email-to-sms-outlook': {
      publishedAt: '2026-10-01T00:00:00.000Z',
      modifiedAt: '2026-10-05T00:00:00.000Z'
    }
  }
}

function nums(parts: readonly Part[]): Num[] {
  return parts.filter((part): part is Num => typeof part !== 'string')
}

function expectDrills(report: ReviewReport, list: readonly Num[]): void {
  for (const value of list) expect(report.drills[value.drill]?.ids.length).toBe(value.n)
}

function build(kind: ReportKind, metrics = sampleMetrics(), extras = OUTLINES): ReviewReport {
  return buildReport(metrics, sampleContext(kind), extras)
}

describe('Impact review: intro, proofs and published pages', () => {
  const report = build('impact')

  it('opens Verdict with a lead line, an at-a-glance list and the header meta line', () => {
    const { intro } = report.impact
    expect(partsText(intro.lead)).toContain(
      'are cited on 3 questions on Oct 28, the same as on Sep 16'
    )
    expect(intro.glance.map((item) => item.label)).toEqual([
      'Measured',
      'Questions',
      'Pages published',
      'Where',
      'Measured with'
    ])
    expect(partsText(intro.glance[4]!.value)).toBe('Google AI Overview, ChatGPT')
    expect(intro.meta).toBe('12 questions · 3 pages published · measured Sep 16 and Oct 28')
    expectDrills(
      report,
      intro.glance.flatMap((item) => nums(item.value))
    )
    expect(report.needs).toBeNull()
  })

  it('proves the published pages did it, where the gains came from, and the rank', () => {
    const leads = report.impact.proofs.map((finding) => finding.lead)
    expect(
      leads.some((lead) => lead.includes('published pages') || lead.includes('rest of your site'))
    ).toBe(true)
    const gained = report.impact.proofs.find((finding) =>
      partsText(finding.parts).includes('came through your published pages')
    )
    expect(gained).toBeDefined()
    expect(partsText(gained!.parts)).toMatch(/cite you only because of them/)
    const rank = report.impact.proofs.find((finding) => /cited site/.test(finding.lead))
    expect(rank).toBeDefined()
    for (const finding of report.impact.proofs) expectDrills(report, nums(finding.parts))
  })

  it('adds Brand named and Average position tiles and splits published pages from the site', () => {
    const labels = report.verdict.kpis.map((kpi) => kpi.label)
    expect(labels).toContain('Citing your published pages')
    expect(labels).toContain('Questions citing your site')
    expect(labels).toContain('Brand named')
    const avg = report.verdict.kpis.find((kpi) => kpi.label === 'Average position')
    expect(avg?.lowerIsBetter).toBe(true)
    expect(avg?.now).toMatch(/^\d+\.\d$/)
  })

  it('links each next step to its tab and shows the top 8 sites', () => {
    for (const step of report.verdict.next) expect(step.tab).toBeDefined()
    expect(report.impact.topSites.length).toBeLessThanOrEqual(8)
    expect(report.impact.topSites.some((site) => site.own)).toBe(true)
  })

  it('the setback line says how many questions moved to your other pages', () => {
    const setback = report.verdict.findings.find((finding) => /setback/i.test(finding.lead))
    expect(setback).toBeDefined()
    expectDrills(report, nums(setback!.parts))
  })

  it('builds the new pages / rewrites table, the days-live table and page stats', () => {
    expect(report.impact.kinds.map((row) => row.label)).toEqual(['New pages', 'Rewrites'])
    expectDrills(
      report,
      report.impact.kinds.flatMap((row) => [row.pages, row.cited, row.now, row.first])
    )
    expect(report.impact.days.length).toBeGreaterThan(0)
    expectDrills(
      report,
      report.impact.days.flatMap((row) => [
        row.pages,
        row.cited,
        row.questions,
        row.first,
        row.notIndexed
      ])
    )
    expect(report.impact.pageStats['https://textbolt.com/email-to-sms-outlook']).toMatchObject({
      first: 1,
      avg: 1.5
    })
  })
})

describe('Impact review: page story', () => {
  const report = build('impact')

  it('tells a cited page before → after: tiles, split, timeline, spread, sites, tabs', () => {
    const story = report.impact.stories['https://textbolt.com/email-to-sms-outlook']
    expect(story).toBeDefined()
    expect(story!.tiles.map((tile) => tile.label)).toEqual([
      'Questions citing it',
      'Number-one source',
      'Average position',
      'Brand named'
    ])
    expect(story!.tiles[0]).toMatchObject({ now: '2', before: '0', delta: 2 })
    expect(story!.split).toEqual({ newly: 2, kept: 0, dropped: 0 })
    expect(story!.timeline.map((mark) => mark.label)).toEqual([
      'First measured',
      'Published',
      'Went live',
      'Updated',
      'This check'
    ])
    expect(story!.spread.find((bucket) => bucket.label === '#1')?.now).toBe(1)
    expect(story!.sites.length).toBeGreaterThan(0)
    expect(story!.tabs.now.length).toBe(2)
    expect(story!.waiting).toBeNull()
  })

  it('a page that lost ground lists the dropped questions', () => {
    const story = report.impact.stories['https://textbolt.com/features']
    expect(story!.split.dropped).toBeGreaterThan(0)
    expect(story!.tabs.dropped.length).toBe(story!.split.dropped)
  })

  it('explains why a waiting page is not cited yet and what happens next', () => {
    const story = report.impact.stories['https://textbolt.com/textbolt-for-schools']
    expect(story!.waiting?.map((reason) => reason.reason)).toEqual([
      'notindexed',
      'toonew',
      'nextround',
      'backlinks'
    ])
    expect(story!.waiting?.[2]?.text).toContain('Next check on Nov 11, then every 14 days.')
  })

  it('builds the story of any page of yours, not only published ones', () => {
    const story = pageStory(report, sampleMetrics(), 'https://textbolt.com/pricing', (iso) =>
      iso.slice(0, 10)
    )
    expect(story?.page.published).toBe(false)
    expect(story?.tabs.now.length).toBeGreaterThan(0)
  })
})

describe('Impact review: client asks and method', () => {
  const report = build('impact')

  it('Lost ground: still citing, lost by topic, outline diff and outcomes', () => {
    const more = report.impact.lost['https://textbolt.com/features']
    expect(more).toBeDefined()
    expectDrills(report, [more!.stillCiting, ...more!.byTopic.map((row) => row.num)])
    expect(more!.outline?.before.find((row) => row.text === 'Pricing')?.mark).toBe('dropped')
    expect(more!.outline?.after.find((row) => row.text === 'New FAQ')?.mark).toBe('added')
    expect(Object.values(more!.outcomes).length).toBeGreaterThan(0)
  })

  it('outlineDiff ignores case and spacing', () => {
    const diff = outlineDiff(
      [{ level: 2, text: 'How  it works' }],
      [{ level: 2, text: 'how it works' }]
    )
    expect(diff.before[0]?.mark).toBe('same')
    expect(diff.after[0]?.mark).toBe('same')
  })

  it('Next round: a round badge, client-owned steps, index by days live, not cited by topic', () => {
    const { round, index, openByTopic } = report.impact
    expect(round.number).toBe(3)
    expect(round.startedLabel).toBe('Oct 28')
    expect(round.line).toContain('The next round has already started')
    expect(round.clientSteps).toEqual(['publish', 'index', 'backlinks'])
    expect(index.rows.length).toBeGreaterThan(0)
    expect(index.line).toContain('not in Google yet')
    expect(openByTopic.length).toBeGreaterThan(0)
    expectDrills(
      report,
      openByTopic.flatMap((row) => [row.open, row.wasCited])
    )
  })

  it('Not indexed: fresh vs late, and the questions written for each page', () => {
    const { late, fresh } = report.impact.notIndexed
    expect(late.n + fresh.n).toBe(report.notIndexed.rows.length)
    expect(report.impact.questionsFor['https://textbolt.com/textbolt-for-schools']).toBe(4)
  })

  it('How we measured: a clean before, the named definition and the published-pages source', () => {
    const { cleanBefore, lines } = report.impact.method
    expect(cleanBefore?.ok).toBe(true)
    expect(cleanBefore?.line).toContain('A clean before')
    const late = build('impact', sampleMetrics({ from: '2026-09-30T15:00:00.000Z' }))
    expect(late.impact.method.cleanBefore?.ok).toBe(false)
    expect(lines.join(' ')).toContain('"Named"')
    expect(lines.join(' ')).toContain('publishing records')
  })
})

describe('Little data, all reports', () => {
  it('Impact review with no fixes and one check: what it needs, hidden and greyed tabs', () => {
    const report = build('impact', littleMetrics(), EMPTY_EXTRAS)
    expect(report.needs?.actions).toEqual(['fix', 'check', 'schedule'])
    expect(report.needs?.items.every((item) => !item.done)).toBe(true)
    expect(report.needs?.nextCheck).toContain('No check is scheduled')
    const ids = report.sections.map((section) => section.id)
    expect(ids).not.toContain('lost')
    expect(ids).not.toContain('notindexed')
    const empty = Object.fromEntries(report.sections.map((s) => [s.id, s.empty]))
    expect(empty.published).toContain('Needs a logged fix')
    expect(empty.changed).toContain('second check')
    expect(empty.backlinks).toBeDefined()
    expect(empty.verdict).toBeUndefined()
    expect(empty.questions).toBeUndefined()
    expect(report.verdict.badge.label).toBe('Too early to tell')
    expect(report.verdict.speed).toEqual([])
    expect(report.impact.proofs.every((finding) => !/published/.test(finding.lead))).toBe(true)
    expect(report.impact.intro.meta).toBe('12 questions · 0 pages published · measured Oct 28')
    expect(partsText(report.impact.intro.lead)).toContain('No published pages are logged yet')
  })

  it('What changed with one check needs a second check; Visibility needs nothing', () => {
    const changed = build('changed', littleMetrics(), EMPTY_EXTRAS)
    // What changed draws its own "needs a second check" panel as its only tab.
    expect(changed.needs).toBeNull()
    expect(changed.sections.map((section) => section.id)).toEqual(['changed'])
    expect(build('visibility', littleMetrics(), EMPTY_EXTRAS).needs).toBeNull()
    expect(build('changed').needs).toBeNull()
  })
})
