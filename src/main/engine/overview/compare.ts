import {
  OVERVIEW_VS_DAY,
  type OverviewCompare,
  type OverviewCompareOption,
  type OverviewMethod,
  type OverviewQuestion
} from '@shared/ipc'
import { coverageComparable, type ChangeCounts } from '@shared/report/diff'
import { checkAgreement } from '@shared/report/method'
import { verdictSetsOf, type MetricPair, type MetricRow } from '@shared/metrics'
import type { VerdictSet } from '@shared/report/verdict'
import type { CompetitorLists } from '../checks/competitor-match'
import { metricRowOf } from '../../metrics/rows'
import { isCited, sitesCitedBy } from './measure'
import type { QuestionOutcome, SourceTimeline } from './timeline'

/**
 * The "Compare with" side of the Overview: which earlier state the latest one is
 * compared with (`vs`), the checks to pick from, the verdict's question sets and
 * "How we measure". Partial runs never enter: page timelines hold full runs only. A page
 * or topic whose latest or compared state measured under 90% of its planned questions
 * shows no changes (`comparableSources`).

/** Most earlier checks the picker offers. */
const MAX_OPTIONS = 30

export interface Baseline {
  /** Outcomes at the compared moment, by question key. Null when nothing was checked by then. */
  state: Map<string, QuestionOutcome> | null
  compare: Omit<OverviewCompare, 'available'>
}

/**
 * The compared state. `vs` null: every page and topic against its own previous check.
 * A run id: the state when that check finished. A `YYYY-MM-DD`: the end of that day (UTC).
 * A `vs` that names nothing in this project falls back to previous, marked `unknown`.
 */
export function compareBaseline(timelines: readonly SourceTimeline[], vs: string | null): Baseline {
  const options = compareOptions(timelines)
  let mode: OverviewCompare['mode'] = 'previous'
  let at: string | null = null
  let unknown = false
  if (vs !== null) {
    const run = timelines.flatMap((item) => item.runs).find((item) => item.id === vs)
    if (run?.finishedAt) {
      mode = 'run'
      at = run.finishedAt
    } else if (OVERVIEW_VS_DAY.test(vs) && !Number.isNaN(Date.parse(`${vs}T00:00:00.000Z`))) {
      mode = 'day'
      at = `${vs}T23:59:59.999Z`
    } else {
      unknown = true
    }
  }
  const state = new Map<string, QuestionOutcome>()
  let any = false
  for (const timeline of timelines) {
    const part = at === null ? timeline.stateBefore() : timeline.stateAt(at)
    if (part === null) continue
    any = true
    for (const [key, outcome] of part) state.set(key, outcome)
  }
  return { state: any ? state : null, compare: { vs, mode, at, unknown, options } }
}

/**
 * The pages and topics whose changes may show: both the latest and the compared state
 * measured at least 90% of the questions they planned (a failed search is not measured).
 * Each page and topic is judged on its own, in the one market read, so the comparison
 * stays like for like.
 */
export function comparableSources(
  timelines: readonly SourceTimeline[],
  before: ReadonlyMap<string, QuestionOutcome> | null,
  now: ReadonlyMap<string, QuestionOutcome>
): Set<string> {
  const out = new Set<string>()
  if (before === null) return out
  for (const timeline of timelines) {
    const id = timeline.page.id
    const earlier = ownState(before, id)
    const latest = ownState(now, id)
    if (earlier.size === 0 || latest.size === 0) continue
    if (
      coverageComparable(measured(earlier), timeline.planned(earlier)) &&
      coverageComparable(measured(latest), timeline.planned(latest))
    ) {
      out.add(id)
    }
  }
  return out
}

function ownState(
  state: ReadonlyMap<string, QuestionOutcome>,
  pageId: string
): Map<string, QuestionOutcome> {
  const out = new Map<string, QuestionOutcome>()
  for (const [key, outcome] of state) if (outcome.pageId === pageId) out.set(key, outcome)
  return out
}

function measured(state: ReadonlyMap<string, QuestionOutcome>): number {
  let count = 0
  for (const outcome of state.values()) if (outcome.row.status !== 'error') count += 1
  return count
}

