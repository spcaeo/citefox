import type { PageSummary } from '@shared/domain'
import {
  OVERVIEW_PERIOD_DAYS,
  type OverviewKpi,
  type OverviewWeek,
  type OverviewWeekSearch,
  type VisibilityOverview,
  type VisibilityOverviewRequest
} from '@shared/ipc'
import { readActivePrompts } from '../../questions/reads'
import { estimateCheckSearches } from '../../queue/estimate'
import { combineLive } from '../checks/live-runs'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { listMarkets, readProjectProfile } from '../../storage/project-profile'
import type { ProjectRecord } from '../../storage/records'
import { enabledKeywordCounts, enabledPromptCounts } from '../allpages/rows'
import type { CompetitorLists } from '../checks/competitor-match'
import { citationShare, sharePercentOf } from '../competitors/share'
import {
  changeCounts,
  compareBaseline,
  comparableSources,
  overviewMethod,
  verdictSets
} from './compare'
import { firstReport, openFixes, sourceOf } from './extras'
import { trackedQuestions } from './tracked'
import {
  citedSites,
  countOutcomes,
  hasAio,
  isCited,
  questionRows,
  siteCounts,
  type Counts
} from './measure'
import {
  buildTimeline,
  isWorkingPage,
  readLineage,
  type QuestionOutcome,
  type SourceTimeline
} from './timeline'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `visibility:overview`: the AI visibility home for one project. Every number
 * comes from stored checks of the tracked pages and topics (see `measure.ts`
 * for what cited, named and share mean). Deltas compare the latest state with
 * the compared state (`vs`, `compare.ts`), and are null when nothing had been
 * checked by then. The period sets the weekly chart only.
 */
export function loadVisibilityOverview(
  db: SqliteDatabase,
  project: ProjectRecord,
  request: VisibilityOverviewRequest,
  now: Date
): VisibilityOverview {
  const days = OVERVIEW_PERIOD_DAYS[request.period]
  const builtAt = now.toISOString()
  const periodStart = new Date(now.getTime() - days * DAY_MS).toISOString()
  const marketId = request.marketId ?? null
  const profile = readProjectProfile(db)
  const pages = listPages(db, project.id)
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const enabled = enabledPromptCounts(db)
  const keywordCounts = enabledKeywordCounts(db)
  const lineage = readLineage(db)

  const timelines: SourceTimeline[] = []
  for (const page of pages) {
    if (!isWorkingPage(page)) continue
    const prompts = enabled.get(page.id) ?? 0
    if (prompts === 0) continue
    const timeline = buildTimeline(db, {
      projectId: project.id,
      page,
      marketId,
      enabledPrompts: prompts,
      lineage
    })
    if (timeline !== null) timelines.push(timeline)
  }
  const competitorLists = new Map(timelines.map((item) => [item.page.id, item.competitors]))
  const listsFor = (pageId: string): CompetitorLists =>
    competitorLists.get(pageId) ?? { direct: [], partial: [] }
  const sourceFor = (pageId: string): ReturnType<typeof sourceOf> => sourceOf(pageById.get(pageId))

  const latest = merged(timelines, builtAt)
  const live = combineLive(timelines.flatMap((item) => (item.live === null ? [] : [item.live])))
  // While a check runs, "since" changes wait for its end: a half-done check is not compared.
  const checking = live?.state === 'running'
  const compared = compareBaseline(timelines, request.vs ?? null)
  const baseline = checking ? { ...compared, state: null } : compared
  const current = countOutcomes(latest.state.values())
  const before = baseline.state === null ? null : countOutcomes(baseline.state.values())
  // Share of citations uses the one scope Competitors uses (`citationShare`), so the
  // two screens show the same number for the same market.
  const shareScope = citationShare(db, {
    projectId: project.id,
    domain: project.domain,
    marketId,
    before: baseline.compare.at ?? 'previous',
    links: true
  })
  const share = sharePercentOf(shareScope.now)
  const shareBefore = checking ? null : sharePercentOf(shareScope.before)
  const brand = profile?.brandNames[0] ?? project.domain
  const fixes = openFixes(db, pageById)
  const lastCheckedAt =
    timelines
      .flatMap((item) => item.runs.map((run) => run.finishedAt ?? ''))
      .filter((at) => at.length > 0 && at <= builtAt)
      .sort()
      .at(-1) ?? null
  const comparable = comparableSources(timelines, baseline.state, latest.state)
  // A topic question's target page, so "Target page" matches the topic page.
  const targets = new Map(
    readActivePrompts(db, marketId)
      .filter((prompt) => pageById.get(prompt.pageId)?.kind === 'topic')
      .map((prompt) => [`${prompt.pageId}|${prompt.id}`, { url: prompt.targetUrl }])
  )
  const questions = questionRows(
    baseline.state,
    latest.state,
    sourceFor,
    listsFor,
    (pageId) => comparable.has(pageId),
    (pageId, promptId) => targets.get(`${pageId}|${promptId}`)
  )
  const sites = citedSites(
    latest.state.values(),
    listsFor,
    { name: brand, domain: project.domain },
    5,
    baseline.state === null ? null : siteCounts(baseline.state.values(), listsFor)
  )
  const top = sites.find((site) => !site.own && site.count > 0) ?? null
  const sets = verdictSets({
    latest: latest.state,
    baseline: baseline.state,
    questions,
    listsFor,
    topSiteKey: top === null ? null : top.name.toLowerCase()
  })
  const diff = changeCounts(questions)

  return {
    projectId: project.id,
    domain: project.domain,
    brand,
    period: request.period,
    marketId,
    builtAt,
    periodStart,
    trackedPages: timelines.filter((item) => item.kind === 'page').length,
    trackedTopics: timelines.filter((item) => item.kind === 'topic').length,
    hasChecks: latest.any,
    live,
    lastCheckedAt,
    checkSearches: checkSearches(timelines),
    kpis: {
      tracked: {
        value: timelines.reduce((sum, item) => sum + item.enabledPrompts, 0),
        before: null,
        delta: null
      },
      keywords: timelines.reduce((sum, item) => sum + (keywordCounts.get(item.page.id) ?? 0), 0),
      withAio: kpi(current, before, 'withAio'),
      cited: kpi(current, before, 'cited'),
      named: kpi(current, before, 'named'),
      share: {
        value: share,
        before: shareBefore,
        delta: share === null || shareBefore === null ? null : share - shareBefore,
        ownCitations: shareScope.now.own,
        allCitations: shareScope.now.all,
        questions: shareScope.now.questions
      }
    },
    weeks: weeks(timelines, now, days),
    questions,
    tracked: trackedQuestions(
      db,
      timelines.map((item) => item.page),
      lineage
    ),
    compare: { ...baseline.compare, available: diff !== null },
    diff,
    verdictSets: sets,
    topSite: top === null ? null : { name: top.name, count: sets.top_site.length },
    method: overviewMethod(timelines, latest.state, lastCheckedAt),
    markets: listMarkets(db),
    citedSites: sites,
    shareLinks: shareScope.links,
    fixes: fixes.fixes,
    openFixes: fixes.total,
    firstReport: firstReport(db, project.id, pages)
  }
}

