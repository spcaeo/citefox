import type { PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import { calendarDay } from '../timezone'
import type { ExportCheck } from '../types'
import type { DrillRegistry } from './drills'
import { scoreOf } from './overview'
import { isAioStatus, urlPath, type PreviousResult, type ScopeData } from './rows'
import type {
  DeltaItem,
  DeltaList,
  FixVerdictModel,
  ReportRow,
  TrendPointModel,
  TrendsSection
} from './types'

export function statusLabel(status: PromptCheckStatus, position: number | null): string {
  const at = position === null ? '' : ` #${Math.round(position)}`
  if (status === 'page_cited') return `Target page${at}`
  if (status === 'other_own_page') return `Your other page${at}`
  if (status === 'brand_mentioned') return 'Named, not cited'
  if (status === 'not_cited') return 'Not cited'
  if (status === 'no_aio') return 'No AI Overview'
  return 'Check failed'
}

/** Section 6, Trends. */
export function buildTrends(
  scope: ScopeData,
  timeZone: string,
  drills: DrillRegistry,
  verdicts?: readonly FixVerdictModel[]
): TrendsSection {
  const series = buildSeries(scope, timeZone)
  const fixes = scope.slices
    .flatMap((slice) => slice.page.fixes.map((fix) => ({ fix, pageId: slice.page.pageId })))
    .filter(
      (item, index, list) =>
        list.findIndex(
          (other) => other.pageId === item.pageId && other.fix.number === item.fix.number
        ) === index
    )
    .map(({ fix, pageId }) => ({
      number: fix.number,
      at: fix.goLiveAt,
      description: fix.description,
      pageId
    }))
    .sort((left, right) => left.at.localeCompare(right.at))
  const previousAt = latest(scope.slices.map((slice) => slice.previous?.finishedAt ?? null))
  const currentAt = latest(scope.slices.map((slice) => slice.current.finishedAt))
  const measurable = (row: ReportRow, prior: PreviousResult): boolean =>
    row.status !== 'error' && prior.status !== 'error'
  const delta = (
    token: string,
    predicate: (row: ReportRow, prior: PreviousResult) => boolean,
    labels: (row: ReportRow, prior: PreviousResult) => { before: string; after: string }
  ): DeltaList => {
    const items: DeltaItem[] = []
    for (const row of scope.rows) {
      const prior = scope.previous.get(row.id)
      if (prior === undefined || !measurable(row, prior) || !predicate(row, prior)) continue
      const page = scope.slices.find((slice) => slice.page.pageId === row.pageId)?.page
      items.push({
        rowId: row.id,
        prompt: row.text,
        pagePath: page === undefined ? '' : urlPath(page.url),
        marketId: row.marketId,
        ...labels(row, prior)
      })
    }
    return {
      count: drills.count(
        token,
        items.map((item) => item.rowId)
      ),
      items
    }
  }
  const statusChange = (
    row: ReportRow,
    prior: PreviousResult
  ): { before: string; after: string } => ({
    before: statusLabel(prior.status, prior.position),
    after: statusLabel(row.status, row.position)
  })
  const namedChange = (row: ReportRow): { before: string; after: string } => ({
    before: row.named ? 'Not named' : 'Named',
    after: row.named ? 'Named' : 'Not named'
  })
  const hasHistory = series.length > 0
  return {
    empty: hasHistory
      ? null
      : {
          title: 'Not measured yet',
          message: 'Trends need at least one finished check in this data window.',
          nextStep: 'Run a check, then come back after the next scheduled check.'
        },
    series,
    fixes,
    previousAt,
    currentAt,
    gained: delta('delta:gained', (row, prior) => row.cited && !prior.cited, statusChange),
    lost: delta('delta:lost', (row, prior) => !row.cited && prior.cited, statusChange),
    newlyNamed: delta(
      'delta:named',
      (row, prior) => row.named && !prior.named && isAioStatus(prior.status),
      namedChange
    ),
    noLongerNamed: delta(
      'delta:unnamed',
      (row, prior) => !row.named && prior.named && row.aio,
      namedChange
    ),
    verdicts: verdicts ?? buildVerdicts(scope, drills)
  }
}

function buildSeries(scope: ScopeData, timeZone: string): TrendPointModel[] {
  type Group = { at: string; full: ExportCheck[]; partial: ExportCheck[] }
  const groups = new Map<string, Group>()
  for (const slice of scope.slices) {
    const perDay = new Map<string, { full: ExportCheck | null; partial: ExportCheck | null }>()
    for (const check of slice.history) {
      const day = calendarDay(check.finishedAt, timeZone)
      const entry = perDay.get(day) ?? { full: null, partial: null }
      if (check.metrics.partial) entry.partial = check
      else entry.full = check
      perDay.set(day, entry)
    }
    for (const [day, entry] of perDay) {
      const group = groups.get(day) ?? { at: '', full: [], partial: [] }
      if (entry.full !== null) group.full.push(entry.full)
      else if (entry.partial !== null) group.partial.push(entry.partial)
      for (const check of [entry.full, entry.partial]) {
        if (check !== null && check.finishedAt > group.at) group.at = check.finishedAt
      }
      groups.set(day, group)
    }
  }
  return [...groups.values()]
    .sort((left, right) => left.at.localeCompare(right.at))
    .map((group) => {
      const partial = group.full.length === 0
      const checks = partial ? group.partial : group.full
      const prompts = checks.flatMap((check) => check.prompts as readonly PromptCheckRow[])
      const metrics = checks.map((check) => check.metrics)
      return {
        at: group.at,
        checked: sum(metrics.map((item) => item.promptsChecked)),
        aio: sum(metrics.map((item) => item.promptsWithAio)),
        ownCited: sum(metrics.map((item) => item.pageCited + item.otherOwnPage)),
        pageCited: sum(metrics.map((item) => item.pageCited)),
        named: prompts.filter((row) => isAioStatus(row.status) && row.named === true).length,
        score:
          prompts.length > 0 ? scoreOf(prompts.map((row) => row.status)) : averageScore(metrics),
        partial
      }
    })
}

/**
 * Fix N: Worked / Partly worked / No change, from the last full check before go-live and
 * the latest full check after it. States what changed; never claims the fix caused it.
 */
function buildVerdicts(scope: ScopeData, drills: DrillRegistry): FixVerdictModel[] {
  const verdicts: FixVerdictModel[] = []
  const seen = new Set<string>()
  for (const slice of scope.slices) {
    for (const fix of slice.page.fixes) {
      const key = `${slice.page.pageId}#${fix.number}`
      if (seen.has(key)) continue
      seen.add(key)
      const slices = scope.slices.filter(
        (item) =>
          item.page.pageId === slice.page.pageId &&
          (fix.marketIds.length === 0 || fix.marketIds.includes(item.marketId))
      )
      let targets = 0
      let pending = true
      const improvedRows: string[] = []
      for (const item of slices) {
        const full = item.history.filter((check) => !check.metrics.partial)
        const before = [...full].reverse().find((check) => check.finishedAt <= fix.goLiveAt)
        const after = [...full].reverse().find((check) => check.finishedAt > fix.goLiveAt)
        if (after === undefined) continue
        pending = false
        const wanted = (row: PromptCheckRow): boolean =>
          fix.promptIds.length === 0 || fix.promptIds.includes(row.promptId)
        const cited = (row: PromptCheckRow | undefined): boolean =>
          row !== undefined && (row.status === 'page_cited' || row.status === 'other_own_page')
        const beforeRows = new Map((before?.prompts ?? []).map((row) => [row.promptId, row]))
        for (const row of after.prompts.filter(wanted)) {
          if (cited(beforeRows.get(row.promptId))) continue
          targets += 1
          if (!cited(row)) continue
          const reportRow = scope.rows.find(
            (candidate) =>
              candidate.pageId === item.page.pageId &&
              candidate.marketId === item.marketId &&
              candidate.promptId === row.promptId &&
              candidate.runId === after.metrics.runId
          )
          if (reportRow !== undefined) improvedRows.push(reportRow.id)
        }
      }
      const improved = improvedRows.length
      const verdict = pending
        ? 'pending'
        : improved === 0
          ? 'no_change'
          : improved >= targets
            ? 'worked'
            : 'partly'
      const of = `${improved} of ${targets} ${targets === 1 ? 'prompt' : 'prompts'}`
      verdicts.push({
        number: fix.number,
        pageId: slice.page.pageId,
        description: fix.description,
        goLiveAt: fix.goLiveAt,
        verdict,
        label:
          verdict === 'pending'
            ? 'Waiting for a full check after go-live'
            : verdict === 'worked'
              ? `Worked · ${of}`
              : verdict === 'partly'
                ? `Partly worked · ${of}`
                : `No change · ${of}`,
        prompts: drills.count(`fix:${slice.page.pageId}#${fix.number}`, improvedRows)
      })
    }
  }
  return verdicts.sort((left, right) => left.goLiveAt.localeCompare(right.goLiveAt))
}

function averageScore(metrics: readonly { visibilityScore: number | null }[]): number | null {
  const scores = metrics
    .map((item) => item.visibilityScore)
    .filter((value): value is number => value !== null)
  if (scores.length === 0) return null
  return Math.round(sum(scores) / scores.length)
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function latest(values: readonly (string | null)[]): string | null {
  let best: string | null = null
  for (const value of values) {
    if (value !== null && (best === null || value > best)) best = value
  }
  return best
}
