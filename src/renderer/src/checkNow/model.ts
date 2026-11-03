import type { ProjectCheck, ProjectHistory } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import {
  allQuestionCount,
  costLine,
  estimateSearches,
  estimateText,
  formatIds,
  isDue,
  parseIds,
  parseScope,
  resolveScopeIds,
  scopeNeedsIds,
  scopeParams,
  type Scope,
  type ScopeKind,
  type ScopeOptions,
  type ScopePage,
  type SearchEstimate
} from '../scope'

/** The drawer's URL key prefix (`check.scope`, `check.ids`, …), from `DRAWER_KINDS['check-now']`. */
export const CHECK_PREFIX = 'check'

/** The scope kinds Check now offers, in order. */
export const CHECK_KINDS: readonly ScopeKind[] = [
  'due',
  'all',
  'tracked',
  'pages',
  'topic',
  'group',
  'cluster'
]

/**
 * The kinds worth offering: "Everything again" when there is a question to ask,
 * and "Every tracked page" only next to topics (without topics it is the same
 * choice). The kind already chosen stays listed, so an old link still shows it.
 */
export function offeredKinds(options: ScopeOptions, current: ScopeKind): readonly ScopeKind[] {
  const questions = allQuestionCount(options)
  return CHECK_KINDS.filter((kind) => {
    if (kind === current) return true
    if (kind === 'all') return questions > 0
    if (kind === 'tracked') return options.topics.length > 0
    return true
  })
}

/**
 * All questions, only the ones that failed last time (no usable result), only the
 * ones not cited last time, or the ones picked.
 */
export type QuestionMode = 'all' | 'failed' | 'notcited' | 'picked'

/** Everything the Check now drawer holds, all of it on the URL. */
export interface CheckNowState {
  scope: Scope
  /** Picked market ids. Empty is every market. */
  markets: string[]
  only: QuestionMode
  /** Picked question ids (`check.prompts`). */
  prompts: string[]
  /** The page picker's search. */
  q: string
}

export type CheckParams = Readonly<Record<string, string | undefined>>

/**
 * The state in a drawer's values. `check.only=notcited|picked`; ids in
 * `check.prompts` without `check.only` mean "Selected questions" (a screen
 * that hands its selection over sets only the ids).
 */
export function parseCheckParams(params: CheckParams): CheckNowState {
  const scope = parseScope(params, CHECK_PREFIX, 'due', CHECK_KINDS)
  const prompts = parseIds(params['check.prompts'])
  const raw = params['check.only']
  const only: QuestionMode =
    raw === 'notcited' || raw === 'failed'
      ? raw
      : raw === 'picked' || prompts.length > 0
        ? 'picked'
        : 'all'
  return {
    scope,
    markets: parseIds(params['check.markets']),
    only,
    prompts,
    q: params['check.q'] ?? ''
  }
}

/** True when the URL holds a scope of its own (else the screen picks a default). */
export function hasScopeParam(params: CheckParams): boolean {
  return Boolean(params['check.scope'])
}

/**
 * The scope a screen opens on when the URL has none, so Check now is never left
 * off: pages that are due, else every tracked page, else the one topic, else
 * everything (several topics). Only a project with nothing to check keeps "due".
 */
export function defaultScope(options: ScopeOptions, now: Date): Scope {
  if (options.pages.some((page) => checkablePage(page) && isDue(page, now))) {
    return { kind: 'due', ids: [] }
  }
  if (options.pages.some((page) => checkablePage(page) && page.promptCount > 0)) {
    return { kind: 'tracked', ids: [] }
  }
  const topics = options.topics.filter((topic) => (topic.questions ?? 0) > 0)
  const [only] = topics
  if (only && topics.length === 1) return { kind: 'topic', ids: [only.id] }
  if (topics.length > 1) return { kind: 'all', ids: [] }
  return { kind: 'due', ids: [] }
}

/** The state with the default scope in place of a scope the URL does not hold. */
export function withDefaultScope(
  state: CheckNowState,
  chosen: boolean,
  options: ScopeOptions | null,
  now: Date
): CheckNowState {
  if (chosen || options === null) return state
  return { ...state, scope: defaultScope(options, now) }
}

