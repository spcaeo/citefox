/**
 * Topic scoring and derivation (Docs/TOPICS-SPEC.md sections 2 and 4). Pure:
 * no Node, no Electron, no clock. Main gathers stored results and calls these;
 * exports and renderer previews use the same functions, so every number agrees.
 *
 * Page scoring (page cited 3, other own page 1, brand named 1, not cited 0) is
 * untouched: a topic is scored only by its goal.
 */

import type {
  CitationClass,
  FunnelStage,
  KeywordGroupKind,
  KeywordIntent,
  KeywordUniverse,
  KeywordUniverseRow,
  MatchState,
  PageType,
  PromptCheckStatus,
  TopicBand,
  TopicGoal,
  TopicGoalPoint,
  TopicPromptKind,
  TopicResultRow,
  TopicRowState,
  TopicStage,
  TopicStageCoverage,
  TopicTodoGroup,
  WinOdds,
  WinOddsLevel
} from './domain'
import {
  FUNNEL_LABEL,
  MATCH_STATE_HINT,
  MATCH_STATE_LABEL,
  TODO_STATE_ORDER,
  TOPIC_STAGES,
  TOPIC_STAGE_LABEL
} from './domain'
import { sameTargetPage } from './target-page'

/** One cited source as the scorer needs it (normalized by main's `normalizeUrl`). */
export interface ScoredReference {
  url: string
  normalizedUrl: string
  domain: string
  position: number
  classification: CitationClass
}

/** One prompt's result in one run, or `status: null` when it has none yet. */
export interface TopicOutcome {
  status: PromptCheckStatus | null
  references: readonly ScoredReference[]
  named: boolean | null
  runId: string | null
  checkedAt: string | null
  aioSummary: string | null
}

/** Below this fit % an AI-picked page is a hint only: the result counts the whole site. */
export const SURE_FIT = 60

/**
 * Derives the match state. `targetNormalizedUrl` is the target page's normalized
 * URL (null when the prompt has no target). Any own-domain reference counts as
 * cited; it is `right_page` when it is the target, or when there is no target yet
 * (any page of the site counts until one is set). The match ignores the query
 * (src/shared/target-page.ts), as the check's own topic target match does.
 */
export function deriveRowState(
  outcome: Pick<TopicOutcome, 'status' | 'references'>,
  targetNormalizedUrl: string | null,
  /** Other pages that may answer it (normalized): citing one is the right page too. */
  alsoNormalizedUrls: readonly string[] = []
): TopicRowState {
  if (outcome.status === null) return 'not_checked'
  if (outcome.status === 'error') return 'failed'
  if (outcome.status === 'no_aio') return 'no_aio'
  const own = outcome.references.filter(isOwnReference)
  if (own.length > 0) {
    // No target page yet: any page of the site counts (shown as "Your page cited").
    if (targetNormalizedUrl === null) return 'right_page'
    const pages = [targetNormalizedUrl, ...alsoNormalizedUrls]
    if (own.some((ref) => pages.some((page) => sameTargetPage(ref.normalizedUrl, page)))) {
      return 'right_page'
    }
    return 'other_page'
  }
  return targetNormalizedUrl === null ? 'no_page' : 'not_cited'
}

export function isOwnReference(reference: Pick<ScoredReference, 'classification'>): boolean {
  return reference.classification === 'target' || reference.classification === 'own'
}

/** True when the state counts as cited for the goal. */
export function isCitedState(state: TopicRowState): boolean {
  return state === 'right_page' || state === 'other_page'
}

/** True when the state showed an AI Overview (the goal's denominator). */
export function hasAioState(state: TopicRowState): boolean {
  return (
    state === 'right_page' || state === 'other_page' || state === 'not_cited' || state === 'no_page'
  )
}

export function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 100)
}

/** Cited count needed at the band's lower edge. */
export function neededForBand(withAio: number, band: TopicBand): number {
  if (withAio <= 0) return 0
  return Math.ceil((band.lo / 100) * withAio - 1e-9)
}

export function bandState(rate: number | null, band: TopicBand): TopicGoal['bandState'] {
  if (rate === null) return null
  if (rate < band.lo) return 'below'
  if (rate > band.hi) return 'above'
  return 'in'
}

