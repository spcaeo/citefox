import type { ChartEvent } from '../ui'
import type {
  CheckRunKind,
  PageResults,
  PageScoreSummary,
  ResultsHistory,
  TrendPoint
} from '@shared/domain'
import { aiOverviewLabel, hasAio } from '../m3/model'
import {
  promptSetVersionGroup,
  promptSetVersionLabel,
  readPromptSetVersion,
  samePromptSetVersion
} from '../m3/promptSetVersion'
import { pluralize } from '@shared/pluralize'

/** "N of M prompts". The noun agrees with the total. */
/** A logged fix's marker on the rate chart: spruce (fox is the page being cited). */
export const FIX_STROKE = 'var(--chart-2)'

export function promptsOf(checked: number, total: number): string {
  return `${checked.toLocaleString('en-US')} of ${pluralize(total, 'question')}`
}

export function promptsCheckedLabel(checked: number, total: number): string {
  return `${promptsOf(checked, total)} checked`
}

export function allPromptsPhrase(count: number): string {
  return `all ${pluralize(count, 'question')}`
}

export function citedInOverviews(cited: number, shown: number): string {
  return `Page cited in ${cited.toLocaleString('en-US')} of ${aiOverviewLabel(shown)} shown`
}

/** Pages with no score are left out, not treated as 0. Nearest integer. */
export function averageScore(pages: readonly Pick<PageScoreSummary, 'score'>[]): number | null {
  const scores = pages.flatMap((page) => (page.score === null ? [] : [page.score]))
  if (scores.length === 0) return null
  const total = scores.reduce((sum, score) => sum + score, 0)
  return Math.round(total / scores.length)
}

/** Mean of pages that have a previous check. Nearest integer. */
export function meanChange(pages: readonly Pick<PageScoreSummary, 'change'>[]): number | null {
  const changes = pages.flatMap((page) => (page.change === null ? [] : [page.change]))
  if (changes.length === 0) return null
  const total = changes.reduce((sum, change) => sum + change, 0)
  return Math.round(total / changes.length)
}

export interface TrendSegment {
  id: 'page_cited' | 'not_page_cited'
  label: string
  count: number
  promptIds: readonly string[]
}

export interface TrendBar {
  runId: string
  finishedAt: string
  partial: boolean
  inTrendLine: boolean
  /** Raw value from the check. Null when the prompt set was not stored. */
  promptSetVersion: number | null
  /** True when this full check starts a new prompt-set group. The first check is not a change. */
  versionChanged: boolean
  event: string
  kindLabel: string
  rate: number | null
  rateLabel: string
  pageCited: number
  aiosShown: number
  promptsChecked: number
  promptsTotal: number
  score: number | null
  citations: number | null
  citationDetail: string
  coverageLabel: string
  citedLine: string
  contentChanged: boolean
  contentSummary: string | null
  segments: readonly TrendSegment[]
}

export interface TrendModel {
  bars: readonly TrendBar[]
  /** Full checks only, one array per prompt-set version, partials omitted. */
  lines: readonly (readonly TrendBar[])[]
  issues: readonly string[]
}

/**
 * Sample view-model for chart marks that `results:history` does not return.
 * Presentation only. Not a channel, request, or response type.
 */
export interface LocalChartMarker {
  at: string
  chartTitle: string
  chartDetail: string
  event: string
  promptsLabel: string | null
  trendNote: string
  planned: boolean
  changeNote: string | null
  /** Fix labels sit at the top of the line. Planned checks sit lower so they don't collide. */
  band: 'fix' | 'plan'
  /** Prompts this marker stands for. The drill lists exactly these. */
  promptIds: readonly string[]
  /** The fix this marker belongs to, so its row can jump to the fix card. */
  fixNumber?: number
}

const LABEL_CHAR = 6.4

/** Chart baseline. Date labels are drawn just below it. Marker boxes must end above it. */
export const CHART_AXIS_Y = 220

export function markerBox(label: MarkerLabel): { x1: number; x2: number; y1: number; y2: number } {
  const wide = Math.max(label.title.length, label.detail.length) * LABEL_CHAR
  const x1 = label.anchor === 'end' ? label.x - wide : label.x
  return { x1: x1 - 4, x2: x1 + wide + 4, y1: label.titleY - 12, y2: label.detailY + 4 }
}