/** URL values for a state change (null removes a key). */
export function checkParamsPatch(state: Partial<CheckNowState>): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  if (state.scope) Object.assign(patch, scopeParams(state.scope, CHECK_PREFIX))
  if (state.markets) patch['check.markets'] = formatIds(state.markets)
  if (state.only) patch['check.only'] = state.only === 'all' ? null : state.only
  if (state.prompts) patch['check.prompts'] = formatIds(state.prompts)
  if (state.q !== undefined) patch['check.q'] = state.q || null
  return patch
}

/** Values that open the drawer on one page (or topic) of the page screen. */
export function pageCheckValues(
  pageId: string,
  kind: 'page' | 'topic',
  extra: Partial<Pick<CheckNowState, 'only' | 'markets' | 'prompts'>> = {}
): Record<string, string | null> {
  return checkParamsPatch({
    scope: { kind: kind === 'topic' ? 'topic' : 'pages', ids: [pageId] },
    ...extra
  })
}

/**
 * One page's questions not cited last time, from `checks:notCited` (asked for
 * the picked markets): every such question, and the markets where at least
 * one was not cited.
 */
export interface NotCitedEntry {
  promptIds: readonly string[]
  marketIds: readonly string[]
}

/** Not-cited (or failed) questions per page. */
export type NotCitedMap = ReadonlyMap<string, NotCitedEntry>

/**
 * Questions with no usable result in their latest check, per page or topic, from
 * `history:listProject` (the same `failedPromptIds` Check history's "Retry failed
 * questions" asks again). Only the latest ended check of each page and market
 * counts; `markets` null is every market.
 */
export function failedMap(history: ProjectHistory, markets: readonly string[] | null): NotCitedMap {
  const latest = new Map<string, ProjectCheck>()
  for (const check of history.checks) {
    if (check.status === 'running') continue
    if (markets !== null && !markets.includes(check.marketId)) continue
    const key = `${check.pageId}|${check.marketId}`
    const seen = latest.get(key)
    if (seen === undefined || seen.startedAt < check.startedAt) latest.set(key, check)
  }
  const out = new Map<string, { promptIds: string[]; marketIds: string[] }>()
  for (const check of latest.values()) {
    if (check.failedPromptIds.length === 0) continue
    const entry = out.get(check.pageId) ?? { promptIds: [], marketIds: [] }
    for (const id of check.failedPromptIds) {
      if (!entry.promptIds.includes(id)) entry.promptIds.push(id)
    }
    if (!entry.marketIds.includes(check.marketId)) entry.marketIds.push(check.marketId)
    out.set(check.pageId, entry)
  }
  return out
}

/** The failed questions of the pages in scope: how many questions, on how many pages. */
export function failedCounts(
  failed: NotCitedMap | null,
  pageIds: readonly string[]
): { questions: number; pages: number } | null {
  if (failed === null) return null
  let questions = 0
  let pages = 0
  for (const id of pageIds) {
    const count = failed.get(id)?.promptIds.length ?? 0
    if (count > 0) pages += 1
    questions += count
  }
  return { questions, pages }
}

/** What a run would do, and why it cannot run when it cannot. */
export interface CheckPlan {
  pageIds: string[]
  marketIds: string[] | null
  promptIds: string[] | null
  estimate: SearchEstimate
  /** Questions "Everything again" asks (before markets and samples). Null for other scopes. */
  questionCount: number | null
  /** Plain reason Run check is off. Null when it can run. */
  blocked: string | null
  /** The way out of `blocked`: a button that changes the choice. Null when there is none. */
  wayOut: WayOut | null
  /** True while the not-cited lists or the picked page's questions load. */
  waiting: boolean
}

/** A button next to a blocked Check now: its label and the choice it makes. */
export interface WayOut {
  label: string
  patch: Partial<CheckNowState>
}

/** The choice "Everything again" is: every tracked page and topic, all their questions. */
export const EVERYTHING_AGAIN: Partial<CheckNowState> = {
  scope: { kind: 'all', ids: [] },
  only: 'all',
  prompts: []
}