/** The goal for one kind: cited ÷ prompts that showed an AI Overview. */
export function topicGoal(
  rows: readonly Pick<TopicResultRow, 'kind' | 'state' | 'named'>[],
  kind: TopicPromptKind,
  band: TopicBand
): TopicGoal {
  const mine = rows.filter((row) => row.kind === kind)
  let withAio = 0
  let rightPage = 0
  let otherPage = 0
  let named = 0
  let noAio = 0
  let failed = 0
  let notChecked = 0
  for (const row of mine) {
    if (hasAioState(row.state)) withAio += 1
    if (row.state === 'right_page') rightPage += 1
    if (row.state === 'other_page') otherPage += 1
    if (row.state === 'no_aio') noAio += 1
    if (row.state === 'failed') failed += 1
    if (row.state === 'not_checked') notChecked += 1
    if (row.named === true && hasAioState(row.state)) named += 1
  }
  const cited = rightPage + otherPage
  const rate = percent(cited, withAio)
  const needed = neededForBand(withAio, band)
  return {
    kind,
    prompts: mine.length,
    checked: mine.length - notChecked,
    withAio,
    cited,
    rightPage,
    otherPage,
    named,
    noAio,
    failed,
    notChecked,
    rate,
    band,
    bandState: bandState(rate, band),
    toReachBand: Math.max(0, needed - cited),
    neededForBand: needed
  }
}

/**
 * A topic's one headline number: the target page cited ÷ searches (questions and
 * keywords) that showed an AI Overview. The sidebar, the Topics list and KPIs, the
 * topic header and Progress all show this one; the questions goal stays a goal.
 * Null before any search showed an overview, or when no search was checked.
 */
export function targetPoint(rows: readonly Pick<TopicResultRow, 'state'>[]): TopicGoalPoint | null {
  const checked = rows.filter((row) => row.state !== 'not_checked')
  if (checked.length === 0) return null
  const withAio = checked.filter((row) => hasAioState(row.state)).length
  const cited = checked.filter((row) => row.state === 'right_page').length
  return { withAio, cited, rate: percent(cited, withAio) }
}

/** The headline as a whole percent (see `targetPoint`). */
export function targetRate(rows: readonly Pick<TopicResultRow, 'state'>[]): number | null {
  return targetPoint(rows)?.rate ?? null
}

/** Goal point for the progress line (one kind, one run). */
export function goalPoint(
  rows: readonly Pick<TopicResultRow, 'kind' | 'state'>[],
  kind: TopicPromptKind
): TopicGoalPoint | null {
  const mine = rows.filter((row) => row.kind === kind && row.state !== 'not_checked')
  if (mine.length === 0) return null
  const withAio = mine.filter((row) => hasAioState(row.state)).length
  const cited = mine.filter((row) => isCitedState(row.state)).length
  return { withAio, cited, rate: percent(cited, withAio) }
}

/** Per-stage coverage of the questions, in journey order. Stages with no question are left out. */
export function stageCoverage(
  rows: readonly Pick<TopicResultRow, 'kind' | 'stage' | 'state' | 'promptId'>[]
): TopicStageCoverage[] {
  const out: TopicStageCoverage[] = []
  for (const stage of TOPIC_STAGES) {
    const mine = rows.filter((row) => row.kind === 'question' && row.stage === stage)
    if (mine.length === 0) continue
    const citedIds = mine.filter((row) => isCitedState(row.state)).map((row) => row.promptId)
    const notCitedIds = mine
      .filter((row) => row.state === 'not_cited' || row.state === 'no_page')
      .map((row) => row.promptId)
    const noAioIds = mine.filter((row) => row.state === 'no_aio').map((row) => row.promptId)
    const withAio = citedIds.length + notCitedIds.length
    out.push({
      stage,
      prompts: mine.length,
      withAio,
      cited: citedIds.length,
      notCited: notCitedIds.length,
      noAio: noAioIds.length,
      failed: mine.filter((row) => row.state === 'failed').length,
      rate: percent(citedIds.length, withAio),
      citedIds,
      notCitedIds,
      noAioIds
    })
  }
  return out
}

/** Weakest and strongest stage with at least 2 questions that showed an overview. */
export function stageExtremes(stages: readonly TopicStageCoverage[]): {
  weakest: TopicStageCoverage | null
  strongest: TopicStageCoverage | null
} {
  const eligible = stages.filter((stage) => stage.withAio >= 2 && stage.rate !== null)
  if (eligible.length < 2) return { weakest: null, strongest: null }
  const byRate = [...eligible].sort(
    (a, b) =>
      (a.rate ?? 0) - (b.rate ?? 0) || TOPIC_STAGES.indexOf(a.stage) - TOPIC_STAGES.indexOf(b.stage)
  )
  return { weakest: byRate[0] ?? null, strongest: byRate[byRate.length - 1] ?? null }
}