/** True when a label box meets the baseline or the date row under it. */
export function markerIntersectsAxis(label: MarkerLabel, axisY = CHART_AXIS_Y): boolean {
  const box = markerBox(label)
  const bandTop = axisY - 2
  const bandBottom = axisY + 36
  return box.y2 > bandTop && box.y1 < bandBottom
}

export interface MarkerLabel {
  at: string
  lineX: number
  title: string
  detail: string
  x: number
  titleY: number
  detailY: number
  anchor: 'start' | 'end'
  name: string
  promptIds: readonly string[]
  stroke: string
  dash: string
  band: 'fix' | 'plan'
  fixNumber: number | null
}

/** Fix lines start under their own title. Planned lines start below the fix band. */
export function markerLineTop(label: Pick<MarkerLabel, 'band' | 'detailY'>): number {
  return label.band === 'fix' ? label.detailY + 8 : 70
}

/** Plan markers add a date. Fix markers do not, so Oct 8 and Oct 21 stay off the axis. */
export function showsAxisDate(
  band: 'fix' | 'plan',
  day: string,
  barDays: ReadonlySet<string>
): boolean {
  return band === 'plan' && !barDays.has(day)
}

/** Right-edge dates end on their tick so they stay inside the viewBox. */
export function axisDateAnchor(x: number, width: number): 'start' | 'middle' | 'end' {
  if (x + 28 > width) return 'end'
  if (x - 28 < 0) return 'start'
  return 'middle'
}

/** Place marker titles so boxes in the same band do not overlap. */
export function layoutMarkers(
  markers: readonly LocalChartMarker[],
  xOf: (iso: string) => number,
  width: number
): MarkerLabel[] {
  const placed: MarkerLabel[] = markers.map((marker) => {
    const lineX = xOf(marker.at)
    const plan = marker.band === 'plan'
    const title = plan
      ? marker.chartTitle === 'Next full check'
        ? 'next full check'
        : marker.chartTitle === 'Follow-up'
          ? 'follow-up'
          : marker.chartTitle
      : marker.chartTitle
    const detail = plan ? 'planned' : marker.chartDetail
    const wide = Math.max(title.length, detail.length) * LABEL_CHAR
    const hugRight = marker.chartTitle === 'Next full check' || lineX + 8 + wide > width - 4
    return {
      at: marker.at,
      lineX,
      title,
      detail,
      x: hugRight ? lineX - 6 : lineX + 6,
      titleY: plan ? 190 : 34,
      detailY: plan ? 204 : 49,
      anchor: hugRight ? 'end' : 'start',
      name: marker.promptsLabel
        ? `${marker.chartTitle}, ${marker.chartDetail}, ${marker.promptsLabel}`
        : `${marker.chartTitle}, ${marker.chartDetail}`,
      promptIds: marker.promptIds,
      stroke: plan ? 'var(--chart-planned)' : FIX_STROKE,
      dash: plan ? '2 3' : marker.planned ? '2 4' : '4 4',
      band: marker.band,
      fixNumber: marker.fixNumber ?? null
    }
  })
  for (let pass = 0; pass < 4; pass += 1) {
    const sorted = [...placed].sort((a, b) => a.titleY - b.titleY || a.lineX - b.lineX)
    let moved = false
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]
      if (!current) continue
      for (let j = 0; j < i; j += 1) {
        const previous = sorted[j]
        if (!previous || !markerBoxesOverlap(previous, current)) continue
        const lowered = { ...current, titleY: current.titleY + 32, detailY: current.detailY + 32 }
        if (markerIntersectsAxis(lowered)) {
          previous.titleY -= 32
          previous.detailY -= 32
        } else {
          current.titleY += 32
          current.detailY += 32
        }
        moved = true
      }
    }
    if (!moved) break
  }
  return placed
}

export function markerBoxesOverlap(a: MarkerLabel, b: MarkerLabel): boolean {
  const left = markerBox(a)
  const right = markerBox(b)
  return left.x1 < right.x2 && right.x1 < left.x2 && left.y1 < right.y2 && right.y1 < left.y2
}