export interface PlanInput {
  state: CheckNowState
  options: ScopeOptions
  /** Null while it loads (only needed for `notcited`). */
  notCited: NotCitedMap | null
  /** Null while it loads (only needed for `failed`). */
  failed?: NotCitedMap | null
  /** The one page's question ids when `picked` covers one page; null when unknown. */
  pageQuestions: readonly string[] | null
  now: Date
}

/** Pages Check now can check: tracked, setting up or paused (never not tracked or removed). */
export function checkablePage(page: ScopePage): boolean {
  return page.tracked
}

/** The page ids (and topic ids) the scope covers, checkable ones only. */
export function scopePageIds(state: CheckNowState, options: ScopeOptions, now: Date): string[] {
  const pages = new Map(options.pages.map((page) => [page.id, page]))
  return resolveScopeIds(state.scope, options, now).filter((id) => {
    const page = pages.get(id)
    return page === undefined
      ? options.topics.some((topic) => topic.id === id)
      : checkablePage(page)
  })
}

/** Run check's request and estimate for the drawer's state. */
export function buildPlan(input: PlanInput): CheckPlan {
  const { state, options, now } = input
  const marketIds = state.markets.length > 0 ? state.markets : null
  const inScope = scopePageIds(state, options, now)
  const everything = allQuestionCount(options)
  const noPlan = (blocked: string, waiting = false, wayOut: WayOut | null = null): CheckPlan => ({
    pageIds: [],
    marketIds,
    promptIds: null,
    estimate: { min: 0, max: 0, pages: 0 },
    questionCount: null,
    blocked,
    wayOut,
    waiting
  })

  if (scopeNeedsIds(state.scope.kind) && state.scope.ids.length === 0) {
    return noPlan(pickPrompt(state.scope.kind))
  }
  if (inScope.length === 0) {
    if (state.scope.kind === 'due') {
      const base = nothingDue(options, now)
      if (everything === 0) return noPlan(base)
      return noPlan(
        `${base} Choose “Everything again” to run all ${pluralize(everything, 'question')} now.`,
        false,
        { label: `Run all ${pluralize(everything, 'question')} again`, patch: EVERYTHING_AGAIN }
      )
    }
    return noPlan('None of these pages is tracked yet, so there is nothing to check.')
  }

  let limit: ((id: string) => number | null) | null = null
  let promptIds: string[] | null = null
  let pageIds = inScope
  let runMarkets = marketIds
  if (state.only === 'notcited' || state.only === 'failed') {
    const failedMode = state.only === 'failed'
    const list = failedMode ? (input.failed ?? null) : input.notCited
    if (list === null) {
      return noPlan(
        failedMode
          ? 'Finding the questions that failed last time…'
          : 'Finding the questions not cited last time…',
        true
      )
    }
    pageIds = inScope.filter((id) => (list.get(id)?.promptIds.length ?? 0) > 0)
    promptIds = [...new Set(pageIds.flatMap((id) => list.get(id)?.promptIds ?? []))]
    limit = (id) => list.get(id)?.promptIds.length ?? 0
    if (pageIds.length === 0) {
      return failedMode
        ? noPlan(
            'No question failed last time, so there is nothing to retry. Choose “All questions” to run them again.',
            false,
            { label: 'Run all questions', patch: { only: 'all', prompts: [] } }
          )
        : noPlan('Every question was cited last time, or these pages have no check yet.')
    }
    // Only the picked markets where something was not cited (or failed): a market
    // where every question was fine is not searched again.
    runMarkets = missedMarkets(options, pageIds, list, marketIds)
  } else if (state.only === 'picked') {
    if (state.prompts.length === 0) return noPlan('Pick at least one question to check.')
    promptIds = state.prompts
    const own = input.pageQuestions
    const picked =
      own === null ? state.prompts.length : own.filter((id) => state.prompts.includes(id)).length
    limit = () => picked
  }

  const estimate = estimateSearches(options, pageIds, runMarkets, limit)
  if (estimate.pages === 0) {
    return noPlan('None of these pages is checked in the picked markets.')
  }
  const counted = new Set(
    pageIds.filter((id) => estimateSearches(options, [id], runMarkets, limit).pages > 0)
  )
  return {
    pageIds: pageIds.filter((id) => counted.has(id)),
    marketIds: runMarkets,
    promptIds,
    estimate,
    questionCount:
      state.scope.kind === 'all' && state.only === 'all'
        ? askedQuestions(options, [...counted])
        : null,
    blocked: null,
    wayOut: null,
    waiting: false
  }
}