type UniverseRowInput = Pick<
  TopicResultRow,
  | 'promptId'
  | 'kind'
  | 'state'
  | 'named'
  | 'kwGroup'
  | 'kwGroupKind'
  | 'intent'
  | 'funnel'
  | 'pageType'
>

function universeRow(
  key: string,
  label: string,
  groupKind: KeywordGroupKind | null,
  rows: readonly UniverseRowInput[]
): KeywordUniverseRow {
  const aio = rows.filter((row) => hasAioState(row.state))
  const cited = rows.filter((row) => isCitedState(row.state))
  const named = aio.filter((row) => row.named === true)
  return {
    key,
    label,
    groupKind,
    keywords: rows.length,
    aioShown: aio.length,
    youCited: cited.length,
    brandNamed: named.length,
    citedRate: percent(cited.length, aio.length),
    promptIds: rows.map((row) => row.promptId),
    aioIds: aio.map((row) => row.promptId),
    citedIds: cited.map((row) => row.promptId),
    namedIds: named.map((row) => row.promptId)
  }
}

function groupBy<K extends string>(
  rows: readonly UniverseRowInput[],
  keyOf: (row: UniverseRowInput) => K | null
): Map<K, UniverseRowInput[]> {
  const map = new Map<K, UniverseRowInput[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (key === null) continue
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  return map
}

const INTENT_LABEL: Readonly<Record<KeywordIntent, string>> = {
  informational: 'Informational',
  commercial: 'Commercial',
  navigational: 'Navigational'
}

/** Keyword universe tables: by group, intent, funnel and page type. */
export function keywordUniverse(rows: readonly UniverseRowInput[]): KeywordUniverse {
  const keywords = rows.filter((row) => row.kind === 'keyword')
  const total = universeRow('all', 'All keywords', null, keywords)
  const byGroup = [...groupBy(keywords, (row) => row.kwGroup).entries()].map(([group, list]) =>
    universeRow(group, group, list[0]?.kwGroupKind ?? null, list)
  )
  const byIntent = (['informational', 'commercial', 'navigational'] as const)
    .map((intent) => [intent, keywords.filter((row) => row.intent === intent)] as const)
    .filter(([, list]) => list.length > 0)
    .map(([intent, list]) => universeRow(intent, INTENT_LABEL[intent], null, list))
  const byFunnel = (['tofu', 'mofu', 'bofu'] as const satisfies readonly FunnelStage[])
    .map((funnel) => [funnel, keywords.filter((row) => row.funnel === funnel)] as const)
    .filter(([, list]) => list.length > 0)
    .map(([funnel, list]) => universeRow(funnel, FUNNEL_LABEL[funnel], null, list))
  const byPageType = [...groupBy(keywords, (row) => row.pageType as PageType | null).entries()].map(
    ([type, list]) => universeRow(type, type.charAt(0).toUpperCase() + type.slice(1), null, list)
  )
  return {
    keywords: total.keywords,
    aioShown: total.aioShown,
    youCited: total.youCited,
    brandNamed: total.brandNamed,
    citedRate: total.citedRate,
    byGroup,
    byIntent,
    byFunnel,
    byPageType,
    groupsWithNoCitations: byGroup
      .filter((row) => row.aioShown > 0 && row.youCited === 0)
      .map((row) => row.key)
  }
}

/** To-do groups in to-do order, with counts that equal their id lists. */
export function todoGroups(
  rows: readonly Pick<TopicResultRow, 'promptId' | 'state' | 'winOdds'>[]
): TopicTodoGroup[] {
  return TODO_STATE_ORDER.map((state: MatchState) => {
    const ids = rows
      .filter((row) => row.state === state)
      .sort((a, b) => (b.winOdds?.score ?? -1) - (a.winOdds?.score ?? -1))
      .map((row) => row.promptId)
    return {
      state,
      label: MATCH_STATE_LABEL[state],
      hint: MATCH_STATE_HINT[state],
      count: ids.length,
      promptIds: ids
    }
  })
}

/** Domains that are hard to displace; citing many of these lowers the odds. */
const HEAVYWEIGHT_DOMAINS = [
  'wikipedia.org',
  'youtube.com',
  'reddit.com',
  'forbes.com',
  'g2.com',
  'capterra.com',
  'quora.com',
  'linkedin.com',
  'amazon.com',
  'microsoft.com',
  'google.com',
  'apple.com',
  'nytimes.com',
  'investopedia.com',
  'hubspot.com',
  'techradar.com',
  'pcmag.com',
  'zapier.com'
]

function isHeavyweight(domain: string): boolean {
  const bare = domain.replace(/^www\./, '')
  return HEAVYWEIGHT_DOMAINS.some((big) => bare === big || bare.endsWith(`.${big}`))
}

export function winOddsLevel(score: number): WinOddsLevel {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export interface WinOddsInput {
  state: TopicRowState
  /** Target page exists. */
  hasTarget: boolean
  matchConfidence: number | null
  targetConfirmed: boolean
  references: readonly Pick<ScoredReference, 'domain' | 'classification' | 'position'>[]
  named: boolean | null
}

/**
 * Win odds (0–100) for ordering the to-do. A ranking aid from: an overview shows,
 * own page coverage (match confidence), how many small non-brand domains are
 * cited, and current position. Null when there is nothing to win (no overview,
 * failed, not checked).
 */
export function winOdds(input: WinOddsInput): WinOdds | null {
  if (!hasAioState(input.state)) return null
  let score = 35
  const notes: string[] = []
  if (input.hasTarget) {
    const confidence = input.matchConfidence ?? 50
    score += Math.round(confidence * 0.3)
    if (input.targetConfirmed) score += 5
    if (confidence >= 75) notes.push('your page answers it closely')
    else if (confidence < 45) notes.push('your page only touches it')
  } else {
    score -= 15
    notes.push('no page of yours answers it yet')
  }
  const own = input.references.filter(isOwnReference)
  if (own.length > 0) {
    const best = Math.min(...own.map((ref) => ref.position))
    score += Math.max(0, 12 - best * 2)
    notes.push(
      input.state === 'right_page'
        ? `already cited at position ${best}`
        : `another page of yours is cited at position ${best}`
    )
  }
  const others = input.references.filter((ref) => !isOwnReference(ref))
  const small = others.filter(
    (ref) => ref.classification === 'other' && !isHeavyweight(ref.domain)
  ).length
  const competitors = others.filter((ref) => ref.classification === 'competitor').length
  const heavy = others.filter((ref) => isHeavyweight(ref.domain)).length
  score += Math.min(15, small * 5)
  score -= Math.min(15, competitors * 5)
  score -= Math.min(10, heavy * 3)
  if (small >= 2) notes.push(`${small} small sites are cited`)
  if (competitors > 0)
    notes.push(`${competitors === 1 ? 'a competitor is' : `${competitors} competitors are`} cited`)
  if (heavy >= 2) notes.push('big sites dominate the sources')
  if (input.named === true) {
    score += 5
    notes.push('the overview names your brand')
  }
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const level = winOddsLevel(clamped)
  const reason =
    notes.length === 0
      ? 'An overview shows and nothing stands out either way.'
      : `${capitalize(notes.slice(0, 3).join(', '))}.`
  return { score: clamped, level, reason }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Domains cited instead of the own domain, in position order, at most `limit`. */
export function citedInstead(
  references: readonly Pick<ScoredReference, 'domain' | 'classification' | 'position'>[],
  limit = 5
): string[] {
  const out: string[] = []
  for (const ref of [...references].sort((a, b) => a.position - b.position)) {
    if (isOwnReference(ref)) continue
    const domain = ref.domain.replace(/^www\./, '')
    if (!out.includes(domain)) out.push(domain)
    if (out.length >= limit) break
  }
  return out
}

/** "They're cited, you're not": a tracked competitor is cited and the own domain is not. */
export function competitorCitedNotYou(
  references: readonly Pick<ScoredReference, 'classification'>[]
): boolean {
  return (
    references.some((ref) => ref.classification === 'competitor') &&
    !references.some(isOwnReference)
  )
}

/** Own URL cited (target first, then the best-placed own page). */
export function citedOwn(
  references: readonly ScoredReference[],
  targetNormalizedUrl: string | null
): { url: string; position: number } | null {
  const own = references.filter(isOwnReference).sort((a, b) => a.position - b.position)
  const target = own.find((ref) => sameTargetPage(ref.normalizedUrl, targetNormalizedUrl))
  const pick = target ?? own[0]
  return pick === undefined ? null : { url: pick.url, position: pick.position }
}

/** Display labels for exports and summaries. */
export function stageLabel(stage: TopicStage | null): string {
  return stage === null ? 'No stage' : TOPIC_STAGE_LABEL[stage]
}

/** Prompt counts per state for a list of rows (to-do counts, exports). */
export function stateCounts(
  rows: readonly Pick<TopicResultRow, 'state'>[]
): Record<TopicRowState, number> {
  const counts: Record<TopicRowState, number> = {
    right_page: 0,
    other_page: 0,
    not_cited: 0,
    no_page: 0,
    no_aio: 0,
    failed: 0,
    not_checked: 0
  }
  for (const row of rows) counts[row.state] += 1
  return counts
}