/** The last check finished each day, newest first, the newest check of all left out. */
export function compareOptions(timelines: readonly SourceTimeline[]): OverviewCompareOption[] {
  const runs = timelines
    .flatMap((item) => item.runs)
    .filter((run) => run.finishedAt !== null)
    .sort((left, right) => (left.finishedAt ?? '').localeCompare(right.finishedAt ?? ''))
  const newest = runs.at(-1)
  const byDay = new Map<string, OverviewCompareOption>()
  for (const run of runs) {
    if (run === newest || run.finishedAt === null) continue
    byDay.set(run.finishedAt.slice(0, 10), { value: run.id, at: run.finishedAt })
  }
  return [...byDay.values()].reverse().slice(0, MAX_OPTIONS)
}

export function changeCounts(questions: readonly OverviewQuestion[]): ChangeCounts | null {
  const counts: ChangeCounts = { gained: 0, kept: 0, lost: 0, never: 0, unmatched: 0 }
  for (const question of questions) {
    if (question.change === null) counts.unmatched += 1
    else counts[question.change] += 1
  }
  return counts.unmatched === questions.length ? null : counts
}

/**
 * The question keys behind each verdict number. Counts in the verdict are the
 * lengths of these lists, so a clicked number opens exactly its questions. The rules
 * live in the shared metrics layer (`verdictSetsOf`); the offline report uses them too.
 */
export function verdictSets(input: {
  latest: ReadonlyMap<string, QuestionOutcome>
  baseline: ReadonlyMap<string, QuestionOutcome> | null
  questions: readonly OverviewQuestion[]
  listsFor: (pageId: string) => CompetitorLists
  topSiteKey: string | null
}): Record<VerdictSet, string[]> {
  const pairs: MetricPair[] = []
  for (const question of input.questions) {
    const outcome = input.latest.get(question.key)
    if (outcome === undefined) continue
    const to = verdictRow(question.key, outcome, input.listsFor)
    if (to === null) continue
    // Only a question with a change is compared (the 90% coverage rule hides the rest).
    const earlier = question.change === null ? undefined : input.baseline?.get(question.key)
    const from = earlier === undefined ? null : verdictRow(question.key, earlier, input.listsFor)
    pairs.push({ key: question.key, from, to })
  }
  return verdictSetsOf(pairs, input.topSiteKey)
}

/** One Overview outcome as a metrics row: its id is the question key; sites by name. */
function verdictRow(
  key: string,
  outcome: QuestionOutcome,
  listsFor: (pageId: string) => CompetitorLists
): MetricRow | null {
  return metricRowOf(outcome.row, {
    id: key,
    questionId: key,
    text: outcome.text,
    engine: 'google_aio',
    marketId: outcome.marketId,
    sourceId: outcome.pageId,
    sourceKind: 'page',
    checkId: outcome.runId,
    checkedAt: outcome.checkedAt,
    domains: [...sitesCitedBy(outcome.row, listsFor(outcome.pageId)).keys()]
  })
}

/** What was searched and when, and whether page and topic checks agree. */
export function overviewMethod(
  timelines: readonly SourceTimeline[],
  latest: ReadonlyMap<string, QuestionOutcome>,
  lastCheckAt: string | null
): OverviewMethod {
  const kindOf = new Map(timelines.map((item) => [item.page.id, item.kind]))
  const outcomes = [...latest.values()]
  const marketIds = [...new Set(outcomes.map((item) => item.marketId))]
  const firstCheckAt =
    timelines
      .flatMap((item) => item.runs.map((run) => run.finishedAt ?? ''))
      .filter((at) => at.length > 0)
      .sort()[0] ?? null
  const agreement = checkAgreement(
    outcomes
      .filter((item) => item.row.status !== 'error')
      .map((item) => ({
        id: item.key,
        text: item.text,
        marketId: item.marketId,
        source: kindOf.get(item.pageId) === 'topic' ? ('topic' as const) : ('page' as const),
        cited: isCited(item.row)
      }))
  )
  return { marketIds, firstCheckAt, lastCheckAt, agreement }
}