/** Questions the pages and topics ask (their own enabled questions). */
function askedQuestions(options: ScopeOptions, ids: readonly string[]): number {
  const pages = new Map(options.pages.map((page) => [page.id, page.promptCount]))
  const topics = new Map(options.topics.map((topic) => [topic.id, topic.questions ?? 0]))
  return ids.reduce((sum, id) => sum + (pages.get(id) ?? topics.get(id) ?? 0), 0)
}

/**
 * The markets with a question not cited on any of `pageIds`, within the picked
 * ones (`picked` null is every market), in the project's market order.
 */
export function missedMarkets(
  options: ScopeOptions,
  pageIds: readonly string[],
  notCited: NotCitedMap,
  picked: readonly string[] | null
): string[] {
  const missed = new Set(pageIds.flatMap((id) => notCited.get(id)?.marketIds ?? []))
  const order = [...options.markets.map((market) => market.id), ...missed]
  return [...new Set(order)].filter(
    (id) => missed.has(id) && (picked === null || picked.includes(id))
  )
}

function pickPrompt(kind: ScopeKind): string {
  switch (kind) {
    case 'pages':
      return 'Pick at least one page to check.'
    case 'topic':
      return 'Pick at least one topic to check.'
    case 'group':
      return 'Pick at least one group to check.'
    case 'cluster':
      return 'Pick at least one cluster to check.'
    default:
      return 'Pick what to check.'
  }
}

/**
 * "Nothing is due. Next check: Nov 2 (12 pages)." The pages counted are the
 * ones due on that same day. "Nothing is due and nothing is scheduled." when
 * no page has a next check.
 */
export function nothingDue(options: ScopeOptions, now: Date): string {
  const upcoming = options.pages
    .filter((page) => checkablePage(page) && page.status !== 'paused' && !isDue(page, now))
    .flatMap((page) => (page.nextCheckAt === null ? [] : [Date.parse(page.nextCheckAt)]))
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => a - b)
  const first = upcoming[0]
  if (first === undefined) return 'Nothing is due and nothing is scheduled.'
  const day = dayKey(first)
  const count = upcoming.filter((at) => dayKey(at) === day).length
  return `Nothing is due. Next check: ${shortDate(first)} (${pluralize(count, 'page')}).`
}

function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** "Nov 2", in the computer's time zone. */
export function shortDate(at: number): string {
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Footer line: "3 pages · 2 markets · About 24–48 searches · 3,760 left this month". */
export function planSummary(plan: CheckPlan, options: ScopeOptions): string {
  const markets =
    plan.marketIds === null ? 'every market' : pluralize(plan.marketIds.length, 'market')
  const questions =
    plan.promptIds !== null
      ? pluralize(plan.promptIds.length, 'question')
      : plan.questionCount !== null
        ? pluralize(plan.questionCount, 'question')
        : null
  const topicIds = new Set(options.topics.map((topic) => topic.id))
  const topics = plan.pageIds.filter((id) => topicIds.has(id)).length
  const pages = plan.estimate.pages - topics
  return [
    ...(pages > 0 || topics === 0 ? [pluralize(pages, 'page')] : []),
    ...(topics > 0 ? [pluralize(topics, 'topic')] : []),
    markets,
    ...(questions ? [questions] : []),
    costLine(plan.estimate, options.searchesLeft)
  ].join(' · ')
}

/** The toast when a check starts: "Checking 3 pages · About 24–48 searches". */
export function startedText(plan: Pick<CheckPlan, 'estimate'>): string {
  return `Checking ${pluralize(plan.estimate.pages, 'page')} · ${estimateText(plan.estimate)}`
}

/** The toast when it ends well: "Check finished for 3 pages". */
export function finishedText(pages: number): string {
  return `Check finished for ${pluralize(pages, 'page')}`
}
