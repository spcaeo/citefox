import type { IntentStage, PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import {
  aioSharePct,
  headlineNoun,
  isAlreadyWinning,
  percent,
  reportHeadline
} from '@shared/report-copy'
import { pointsFor } from '../../engine/checks/score'
import type { DrillRegistry } from './drills'
import { reportMetrics } from './metric-rows'
import type { ScopeData } from './rows'
import { formatLongDate } from './format'
import type {
  FunnelStepModel,
  OpportunityBar,
  OverviewSection,
  ReportPage,
  ReportRow,
  TopActionModel
} from './types'

export const STAGE_LABELS: Record<IntentStage, string> = {
  problem: 'Problem',
  solution: 'Solution',
  comparison: 'Comparison',
  objection: 'Objection',
  trigger: 'Trigger',
  unset: 'Not set'
}

export const STAGE_ORDER: readonly IntentStage[] = [
  'problem',
  'trigger',
  'solution',
  'comparison',
  'objection',
  'unset'
]

/** SRS section 7.2 over rows: points ÷ (3 × rows with an AIO), 0–100. */
export function scoreOf(statuses: readonly PromptCheckStatus[]): number | null {
  let points = 0
  let possible = 0
  for (const status of statuses) {
    const value = pointsFor(status)
    if (value === null) continue
    points += value
    possible += 3
  }
  return possible === 0 ? null : Math.round((points / possible) * 100)
}

export function buildOverview(
  scope: ScopeData,
  pages: readonly ReportPage[],
  projectScope: boolean,
  drills: DrillRegistry,
  timeZone: string
): OverviewSection {
  const rows = scope.rows
  const ids = (predicate: (row: ReportRow) => boolean): string[] =>
    rows.filter(predicate).map((row) => row.id)
  // The shared metrics' counts (`src/shared/metrics`), each with the rows behind it.
  const counts = reportMetrics(scope).now
  const aio = drills.count('aio:shown', counts.answered.ids)
  const cited = drills.count('aio:cited', counts.cited.ids)
  const named = drills.count('named', counts.named.ids)
  const notVisible = drills.count('invisible', counts.notVisible.ids)
  const failed = drills.count('failed', counts.failed.ids)
  const score = scoreOf(rows.map((row) => row.status))
  const previousStatuses = scope.slices.flatMap((slice) =>
    slice.previous === null ? [] : slice.previous.prompts.map((row: PromptCheckRow) => row.status)
  )
  const previousScore = previousStatuses.length === 0 ? null : scoreOf(previousStatuses)
  const previousAt = latest(scope.slices.map((slice) => slice.previous?.finishedAt ?? null))
  const window = windowOf(scope)
  return {
    headline: reportHeadline({
      measured: counts.measured.n,
      aio: aio.n,
      cited: cited.n,
      named: named.n,
      notVisible: notVisible.n,
      failed: failed.n,
      noun: headlineNoun(new Set(rows.map((row) => row.marketId)).size, projectScope)
    }),
    tracked: drills.count('all', counts.checked.ids),
    aio,
    aioPct: aioSharePct(aio.n, rows.length),
    failed,
    cited,
    citedPct: percent(cited.n, aio.n),
    pageCited: drills.count('aio:page', counts.target.ids),
    named,
    winning: drills.count(
      'wins',
      ids((row) => isAlreadyWinning(row))
    ),
    notVisible,
    wrongPage: drills.count('wrongpage', counts.other.ids),
    score,
    scoreChange: score === null || previousScore === null ? null : score - previousScore,
    previousCheckAt: previousAt,
    funnel: buildFunnel(rows, projectScope, drills),
    opportunityByStage: opportunityBars(
      rows,
      (row) => row.stage,
      (key) => STAGE_LABELS[key as IntentStage] ?? key,
      'stage',
      drills
    ),
    opportunityByPage: projectScope
      ? opportunityBars(
          rows,
          (row) => row.pageId,
          (key) => pages.find((page) => page.id === key)?.path ?? key,
          'page',
          drills
        )
      : [],
    coverageLine: coverageLine(counts.measured.n, rows.length, window, timeZone),
    measured: counts.measured.n,
    topActions: topActions(scope)
  }
}

function buildFunnel(
  rows: readonly ReportRow[],
  projectScope: boolean,
  drills: DrillRegistry
): FunnelStepModel[] {
  const step = (
    id: FunnelStepModel['id'],
    label: string,
    token: string,
    predicate: (row: ReportRow) => boolean,
    dropReason: string | null
  ): FunnelStepModel => ({
    id,
    label,
    count: drills.count(
      token,
      rows.filter(predicate).map((row) => row.id)
    ),
    dropReason
  })
  return [
    step('tracked', 'Prompts tracked', 'all', () => true, null),
    step(
      'aio',
      'AI Overview appears',
      'aio:shown',
      (row) => row.aio,
      'No AI Overview, or the check failed'
    ),
    step(
      'cited',
      'You are cited',
      'aio:cited',
      (row) => row.cited,
      'The overview did not cite your domain'
    ),
    step(
      'page_cited',
      projectScope ? 'A tracked page is cited' : 'This page is cited',
      'aio:page',
      (row) => row.pageCited,
      'Another page on your domain was cited instead'
    ),
    step(
      'named',
      'Page cited and brand named',
      'funnel:named',
      (row) => row.pageCited && row.named,
      'Cited without the brand name in the text'
    )
  ]
}

function opportunityBars(
  rows: readonly ReportRow[],
  keyOf: (row: ReportRow) => string,
  labelOf: (key: string) => string,
  dimension: 'stage' | 'page',
  drills: DrillRegistry
): OpportunityBar[] {
  const groups = new Map<string, ReportRow[]>()
  for (const row of rows) {
    if (!row.aio) continue
    const key = keyOf(row)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [row])
    else list.push(row)
  }
  const bars: OpportunityBar[] = []
  for (const [key, list] of groups) {
    const token = `dim:${dimension}=${key}`
    const ids = (predicate: (row: ReportRow) => boolean): string[] =>
      list.filter(predicate).map((row) => row.id)
    bars.push({
      key,
      label: labelOf(key),
      total: drills.count(
        `${token}:aio`,
        ids(() => true)
      ),
      notVisible: drills.count(
        `${token}:invisible`,
        ids((row) => row.notVisible)
      ),
      namedOnly: drills.count(
        `${token}:named-only`,
        ids((row) => row.named && !row.cited)
      ),
      citedOnly: drills.count(
        `${token}:cited-only`,
        ids((row) => row.cited && !row.named)
      ),
      winning: drills.count(
        `${token}:wins`,
        ids((row) => isAlreadyWinning(row))
      )
    })
  }
  return bars.sort(
    (left, right) =>
      right.notVisible.n - left.notVisible.n ||
      right.total.n - left.total.n ||
      left.label.localeCompare(right.label)
  )
}

