import {
  DEFAULT_OVERVIEW_PERIOD,
  type EngineCounts,
  isOverviewPeriod,
  type OverviewFirstReport,
  type OverviewOwnPage,
  type OverviewQuestion,
  type OverviewPeriod,
  type OverviewSource,
  type OverviewWeek,
  type VisibilityOverview
} from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { promptHash } from '../shell/routes'
import type { KpiTrend } from '../ui'
import type { ResultBucket, ResultCounts } from '../ui/resultTones'
import { formatDay } from '../utils/dates'

/** Pure helpers for the AI visibility home: its URL state, labels and chart. */

export const PERIOD_PARAM = 'period'
/** `?drawer=<id>` opens a drawer over any route (shell/drawerUrl `DRAWER_PARAM`). */
export const DIALOG_PARAM = 'drawer'
export const ADD_QUESTIONS_DIALOG = 'add-questions'

export const PERIOD_OPTIONS: readonly { value: OverviewPeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' }
]

/** Screens the Overview links to. They are routes of the new navigation. */
export const OVERVIEW_LINKS = {
  questions: '#/questions',
  competitors: '#/competitors',
  fixes: '#/fixes'
} as const

function splitHash(hash: string): { path: string; params: URLSearchParams } {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  return at < 0
    ? { path: plain, params: new URLSearchParams() }
    : { path: plain.slice(0, at), params: new URLSearchParams(plain.slice(at + 1)) }
}

/** The period in the address (`?period=30d`). Absent or unknown: 30 days. */
export function periodFromHash(hash: string): OverviewPeriod {
  const value = splitHash(hash).params.get(PERIOD_PARAM)
  return isOverviewPeriod(value) ? value : DEFAULT_OVERVIEW_PERIOD
}

/** `hash` with one query value set (or removed with null), the path and other values kept. */
export function withQueryParam(hash: string, key: string, value: string | null): string {
  const { path, params } = splitHash(hash)
  if (value === null) params.delete(key)
  else params.set(key, value)
  const query = params.toString()
  return `#${path || '/'}${query ? `?${query}` : ''}`
}

/** The current route with the Add questions drawer open over it. */
export function addQuestionsHash(hash: string): string {
  return withQueryParam(hash, DIALOG_PARAM, ADD_QUESTIONS_DIALOG)
}

export type OverviewScreenState = 'no_questions' | 'no_checks' | 'ready'

export function screenState(data: VisibilityOverview): OverviewScreenState {
  if (data.kpis.tracked.value === 0) return 'no_questions'
  if (!data.hasChecks) return 'no_checks'
  return 'ready'
}

/** "+2", "−1", "±0". `unit` follows the number, such as " pts". */
export function deltaText(delta: number, unit = ''): string {
  if (delta > 0) return `+${delta}${unit}`
  if (delta < 0) return `−${Math.abs(delta)}${unit}`
  return `±0${unit}`
}

/** The KPI trend chip. None when there is no history for a delta. */
/**
 * The tile's change chip. None for no change: the "was N" line already says so,
 * and a ±0 chip would cut the label short in a narrow window.
 */
export function kpiTrend(delta: number | null, unit = ''): KpiTrend | undefined {
  if (delta === null || delta === 0) return undefined
  return {
    direction: delta > 0 ? 'up' : 'down',
    text: deltaText(delta, unit)
  }
}

export function periodLabel(period: OverviewPeriod): string {
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? '30 days'
}

/**
 * A result in the four shared words (ui/resultTones.ts): "Target page", "Your other page",
 * "Not cited", "No AI Overview", or "Check failed". Named is not a fifth result: it reads
 * "Not cited" here, with its own Named badge beside it ({@link isNamedOnly}). Google's
 * place for a cited page is a column of its own ({@link positionText}).
 */
export function youLabel(
  change: Pick<OverviewQuestion, 'you'> & { ownPage?: OverviewOwnPage | null }
): string {
  switch (change.you) {
    case 'cited':
      return change.ownPage === 'other' ? 'Your other page' : 'Right page'
    case 'named':
    case 'not_cited':
      return 'Not cited'
    case 'no_aio':
      return 'No AI Overview'
    case 'error':
      return 'Check failed'
  }
}

/** True when the brand is named in the answer but no own page is cited: the Named badge. */
export function isNamedOnly(change: Pick<OverviewQuestion, 'you'>): boolean {
  return change.you === 'named'
}

/** Google's place for a cited own page: "#2". A dash when not cited. */
export function positionText(change: Pick<OverviewQuestion, 'you' | 'position'>): string {
  return change.you === 'cited' && change.position !== null ? `#${change.position}` : '—'
}

/**
 * A question's latest result as one of the four (owner, 2026-10-29): cited on the
 * target page or another own page, not cited (named counts as not cited), or no AI
 * Overview. A failed check is not a result yet: null.
 */
export function questionResult(
  question: Pick<OverviewQuestion, 'you'> & { ownPage?: OverviewOwnPage | null }
): ResultBucket | null {
  switch (question.you) {
    case 'cited':
      return question.ownPage === 'other' ? 'other_page' : 'target'
    case 'named':
    case 'not_cited':
      return 'not_cited'
    case 'no_aio':
      return 'no_overview'
    case 'error':
      return null
  }
}

/** Searches that need work: not cited, or cited on a page that is not the target. */
export function needsWork(counts: ResultCounts): number {
  return counts.not_cited + counts.other_page
}

/** Opens the question's prompt detail in the check the change was read from. */
export function changeHref(change: OverviewQuestion): string {
  return promptHash(change.pageId, change.promptId, {
    marketId: change.marketId,
    runId: change.runId
  })
}