export interface CoverageTick {
  at: string
  label: string
  checked: number
  total: number
  planned: boolean
}

/** One tick per check and per planned follow-up. Checked never exceeds the prompt total. */
export function coverageTicks(
  bars: readonly TrendBar[],
  markers: readonly LocalChartMarker[]
): CoverageTick[] {
  const fromBars: CoverageTick[] = bars.map((bar) => ({
    at: bar.finishedAt,
    label: promptsOf(bar.promptsChecked, bar.promptsTotal),
    checked: bar.promptsChecked,
    total: bar.promptsTotal,
    planned: false
  }))
  const fromMarkers: CoverageTick[] = markers.flatMap((marker) => {
    if (!marker.promptsLabel) return []
    const match = /^(\d+) of (\d+)/.exec(marker.promptsLabel)
    const checked = Number(match?.[1] ?? 0)
    const total = Number(match?.[2] ?? 0)
    const label =
      marker.planned && checked === total
        ? `${checked} of ${total} · planned`
        : marker.planned
          ? `${checked} of ${total} planned`
          : promptsOf(checked, total)
    return [{ at: marker.at, label, checked, total, planned: marker.planned }]
  })
  return [...fromBars, ...fromMarkers].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function buildTrend(
  history: ResultsHistory,
  runs: ReadonlyMap<string, PageResults>
): TrendModel {
  const issues: string[] = []
  const fullSeen = new Set<number | null>()
  let previousGroup: number | null | undefined
  const bars = history.points.map((point) => {
    const bar = barFor(point, runs, fullSeen, issues)
    const group = promptSetVersionGroup(bar.promptSetVersion)
    const versionChanged = bar.inTrendLine && previousGroup !== undefined && previousGroup !== group
    if (bar.inTrendLine) previousGroup = group
    return { ...bar, versionChanged }
  })
  return { bars, lines: trendLines(bars), issues }
}

function barFor(
  point: TrendPoint,
  runs: ReadonlyMap<string, PageResults>,
  fullSeen: Set<number | null>,
  issues: string[]
): TrendBar {
  const results = runs.get(point.runId) ?? null
  const run = results?.run ?? null
  const prompts = results?.prompts ?? []
  const citedIds = prompts.filter((row) => row.status === 'page_cited').map((row) => row.promptId)
  const notIds = prompts
    .filter((row) => hasAio(row) && row.status !== 'page_cited')
    .map((row) => row.promptId)
  const pageCited = run?.pageCited ?? citedIds.length
  const aiosShown = run?.promptsWithAio ?? citedIds.length + notIds.length
  if (results) {
    if (citedIds.length + notIds.length !== aiosShown) {
      issues.push(`${point.runId} segments ${citedIds.length + notIds.length} aios ${aiosShown}`)
    }
    if (citedIds.length !== pageCited) {
      issues.push(`${point.runId} page cited ${pageCited} lists ${citedIds.length}`)
    }
    if (aiosShown > 0 && point.pageCitedRate !== null) {
      const expected = pageCited / aiosShown
      if (Math.abs(point.pageCitedRate - expected) > 1e-9) {
        issues.push(`${point.runId} rate ${point.pageCitedRate} expected ${expected}`)
      }
    }
  }
  const version = readPromptSetVersion(point.promptSetVersion)
  const group = promptSetVersionGroup(version)
  const firstOfVersion = !point.partial && !fullSeen.has(group)
  if (!point.partial) fullSeen.add(group)
  const event = eventLabel(run?.kind ?? null, point.partial, firstOfVersion)
  const rate = point.pageCitedRate
  const citations = run === null ? null : run.citationsThisPage + run.citationsOtherOwn
  const segments: TrendSegment[] = results
    ? [
        { id: 'page_cited', label: 'Page cited', count: citedIds.length, promptIds: citedIds },
        {
          id: 'not_page_cited',
          label: 'Not page cited',
          count: notIds.length,
          promptIds: notIds
        }
      ]
    : []
  return {
    runId: point.runId,
    finishedAt: point.finishedAt,
    partial: point.partial,
    inTrendLine: !point.partial && rate !== null,
    promptSetVersion: version,
    versionChanged: false,
    event,
    kindLabel: `${event} · ${point.partial ? 'partial' : 'full'}`,
    rate,
    rateLabel: rate === null ? '—' : `${Math.round(rate * 100)}%`,
    pageCited,
    aiosShown,
    promptsChecked: point.promptsChecked,
    promptsTotal: point.promptsTotal,
    score: point.visibilityScore,
    citations,
    citationDetail:
      run === null
        ? '—'
        : `${citations} (${run.citationsThisPage} to this page, ${run.citationsOtherOwn} to other pages)`,
    coverageLabel: promptsCheckedLabel(point.promptsChecked, point.promptsTotal),
    citedLine: rate === null ? 'No AI Overview' : citedInOverviews(pageCited, aiosShown),
    contentChanged: point.contentChanged,
    contentSummary: run?.contentChange?.summary ?? null,
    segments
  }
}

function eventLabel(kind: CheckRunKind | null, partial: boolean, firstOfVersion: boolean): string {
  if (partial || kind === 'follow_up') return 'Follow-up'
  if (kind === 'baseline' || firstOfVersion) return 'Baseline check'
  if (kind === 'scheduled' || kind === 'manual') return 'Scheduled check'
  return 'Check'
}

/** Partials stay out of the line. A new prompt-set version starts a new line. */
export function trendLines(bars: readonly TrendBar[]): TrendBar[][] {
  const lines: TrendBar[][] = []
  for (const bar of bars) {
    if (!bar.inTrendLine) continue
    const last = lines[lines.length - 1]
    const head = last?.[0]
    if (!last || !head || !samePromptSetVersion(head.promptSetVersion, bar.promptSetVersion)) {
      lines.push([bar])
    } else last.push(bar)
  }
  return lines
}

export function firstCheckNote(version: number | null | undefined): string {
  return `First check with question set ${promptSetVersionLabel(version)}.`
}

/** Shown beside a selected point. Unknown versions never render as v0. */
export function pointNote(bar: TrendBar, markers: readonly LocalChartMarker[]): string {
  const note = pointNoteBody(bar, markers)
  if (
    promptSetVersionLabel(bar.promptSetVersion) !== 'version unknown' ||
    note.includes('version unknown')
  ) {
    return note
  }
  return `${note} Question set version unknown.`
}

function pointNoteBody(bar: TrendBar, markers: readonly LocalChartMarker[]): string {
  if (bar.contentChanged) {
    const prior = markers.filter((marker) => !marker.planned && marker.at <= bar.finishedAt)
    const note = prior[prior.length - 1]?.changeNote
    if (note) return note
    if (bar.contentSummary) return `Page content changed in this period: ${bar.contentSummary}.`
    return 'The page content changed in this period.'
  }
  if (bar.event === 'Baseline check') return firstCheckNote(bar.promptSetVersion)
  return 'Page content unchanged since the baseline.'
}

/** Accessible name and tooltip for one chart point. */
export function pointAccessibleName(bar: TrendBar, day: string): string {
  const version = promptSetVersionLabel(bar.promptSetVersion)
  const change = bar.versionChanged ? `, question set changed to ${version}` : ''
  return `${day}, ${bar.rateLabel}, ${bar.citedLine}, ${version}${change}`
}

/** Label drawn when a full check starts a new prompt-set group. Null when it does not. */
export function versionChangeMarker(bar: TrendBar): string | null {
  if (!bar.versionChanged) return null
  return promptSetVersionLabel(bar.promptSetVersion)
}

export interface RateTableRow {
  id: string
  at: string
  event: string
  prompts: string
  shown: string
  cited: string
  /** AI Overviews that are not page cited. With `cited`, this adds up to `shown`. */
  notCited: string
  rate: string
  inTrend: string
  score: string
  citations: string
  promptSet: string
  /** The fix a marker row belongs to. Null for checks. */
  fixNumber: number | null
}

function notCitedText(bar: TrendBar): string {
  const segment = bar.segments.find((item) => item.id === 'not_page_cited')
  return segment ? String(segment.count) : '—'
}

export function rateTable(
  bars: readonly TrendBar[],
  markers: readonly LocalChartMarker[]
): RateTableRow[] {
  const checks: RateTableRow[] = bars.map((bar) => ({
    id: bar.runId,
    at: bar.finishedAt,
    event: bar.event,
    prompts: `${bar.promptsChecked} of ${bar.promptsTotal}`,
    shown: String(bar.aiosShown),
    cited: String(bar.pageCited),
    notCited: notCitedText(bar),
    rate: bar.rateLabel,
    inTrend: bar.partial ? 'No, partial check' : bar.inTrendLine ? 'Yes' : 'No',
    score: bar.score === null ? '—' : String(bar.score),
    citations: bar.citations === null ? '—' : String(bar.citations),
    promptSet: promptSetVersionLabel(bar.promptSetVersion),
    fixNumber: null
  }))
  const extras: RateTableRow[] = markers.map((marker) => ({
    id: marker.at,
    at: marker.at,
    event: marker.event,
    prompts: marker.promptsLabel ?? '—',
    shown: '—',
    cited: '—',
    notCited: '—',
    rate: '—',
    inTrend: marker.trendNote,
    score: '—',
    citations: '—',
    promptSet: '—',
    fixNumber: marker.fixNumber ?? null
  }))
  return [...checks, ...extras].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function chartAccessibleName(
  bars: readonly TrendBar[],
  markers: readonly LocalChartMarker[],
  market: string
): string {
  const full = bars.filter((bar) => bar.inTrendLine)
  const total = full[0]?.promptsTotal ?? bars[0]?.promptsTotal ?? 0
  const rates = full
    .map((bar) => `${bar.rateLabel} (${bar.pageCited} of ${bar.aiosShown})`)
    .join(', ')
  const fixes = markers
    .map((marker) => `${marker.chartTitle} ${marker.planned ? 'planned' : 'logged'}`)
    .join(', ')
  const ratesText = rates.length > 0 ? rates : 'no full check yet'
  const fixText = fixes.length > 0 ? ` ${fixes}.` : ''
  const versions = promptSetRunLabel(full)
  const changes = full
    .filter((bar) => bar.versionChanged)
    .map((bar) => promptSetVersionLabel(bar.promptSetVersion))
  const changeText = changes.length > 0 ? ` Question set changed to ${changes.join(', ')}.` : ''
  return `Share of AI Overviews that cite this page, ${market}, full checks of ${allPromptsPhrase(total)}: ${ratesText}. Question set ${versions}.${changeText}${fixText}`
}

function promptSetRunLabel(bars: readonly TrendBar[]): string {
  const labels: string[] = []
  for (const bar of bars) {
    const label = promptSetVersionLabel(bar.promptSetVersion)
    if (labels[labels.length - 1] !== label) labels.push(label)
  }
  return labels.length > 0 ? labels.join(', ') : 'version unknown'
}

export function citedPromptIds(bar: TrendBar): readonly string[] {
  return bar.segments.find((segment) => segment.id === 'page_cited')?.promptIds ?? []
}

export function segmentSum(segments: readonly { count: number }[]): number {
  return segments.reduce((sum, segment) => sum + segment.count, 0)
}

/**
 * Sample (harness) markers as chart events: each logged fix is a numbered marker.
 * Planned follow-ups are not markers; they stay in the table.
 */
export function markerEvents(markers: readonly LocalChartMarker[]): ChartEvent[] {
  return markers.flatMap((marker) =>
    marker.band === 'fix'
      ? [
          {
            id: `sample:${marker.at}`,
            kind: 'fix' as const,
            at: marker.at,
            title: marker.chartTitle,
            line: marker.chartDetail,
            ...sampleNumber(marker),
            planned: marker.planned
          }
        ]
      : []
  )
}

function sampleNumber(marker: LocalChartMarker): { number?: number } {
  const number = marker.fixNumber ?? Number(/^Fix (\d+)/.exec(marker.chartTitle)?.[1] ?? NaN)
  return Number.isNaN(number) ? {} : { number }
}
