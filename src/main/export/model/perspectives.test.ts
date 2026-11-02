import { describe, expect, test } from 'vitest'
import type { ExportRequest } from '@shared/ipc'
import type { ExportDataset } from '../types'
import { prepareExport } from '../prepare'
import { reportModelFor } from './from-dataset'
import { richSampleDataset } from './sample-dataset.test-helper'
import { SAMPLE_BUILT_AT, sampleReportModel, sampleReportRequest } from './sample.test-helper'
import type { ReportModel, VerdictCountModel } from './types'

function modelOf(dataset: ExportDataset, overrides: Partial<ExportRequest> = {}): ReportModel {
  const request = sampleReportRequest(overrides)
  return reportModelFor(dataset, prepareExport(dataset, request).pages, request, SAMPLE_BUILT_AT)
}

function verdictCounts(model: ReportModel): VerdictCountModel[] {
  return model.verdict.findings.flatMap((finding) =>
    finding.parts.filter((part): part is VerdictCountModel => typeof part !== 'string')
  )
}

describe('report perspectives', () => {
  const page = sampleReportModel()

  test('verdict: badge from the change counts, and every number drills to exactly n prompts', () => {
    const { verdict, whatChanged } = page
    expect(verdict).toMatchObject({
      status: 'working',
      label: 'Working, early signs',
      compareLabel: 'the 5 Oct 2026 check',
      previousAt: '2026-10-05T15:00:00.000Z',
      currentAt: '2026-10-19T16:00:00.000Z'
    })
    expect(verdict.findings.map((finding) => finding.id)).toEqual([
      'movement',
      'holding',
      'named',
      'opportunity',
      'competition'
    ])
    const counts = verdictCounts(page)
    expect(counts.length).toBeGreaterThan(6)
    for (const count of counts) {
      expect(count.drill, count.set).not.toBeNull()
      expect(page.drills[count.drill ?? '']?.length, count.set).toBe(count.n)
    }
    // The same number as the "What changed" chips and the overview tiles, the same list.
    const bySet = new Map(counts.map((count) => [count.set, count]))
    expect(bySet.get('gained')).toMatchObject({ n: whatChanged.gained.n, drill: 'change:gained' })
    expect(bySet.get('lost')).toMatchObject({ n: whatChanged.lost.n, drill: 'change:lost' })
    expect(bySet.get('not_visible')).toMatchObject(page.overview.notVisible)
    expect(bySet.get('cited')).toMatchObject(page.overview.cited)
    expect(bySet.get('top_site')).toMatchObject({
      n: page.competition.rival?.prompts.n,
      drill: page.competition.rival?.prompts.drill
    })
  })

  test('what changed: each row against the previous full check; the partial follow-up stays out', () => {
    const { whatChanged } = page
    expect(whatChanged.empty).toBeNull()
    // The partial follow-up of 20 Oct is newer, but only full checks are compared.
    expect(whatChanged.currentAt).toBe('2026-10-19T16:00:00.000Z')
    const counts = [
      whatChanged.gained,
      whatChanged.kept,
      whatChanged.lost,
      whatChanged.never,
      whatChanged.noEarlier
    ]
    expect(counts.reduce((sum, count) => sum + count.n, 0)).toBe(page.rows.length)
    expect(whatChanged.rows).toHaveLength(page.rows.length)
    for (const change of ['gained', 'kept', 'lost', 'never'] as const) {
      const ids = whatChanged.rows.filter((row) => row.change === change).map((row) => row.rowId)
      expect(new Set(ids)).toEqual(new Set(page.drills[whatChanged[change].drill ?? '']))
    }
    // Canada has one full check only: its prompts are not compared.
    const canada = whatChanged.rows.filter((row) => row.marketId === 'mkt-ca')
    expect(canada.every((row) => row.change === null)).toBe(true)
    expect(whatChanged.rows[0]).toMatchObject({
      change: 'gained',
      positionBefore: null,
      positionNow: 2,
      citedThrough: '/blog/how-to-set-up-text-alerts-for-business/',
      ownPageCited: true
    })
    const lost = whatChanged.rows.find((row) => row.change === 'lost')
    expect(lost).toMatchObject({ positionBefore: 1, positionNow: null, citedThrough: null })
    // Gained first, then lost, kept, cited in neither, not compared.
    const order = whatChanged.rows.map((row) => row.change ?? 'none')
    expect(order.indexOf('lost')).toBeGreaterThan(order.lastIndexOf('gained'))
    expect(order.indexOf('none')).toBeGreaterThan(order.lastIndexOf('never'))
  })

  test('no earlier full check: "too early", the first-measurement finding, an empty What changed', () => {
    const dataset = richSampleDataset()
    const alerts = dataset.pages[0]
    if (alerts === undefined) throw new Error('no sample page')
    const us = alerts.markets[0]
    if (us === undefined) throw new Error('no US market')
    ;(us as { checks: typeof us.checks }).checks = us.checks.filter(
      (check) => check.metrics.runId === 'run-us-3' || check.metrics.partial
    )
    const model = modelOf(dataset)
    expect(model.verdict).toMatchObject({
      status: 'early',
      label: 'Too early to tell',
      compareLabel: null
    })
    expect(model.verdict.findings[0]?.id).toBe('first')
    expect(model.whatChanged.empty?.title).toBe('Nothing to compare yet')
    expect(model.whatChanged.noEarlier.n).toBe(model.rows.length)
    expect(model.method.previousAt).toBeNull()
    expect(model.competition.mostCited.every((item) => item.before === null)).toBe(true)
    expect(model.competition.byKind.every((row) => row.before === null)).toBe(true)
    for (const count of verdictCounts(model)) {
      expect(model.drills[count.drill ?? '']?.length).toBe(count.n)
    }
  })

  test('kinds of site: competitors, the built-in list, Claude’s stored kind, else other', () => {
    const { competition } = page
    const kindOf = new Map(competition.leaderboard.map((row) => [row.domain, row.kind]))
    expect(kindOf.get('textbolt.com')).toBeNull()
    expect(kindOf.get('twilio.com')).toBe('competitors')
    expect(kindOf.get('youtube.com')).toBe('video_social')
    expect(kindOf.get('reddit.com')).toBe('video_social')
    expect(kindOf.get('zapier.com')).toBe('other')
    const sorted = richSampleDataset()
    sorted.report.siteKinds = { 'zapier.com': 'services' }
    expect(
      modelOf(sorted).competition.leaderboard.find((row) => row.domain === 'zapier.com')?.kind
    ).toBe('services')

    // Citations now are the other sites' links on overviews: the kind rows add up.
    const rows = competition.byKind
    expect(rows.map((row) => row.kind)).toEqual([
      'video_social',
      'competitors',
      'other',
      'analysts_media'
    ])
    const otherLinks = page.references.filter(
      (reference) =>
        reference.classification !== 'target' &&
        reference.classification !== 'own' &&
        page.rows.find((row) => row.id === reference.rowId)?.aio === true
    ).length
    expect(rows.reduce((sum, row) => sum + row.now, 0)).toBe(otherLinks)
    for (const row of rows) {
      expect(row.change).toBe(row.now - (row.before ?? 0))
      expect(page.drills[row.prompts.drill ?? '']?.length).toBe(row.prompts.n)
    }
    // The earlier bars: prompts citing each site in the previous full check.
    expect(competition.mostCited[0]).toMatchObject({ domain: 'textbolt.com', before: 3 })
    expect(competition.mostCited.find((item) => item.domain === 'twilio.com')?.before).toBe(2)
  })

  test('how we measured: what was searched, and the agreement only when both checks exist', () => {
    expect(page.method).toMatchObject({
      questions: page.overview.tracked,
      marketIds: ['mkt-us', 'mkt-ca'],
      trackedPages: 1,
      previousAt: '2026-10-05T15:00:00.000Z',
      currentAt: '2026-10-19T16:00:00.000Z',
      agreement: null
    })
    expect(page.method.copy.vary).toMatch(/different AI Overview/)

    // A topic asking the alerts page's questions in the US: two independent checks.
    const dataset = richSampleDataset()
    const alerts = dataset.pages[0]
    if (alerts === undefined) throw new Error('no sample page')
    const topic = structuredClone(alerts) as typeof alerts & { kind?: 'topic' }
    Object.assign(topic, { pageId: 'topic-alerts', kind: 'topic', url: '', slug: 'alerts-topic' })
    const usTopic = topic.markets[0]
    if (usTopic === undefined) throw new Error('no US market')
    Object.assign(topic, { markets: [usTopic], fixes: [] })
    const latest = usTopic.checks.find((check) => check.metrics.runId === 'run-us-3')
    const flipped = latest?.prompts.find(
      (row) => row.status === 'page_cited' || row.status === 'other_own_page'
    )
    if (flipped === undefined) throw new Error('no cited prompt to flip')
    // "Cited" reads the sources: the flipped answer keeps no page of the site.
    Object.assign(flipped, {
      status: 'not_cited',
      citedUrl: null,
      position: null,
      references: flipped.references.filter(
        (reference) => reference.classification !== 'target' && reference.classification !== 'own'
      )
    })
    dataset.pages = [alerts, topic]
    const model = modelOf(dataset, { scope: 'project', pageIds: [], marketIds: ['mkt-us'] })
    const agreement = model.method.agreement
    expect(agreement).not.toBeNull()
    expect(agreement?.total.n).toBe(10)
    expect(agreement?.agree.n).toBe(9)
    expect(agreement?.percent).toBe(90)
    expect(model.drills[agreement?.total.drill ?? '']).toHaveLength(10)
    expect(model.drills[agreement?.agree.drill ?? '']).toHaveLength(9)
    // The ids are the page side's rows, never the topic's.
    const topicRows = new Set(
      model.rows.filter((row) => row.pageId === 'topic-alerts').map((row) => row.id)
    )
    expect(model.drills[agreement?.total.drill ?? '']?.some((id) => topicRows.has(id))).toBe(false)
  })
})