/** "Topic: Bulk SMS", or the page path. */
export function sourceText(source: OverviewSource): string {
  return source.kind === 'topic' ? `Topic: ${source.name}` : source.path
}

export function citedInsteadText(names: readonly string[]): string {
  return names.length === 0 ? '—' : names.join(', ')
}

export interface ChartBar {
  endsAt: string
  /** Bar height, 0–100, of the tallest week's overviews. Null before any check. */
  height: number | null
  cited: number | null
  withAio: number | null
  current: boolean
  label: string
}

/**
 * What one counted item is called on Summary: "search" when keywords are tracked too
 * (a keyword is no question), else "question". Name a number by what it counts.
 */
export interface CountNoun {
  one: string
  many: string
  /** Capitalised: "Searches". */
  Many: string
}

export const QUESTION_NOUN: CountNoun = { one: 'question', many: 'questions', Many: 'Questions' }
export const SEARCH_NOUN: CountNoun = { one: 'search', many: 'searches', Many: 'Searches' }

export function countNoun(data: { kpis: Pick<VisibilityOverview['kpis'], 'keywords'> }): CountNoun {
  return data.kpis.keywords > 0 ? SEARCH_NOUN : QUESTION_NOUN
}

/** "3 searches", "1 search". */
export function nounCount(count: number, noun: CountNoun): string {
  return pluralize(count, noun.one, noun.many)
}

/** The Summary trend: cited per week as a line, with its headline and change. */
export interface WeeklyTrend {
  points: { key: string; at: string; value: number | null }[]
  /** The most searches with an AI Overview in any week (the axis top). */
  top: number
  /** This week's cited count. Null before the first check. */
  latest: number | null
  /** Change since the first checked week. Null with fewer than two checked weeks. */
  delta: { text: string; direction: 'up' | 'down' | 'flat' } | null
  /** Said once in words when the first weeks had no check. Null when every week has one. */
  gapNote: string | null
  /** One plain sentence per week, for screen readers. */
  described: string
}

export function weeklyTrend(
  weeks: readonly OverviewWeek[],
  noun: CountNoun = QUESTION_NOUN
): WeeklyTrend {
  const top = Math.max(1, ...weeks.map((week) => week.withAio ?? 0))
  const checked = weeks.filter((week) => week.cited !== null)
  const first = checked[0]
  const last = weeks[weeks.length - 1]
  const latest = last?.cited ?? null
  let delta: WeeklyTrend['delta'] = null
  if (checked.length >= 2 && first && latest !== null) {
    const change = latest - (first.cited ?? 0)
    delta = {
      text:
        change === 0
          ? 'No change since the first check'
          : `${Math.abs(change)} since the first check`,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    }
  }
  const gapNote =
    first && weeks[0]?.cited === null
      ? `No check before the week to ${formatDay(first.endsAt, { year: false })}`
      : checked.length === 0
        ? 'No check yet'
        : null
  const described = weeks
    .map((week) => {
      const day = formatDay(week.endsAt, { year: false })
      return week.cited === null
        ? `Week to ${day}: not checked yet`
        : `Week to ${day}: cited in ${week.cited} of ${nounCount(week.withAio ?? 0, noun)} with an AI Overview`
    })
    .join('. ')
  return {
    points: weeks.map((week) => ({ key: week.endsAt, at: week.endsAt, value: week.cited })),
    top,
    latest,
    delta,
    gapNote,
    described
  }
}

/** "From setup on Oct 23: 1 topic, 10 questions checked, 3 pages suggested to track." */
export function firstReportLine(report: OverviewFirstReport): string {
  const parts = [
    ...(report.topics > 0 ? [pluralize(report.topics, 'topic')] : []),
    `${pluralize(report.questions, 'question')} checked`,
    `${pluralize(report.suggestedPages, 'page')} suggested to track`
  ]
  return `From setup on ${formatDay(report.checkedAt, { year: false })}: ${parts.join(', ')}.`
}

/** "about 46–92 searches", or "about 46 searches" when both ends match. */
export function searchesText(range: { min: number; max: number }): string {
  const low = range.min.toLocaleString('en-US')
  if (range.min === range.max) return `about ${pluralize(range.min, 'search', 'searches')}`
  return `about ${low}–${range.max.toLocaleString('en-US')} searches`
}

/** Plain text of a site address for its copy and open icons. */
export function siteUrl(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`
}

/** True when a cited site's name is its address (no competitor name), such as "reddit.com". */
export function nameIsDomain(name: string, domain: string | null): boolean {
  return domain !== null && name === domain
}

/**
 * The engine tiles with Google AI Overview counted by the headline's own rule: each
 * question's latest result on this Summary (`you`: an own link in the AI Overview is
 * cited), so "35 of 105" never sits under "You're cited 31". Other engines keep their
 * answer counts; the gained and lost moves stay the engine's.
 */
export function withSummaryGoogle(
  counts: readonly EngineCounts[],
  questions: readonly Pick<OverviewQuestion, 'you'>[]
): EngineCounts[] {
  return counts.map((count) => {
    if (count.engine !== 'google_aio') return count
    const out: EngineCounts = {
      ...count,
      checked: questions.length,
      cited: 0,
      named: 0,
      notCited: 0,
      noAnswer: 0,
      unavailable: 0,
      error: 0
    }
    for (const question of questions) {
      if (question.you === 'cited') out.cited += 1
      else if (question.you === 'named') out.named += 1
      else if (question.you === 'not_cited') out.notCited += 1
      else if (question.you === 'no_aio') out.noAnswer += 1
      else out.error += 1
    }
    return out
  })
}