function kpi(
  current: Counts,
  before: Counts | null,
  key: 'withAio' | 'cited' | 'named'
): OverviewKpi {
  return {
    value: current[key],
    before: before === null ? null : before[key],
    delta: before === null ? null : current[key] - before[key]
  }
}

/** Every source's outcomes as of `at`. `any` is false when nothing had been checked by then. */
function merged(
  timelines: readonly SourceTimeline[],
  at: string
): { state: Map<string, QuestionOutcome>; any: boolean } {
  const state = new Map<string, QuestionOutcome>()
  let any = false
  for (const timeline of timelines) {
    const part = timeline.stateAt(at)
    if (part === null) continue
    any = true
    for (const [key, outcome] of part) state.set(key, outcome)
  }
  return { state, any }
}

/** Week ends from the period start (rounded down to whole weeks) to now. */
function weeks(timelines: readonly SourceTimeline[], now: Date, days: number): OverviewWeek[] {
  const count = Math.floor(days / 7)
  const out: OverviewWeek[] = []
  for (let back = count; back >= 0; back -= 1) {
    const endsAt = new Date(now.getTime() - back * 7 * DAY_MS).toISOString()
    const { state, any } = merged(timelines, endsAt)
    const counts = any ? countOutcomes(state.values()) : null
    out.push({
      endsAt,
      cited: counts === null ? null : counts.cited,
      withAio: counts === null ? null : counts.withAio,
      ...(counts === null ? {} : { searches: weekSearches(state.values()) })
    })
  }
  return out
}

/** The questions with an AI Overview in a state: the rows behind a week's `withAio`. */
function weekSearches(outcomes: Iterable<QuestionOutcome>): OverviewWeekSearch[] {
  const out: OverviewWeekSearch[] = []
  for (const outcome of outcomes) {
    if (!hasAio(outcome.row)) continue
    out.push({
      key: outcome.key,
      pageId: outcome.pageId,
      promptId: outcome.promptId,
      marketId: outcome.marketId,
      runId: outcome.runId,
      text: outcome.text,
      cited: isCited(outcome.row)
    })
  }
  return out
}

/** What Check now spends: every tracked page and topic, in every market it has. */
function checkSearches(timelines: readonly SourceTimeline[]): { min: number; max: number } {
  let min = 0
  let max = 0
  for (const timeline of timelines) {
    const estimate = estimateCheckSearches({
      prompts: timeline.enabledPrompts,
      markets: timeline.marketCount,
      samples: samplesOf(timeline.page)
    })
    min += estimate.minSearches
    max += estimate.maxSearches
  }
  return { min, max }
}

function samplesOf(page: PageSummary): number {
  return Number.isInteger(page.samples) && page.samples > 0 ? page.samples : 1
}