function topActions(scope: ScopeData): TopActionModel[] {
  const actions: TopActionModel[] = []
  for (const slice of scope.slices) {
    for (const action of slice.current.topActions) {
      if (action.promptId === null) continue
      const row = scope.rows.find(
        (item) =>
          item.promptId === action.promptId &&
          item.pageId === slice.page.pageId &&
          item.marketId === slice.marketId
      )
      if (row === undefined || actions.some((item) => item.text === action.text)) continue
      actions.push({
        rank: actions.length + 1,
        text: action.text,
        reason: action.reason,
        rowId: row.id
      })
      if (actions.length === 3) return actions
    }
  }
  return actions
}

export function windowOf(scope: ScopeData): { from: string | null; to: string | null } {
  const times = scope.windowChecks.map((check) => check.finishedAt).sort()
  return { from: times[0] ?? null, to: times[times.length - 1] ?? null }
}

function coverageLine(
  measured: number,
  tracked: number,
  window: { from: string | null; to: string | null },
  timeZone: string
): string {
  if (tracked === 0) return 'No prompts have been measured in this data window yet.'
  const noun = tracked === 1 ? 'prompt' : 'prompts'
  const from = window.from === null ? null : formatLongDate(window.from, timeZone)
  const to = window.to === null ? null : formatLongDate(window.to, timeZone)
  const when =
    from === null || to === null ? '' : from === to ? ` on ${from}` : ` between ${from} and ${to}`
  return `Based on ${measured} of ${tracked} ${noun} measured${when}.`
}

function latest(values: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const value of values) {
    if (value !== null && (best === null || value > best)) best = value
  }
  return best
}
