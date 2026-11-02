import { VERDICT_WAIT_DAYS } from '../../fix-verdict'
import { pageKey } from '../../metrics/pages'
import type { MetricRow, MetricsResult } from '../../metrics/types'
import type { ImpactView, PageStory, StoryTile, WaitReason } from './impact-types'
import { toIdsOf } from './items'
import type { QuestionItem, ReviewReport } from './types'

/**
 * The page drawer's before → after story (Docs/REPORT-SPEC.md "Page drawer"): delta
 * tiles, the newly / kept / dropped split, the dates timeline, the position spread, the
 * sites cited beside it, the question tabs, and for a page not cited yet why it waits and
 * what happens next. Pure: the app builds it for any page link, the download for every
 * published page.
 */

export type StoryReport = Pick<
  ReviewReport,
  'pagesByUrl' | 'questionsById' | 'backlinks' | 'comparing'
> & { impact: Pick<ImpactView, 'pageDates' | 'nextCheck'> }

const SPREAD = [
  { label: '#1', test: (p: number) => p === 1 },
  { label: '#2', test: (p: number) => p === 2 },
  { label: '#3', test: (p: number) => p === 3 },
  { label: '#4–5', test: (p: number) => p === 4 || p === 5 },
  { label: '#6+', test: (p: number) => p >= 6 }
] as const

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

function tile(
  label: string,
  now: number | null,
  before: number | null,
  comparing: boolean,
  decimals = false
): StoryTile {
  const text = (value: number | null): string =>
    value === null ? '—' : decimals ? value.toFixed(1) : value.toLocaleString('en-US')
  return {
    label,
    now: text(now),
    before: comparing ? text(before) : null,
    delta:
      !comparing || now === null || before === null ? null : Math.round((now - before) * 10) / 10,
    ...(decimals ? { lowerIsBetter: true as const } : {})
  }
}

export function pageStory(
  report: StoryReport,
  metrics: MetricsResult,
  url: string,
  day: (iso: string) => string
): PageStory | null {
  const page = report.pagesByUrl[url]
  if (page === undefined) return null
  const key = pageKey(url)
  const row = metrics.pages.rows.find((entry) => entry.url === url)
  const toIds = toIdsOf(metrics)
  const comparing = report.comparing && metrics.checks.length >= 2 && row?.cited.before !== null
  const nowIds = (row?.cited.after ?? row?.cited.now)?.ids ?? []
  const beforeIds = comparing ? toIds(row?.cited.before?.ids ?? []) : []
  const nowSet = new Set(nowIds)
  const beforeSet = new Set(beforeIds)
  const fromRow = (id: string): MetricRow | undefined => {
    const fromId = metrics.fromOf[id]
    return fromId === undefined ? undefined : metrics.rows[fromId]
  }
  const positionOn = (metric: MetricRow | undefined): number | null =>
    metric !== undefined &&
    metric.citedUrl !== null &&
    pageKey(metric.citedUrl) === key &&
    typeof metric.position === 'number'
      ? metric.position
      : null
  const nowPositions = nowIds.flatMap((id) => {
    const value = positionOn(metrics.rows[id])
    return value === null ? [] : [value]
  })
  const beforePositions = beforeIds.flatMap((id) => {
    const value = positionOn(fromRow(id))
    return value === null ? [] : [value]
  })
  const namedNow = nowIds.filter((id) => metrics.rows[id]?.named === true).length
  const namedBefore = beforeIds.filter((id) => fromRow(id)?.named === true).length
  const tiles: StoryTile[] = [
    tile('Questions citing it', nowIds.length, beforeIds.length, comparing),
    tile(
      'Number-one source',
      nowPositions.filter((p) => p === 1).length,
      beforePositions.filter((p) => p === 1).length,
      comparing
    ),
    tile('Average position', average(nowPositions), average(beforePositions), comparing, true),
    tile('Brand named', namedNow, namedBefore, comparing)
  ]
  const items = (ids: readonly string[]): QuestionItem[] =>
    ids.flatMap((id) => {
      const item = report.questionsById[id]
      return item === undefined ? [] : [item]
    })
  const newly = nowIds.filter((id) => !beforeSet.has(id))
  const kept = nowIds.filter((id) => beforeSet.has(id))
  const dropped = beforeIds.filter((id) => !nowSet.has(id))

  const dates = report.impact.pageDates[url]
  const lastCheck = metrics.checks.at(-1)?.at ?? null
  const marks: { label: string; at: string | null }[] = [
    { label: 'First measured', at: metrics.checks[0]?.at ?? null },
    { label: 'Published', at: dates?.publishedAt ?? null },
    { label: 'Went live', at: page.liveSince },
    { label: 'Updated', at: dates?.modifiedAt ?? null },
    { label: 'This check', at: metrics.window.to ?? lastCheck }
  ]
  const timeline = marks
    .flatMap((mark) => (mark.at === null ? [] : [{ label: mark.label, at: mark.at }]))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((mark) => ({ ...mark, day: day(mark.at) }))

  const spread = SPREAD.map((bucket) => ({
    label: bucket.label,
    now: nowPositions.filter(bucket.test).length,
    before: comparing ? beforePositions.filter(bucket.test).length : null
  }))
  const counts = new Map<string, number>()
  for (const id of nowIds) {
    for (const domain of metrics.rows[id]?.domains ?? []) {
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
    }
  }
  const sites = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([domain, n]) => ({ domain, n }))

  let waiting: PageStory['waiting'] = null
  if (nowIds.length === 0) {
    const reasons: { reason: WaitReason; title: string; text: string }[] = []
    if (page.indexed === false) {
      reasons.push({
        reason: 'notindexed',
        title: 'Not in Google yet',
        text: 'Google has not indexed the page, so no AI answer can cite it. Send it for indexing in Search Console (URL Inspection, Request indexing) and link to it from your busiest pages.'
      })
    }
    if (page.daysLive !== null && page.daysLive < VERDICT_WAIT_DAYS) {
      reasons.push({
        reason: 'toonew',
        title: 'Too new to judge',
        text: `Live ${page.daysLive} ${page.daysLive === 1 ? 'day' : 'days'}. AI answers take about ${VERDICT_WAIT_DAYS} days to pick up a page, so it is not judged yet.`
      })
    }
    reasons.push({
      reason: 'nextround',
      title: 'Checked again next round',
      text: `${report.impact.nextCheck} If it is still not cited after ${VERDICT_WAIT_DAYS} days live, it gets reworked.`
    })
    const asked = report.backlinks.rows.some((ask) => pageKey(ask.url) === key)
    reasons.push({
      reason: 'backlinks',
      title: 'Links help',
      text: `Links from other sites, and from your own pages, help AI answers find and trust it.${asked ? ' It is on the backlink list.' : ''}`
    })
    waiting = reasons
  }

  return {
    page,
    tiles,
    split: { newly: newly.length, kept: kept.length, dropped: dropped.length },
    timeline,
    spread,
    sites,
    tabs: { now: items(nowIds), newly: items(newly), kept: items(kept), dropped: items(dropped) },
    waiting
  }
}
