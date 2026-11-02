import { opportunityBucketOf } from '@shared/report-copy'
import type {
  AioReference,
  CannibalizingPage,
  CheckComparisonColumn,
  CheckRunKind,
  CheckRunStatus,
  CompetitorLeaderboardRow,
  ContentChange,
  CoverageLevel,
  FunnelStep,
  IntentStage,
  MarketCheckMetrics,
  OpportunityBucket,
  PageResults,
  PromptCheckRow,
  PromptCheckStatus,
  PromptMovement,
  PromptSource,
  ResultsScope,
  StageRate,
  TopAction,
  TrendPoint,
  UgcOverlay
} from '@shared/domain'
import {
  STALE_CHECK_DAYS,
  VISIBILITY_POINT_BRAND_MENTIONED,
  VISIBILITY_POINT_NOT_CITED,
  VISIBILITY_POINT_OTHER_OWN,
  VISIBILITY_POINT_PAGE_CITED
} from '@shared/domain'
import { isOwnHost } from './classify'
import { bareDomain } from './url'

/** Statuses of a prompt whose overview showed (section 7.2). */
export const AIO_STATUSES = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

const STAGE_ORDER: readonly IntentStage[] = [
  'problem',
  'solution',
  'trigger',
  'comparison',
  'objection',
  'unset'
]

const DROP_REASON: Record<string, string> = {
  aio_shown: 'No AI Overview',
  own_domain: 'The overview did not cite your domain',
  this_page: 'The overview cited another page on your domain',
  cited_and_named: 'This page was cited without the brand name'
}

export interface ScoreSample {
  sampleNo: number
  status: PromptCheckStatus
  named: boolean | null
  citedUrl: string | null
  position: number | null
  aioText: string | null
  references: readonly AioReference[]
}

export interface ScorePrompt {
  promptId: string
  promptPosition: number
  label: string
  text: string
  source: PromptSource
  intentStage: IntentStage
  samples: readonly ScoreSample[]
  coverage: CoverageLevel | null
  action: string | null
  mainGap: string | null
  checkedAt: string | null
}

export interface BuiltPrompt {
  row: PromptCheckRow
  winning: ScoreSample | null
  samples: readonly ScoreSample[]
}

export function pointsFor(status: PromptCheckStatus): number | null {
  if (status === 'page_cited') return VISIBILITY_POINT_PAGE_CITED
  if (status === 'other_own_page') return VISIBILITY_POINT_OTHER_OWN
  if (status === 'brand_mentioned') return VISIBILITY_POINT_BRAND_MENTIONED
  if (status === 'not_cited') return VISIBILITY_POINT_NOT_CITED
  return null
}

/**
 * Section 7.1. The most common status wins. A tie takes the higher points.
 * Other-own and brand mentioned share 1 point, so the earlier sample wins.
 * `error` loses to any other status.
 */
export function rollupSamples(samples: readonly ScoreSample[]): {
  status: PromptCheckStatus
  matching: number
  position: number | null
  citedUrl: string | null
  named: boolean | null
  references: readonly AioReference[]
  winning: ScoreSample | null
} {
  const ordered = [...samples].sort((left, right) => left.sampleNo - right.sampleNo)
  const pool = ordered.some((sample) => sample.status !== 'error')
    ? ordered.filter((sample) => sample.status !== 'error')
    : ordered
  const counts = new Map<PromptCheckStatus, number>()
  for (const sample of pool) counts.set(sample.status, (counts.get(sample.status) ?? 0) + 1)
  let status: PromptCheckStatus = pool[0]?.status ?? 'error'
  let bestCount = -1
  let bestPoints = -1
  let bestIndex = Number.POSITIVE_INFINITY
  for (const [candidate, count] of counts) {
    const points = pointsFor(candidate) ?? -1
    const index = pool.findIndex((sample) => sample.status === candidate)
    const better =
      count > bestCount ||
      (count === bestCount && points > bestPoints) ||
      (count === bestCount && points === bestPoints && index < bestIndex)
    if (!better) continue
    status = candidate
    bestCount = count
    bestPoints = points
    bestIndex = index
  }
  const matching = ordered.filter((sample) => sample.status === status).length
  const winners = ordered.filter((sample) => sample.status === status)
  const positions = winners
    .map((sample) => sample.position)
    .filter((position): position is number => position !== null)
  const winning = winners[0] ?? null
  return {
    status,
    matching,
    position: positions.length === 0 ? null : mean(positions),
    citedUrl: winning?.citedUrl ?? null,
    named: status === 'no_aio' || status === 'error' ? null : (winning?.named ?? null),
    references: winning?.references ?? [],
    winning
  }
}

export function movementFor(
  previous: { status: PromptCheckStatus; position: number | null } | null,
  current: { status: PromptCheckStatus; position: number | null }
): PromptMovement | null {
  if (previous === null) return null
  if (current.status === 'page_cited' && previous.status !== 'page_cited') return 'gained'
  if (previous.status === 'page_cited' && current.status !== 'page_cited') return 'lost'
  const currentPoints = pointsFor(current.status)
  const previousPoints = pointsFor(previous.status)
  if (currentPoints === null || previousPoints === null) return 'unchanged'
  if (currentPoints > previousPoints) return 'improved'
  if (currentPoints < previousPoints) return 'declined'
  if (current.status !== previous.status) return 'unchanged'
  if (current.position === null || previous.position === null) return 'unchanged'
  if (current.position < previous.position) return 'improved'
  if (current.position > previous.position) return 'declined'
  return 'unchanged'
}

export function buildPromptRows(
  prompts: readonly ScorePrompt[],
  previous: ReadonlyMap<string, { status: PromptCheckStatus; position: number | null }>
): BuiltPrompt[] {
  return [...prompts]
    .sort((left, right) => left.promptPosition - right.promptPosition)
    .map((prompt) => {
      const rolled = rollupSamples(prompt.samples)
      const prior = previous.get(prompt.promptId) ?? null
      const row: PromptCheckRow = {
        promptId: prompt.promptId,
        promptPosition: prompt.promptPosition,
        label: prompt.label,
        text: prompt.text,
        source: prompt.source,
        intentStage: prompt.intentStage,
        status: rolled.status,
        frequency: { matching: rolled.matching, samples: prompt.samples.length },
        position: rolled.position,
        citedUrl: rolled.citedUrl,
        references: rolled.references,
        wrongPageCited: rolled.status === 'other_own_page',
        named: rolled.named,
        movement: movementFor(prior, { status: rolled.status, position: rolled.position }),
        previousStatus: prior?.status ?? null,
        previousPosition: prior?.position ?? null,
        coverage: prompt.coverage,
        action: prompt.action,
        aioSummary: clip(rolled.winning?.aioText ?? null),
        checkedAt: prompt.checkedAt
      }
      return { row, winning: rolled.winning, samples: prompt.samples }
    })
}

export interface RunIdentity {
  runId: string
  pageId: string
  marketId: string
  promptSetId: string
  promptSetVersion: number
  snapshotId: string
  contentHash: string
  kind: CheckRunKind
  partial: boolean
  status: CheckRunStatus
  startedAt: string
  finishedAt: string | null
}

export function metricsFor(
  identity: RunIdentity,
  built: readonly BuiltPrompt[],
  contentChanged: boolean,
  contentChange: ContentChange | null
): MarketCheckMetrics {
  const rows = built.map((item) => item.row)
  const aio = rows.filter((row) => AIO_STATUSES.has(row.status))
  const points = aio.reduce((sum, row) => sum + (pointsFor(row.status) ?? 0), 0)
  const pointsPossible = aio.length * VISIBILITY_POINT_PAGE_CITED
  let thisPage = 0
  let otherOwn = 0
  const targetPositions: number[] = []
  for (const item of built) {
    const winning = item.winning
    if (winning === null) continue
    const seen = new Set<string>()
    for (const reference of winning.references) {
      if (seen.has(reference.normalizedUrl)) continue
      seen.add(reference.normalizedUrl)
      if (reference.classification === 'target') thisPage += 1
      if (reference.classification === 'own') otherOwn += 1
    }
  }
  for (const item of built) {
    for (const sample of item.samples) {
      for (const reference of sample.references) {
        if (reference.classification === 'target') targetPositions.push(reference.position)
      }
    }
  }
  return {
    runId: identity.runId,
    pageId: identity.pageId,
    marketId: identity.marketId,
    promptSetId: identity.promptSetId,
    promptSetVersion: identity.promptSetVersion,
    snapshotId: identity.snapshotId,
    contentHash: identity.contentHash,
    contentChanged,
    contentChange,
    kind: identity.kind,
    partial: identity.partial,
    status: identity.status,
    startedAt: identity.startedAt,
    finishedAt: identity.finishedAt,
    promptsChecked: rows.length,
    promptsWithAio: aio.length,
    pageCited: rows.filter((row) => row.status === 'page_cited').length,
    otherOwnPage: rows.filter((row) => row.status === 'other_own_page').length,
    brandMentioned: rows.filter((row) => row.status === 'brand_mentioned').length,
    notCited: rows.filter((row) => row.status === 'not_cited').length,
    noAio: rows.filter((row) => row.status === 'no_aio').length,
    errors: rows.filter((row) => row.status === 'error').length,
    points,
    pointsPossible,
    visibilityScore: pointsPossible === 0 ? null : Math.round((points / pointsPossible) * 100),
    citationsThisPage: thisPage,
    citationsOtherOwn: otherOwn,
    citedAndNamed: rows.filter((row) => row.status === 'page_cited' && row.named === true).length,
    averagePosition: targetPositions.length === 0 ? null : mean(targetPositions)
  }
}

export function comparisonColumn(
  which: CheckComparisonColumn['which'],
  metrics: MarketCheckMetrics | null
): CheckComparisonColumn {
  if (metrics === null) {
    return {
      which,
      runId: null,
      finishedAt: null,
      score: null,
      pageCited: null,
      anyOwnPageCited: null,
      linksThisPage: null,
      linksOtherOwn: null,
      brandMentioned: null,
      aiosShown: null,
      averagePosition: null,
      contentChanged: null,
      promptsChecked: 0
    }
  }
  return {
    which,
    runId: metrics.runId,
    finishedAt: metrics.finishedAt,
    score: metrics.visibilityScore,
    pageCited: metrics.pageCited,
    anyOwnPageCited: metrics.pageCited + metrics.otherOwnPage,
    linksThisPage: metrics.citationsThisPage,
    linksOtherOwn: metrics.citationsOtherOwn,
    brandMentioned: metrics.brandMentioned,
    aiosShown: metrics.promptsWithAio,
    averagePosition: metrics.averagePosition,
    contentChanged: metrics.contentChanged,
    promptsChecked: metrics.promptsChecked
  }
}

export function buildFunnel(rows: readonly PromptCheckRow[]): FunnelStep[] {
  const checked = rows.map((row) => row.promptId)
  const aio = rows.filter((row) => AIO_STATUSES.has(row.status)).map((row) => row.promptId)
  const own = rows
    .filter((row) => row.status === 'page_cited' || row.status === 'other_own_page')
    .map((row) => row.promptId)
  const page = rows.filter((row) => row.status === 'page_cited').map((row) => row.promptId)
  const named = rows
    .filter((row) => row.status === 'page_cited' && row.named === true)
    .map((row) => row.promptId)
  const steps: Array<{ id: FunnelStep['id']; ids: string[] }> = [
    { id: 'checked', ids: checked },
    { id: 'aio_shown', ids: aio },
    { id: 'own_domain', ids: own },
    { id: 'this_page', ids: page },
    { id: 'cited_and_named', ids: named }
  ]
  return steps.map((step, index) => {
    const previous = steps[index - 1]
    const dropIds =
      previous === undefined ? [] : previous.ids.filter((id) => !step.ids.includes(id))
    return {
      id: step.id,
      count: step.ids.length,
      promptIds: step.ids,
      drop:
        previous === undefined
          ? null
          : {
              count: dropIds.length,
              reason: dropReason(step.id, dropIds, rows),
              promptIds: dropIds
            }
    }
  })
}

/**
 * Why prompts leave a funnel step. Between "checked" and "AI Overview appears" a
 * prompt whose search failed is not "No AI Overview": the overview is unknown.
 */
function dropReason(
  id: FunnelStep['id'],
  dropIds: readonly string[],
  rows: readonly PromptCheckRow[]
): string {
  const reason = DROP_REASON[id] ?? ''
  if (id !== 'aio_shown') return reason
  const dropped = new Set(dropIds)
  const failed = rows.filter((row) => dropped.has(row.promptId) && row.status === 'error').length
  if (failed === 0) return reason
  const noAio = dropIds.length - failed
  if (noAio === 0) return 'The search failed, so the AI Overview is unknown'
  return `No AI Overview (${noAio}) or the search failed (${failed})`
}

export function buildBuckets(rows: readonly PromptCheckRow[]): OpportunityBucket[] {
  const ids: readonly OpportunityBucket['id'][] = [
    'winning',
    'cited_only',
    'named_not_linked',
    'invisible'
  ]
  return ids.map((id) => {
    const promptIds = rows
      .filter((row) => opportunityBucketOf(row) === id)
      .map((row) => row.promptId)
    return { id, count: promptIds.length, promptIds }
  })
}

export function buildUgc(built: readonly BuiltPrompt[]): UgcOverlay {
  const promptIds = built
    .filter((item) => ugcAboveOwn(item.winning?.references ?? []))
    .map((item) => item.row.promptId)
  return { count: promptIds.length, promptIds }
}

function ugcAboveOwn(references: readonly AioReference[]): boolean {
  const ugc = references.filter(
    (reference) => reference.sourceType === 'reddit' || reference.sourceType === 'youtube'
  )
  if (ugc.length === 0) return false
  const own = references.filter(
    (reference) => reference.classification === 'target' || reference.classification === 'own'
  )
  if (own.length === 0) return true
  const bestOwn = Math.min(...own.map((reference) => reference.position))
  return ugc.some((reference) => reference.position < bestOwn)
}

/**
 * Section 7.2 top competitors. Own pages, including counted subdomains, fold into
 * the `you` row through the same matcher classification uses (FR-6.5).
 * References already classified `target` or `own` are always yours.
 *
 * A domain is `tracked` when the run stored it as a competitor: the competitors of
 * the page's product when it ran (Docs/PROMPT-AUDIT.md P9). So the badge agrees with
 * the citation counts, and an old run keeps the classification it was stored with.
 */
export function buildLeaderboard(
  built: readonly BuiltPrompt[],
  ownDomain: string,
  includeSubdomains = false
): CompetitorLeaderboardRow[] {
  const aio = built.filter((item) => AIO_STATUSES.has(item.row.status))
  if (aio.length === 0) return []
  const own = bareDomain(ownDomain)
  const rowDomain = (reference: AioReference): string =>
    reference.classification === 'target' ||
    reference.classification === 'own' ||
    isOwnHost(reference.domain, own, includeSubdomains)
      ? own
      : reference.domain
  const competitorDomains = new Set(
    aio.flatMap((item) =>
      (item.winning?.references ?? [])
        .filter((reference) => reference.classification === 'competitor')
        .map(rowDomain)
    )
  )
  type LeaderboardBucket = { positions: number[]; prompts: string[]; gaps: string[] }
  const domains = new Map<string, LeaderboardBucket>()
  const ensure = (domain: string): LeaderboardBucket => {
    const found = domains.get(domain)
    if (found !== undefined) return found
    const created = { positions: [] as number[], prompts: [] as string[], gaps: [] as string[] }
    domains.set(domain, created)
    return created
  }
  const citesOwn = (item: BuiltPrompt): boolean =>
    (item.winning?.references ?? []).some((reference) => rowDomain(reference) === own)
  for (const item of aio) {
    const references = item.winning?.references ?? []
    const ownCited = citesOwn(item)
    const byDomain = new Map<string, number>()
    for (const reference of references) {
      const domain = rowDomain(reference)
      const current = byDomain.get(domain)
      if (current === undefined || reference.position < current) {
        byDomain.set(domain, reference.position)
      }
    }
    for (const [domain, position] of byDomain) {
      const row = ensure(domain)
      row.prompts.push(item.row.promptId)
      row.positions.push(position)
      if (domain !== own && !ownCited) row.gaps.push(item.row.promptId)
    }
  }
  if (!domains.has(own)) ensure(own)
  const rows: CompetitorLeaderboardRow[] = []
  for (const [domain, row] of domains) {
    const badge = domain === own ? 'you' : competitorDomains.has(domain) ? 'tracked' : 'observed'
    const overlap =
      badge === 'you'
        ? null
        : row.prompts.filter((id) => {
            const item = aio.find((entry) => entry.row.promptId === id)
            return item !== undefined && citesOwn(item)
          }).length
    rows.push({
      domain,
      badge,
      aioCount: row.prompts.length,
      overlap,
      gap: badge === 'you' ? null : row.gaps.length,
      averagePosition: row.positions.length === 0 ? 0 : mean(row.positions),
      promptIds: row.prompts,
      gapPromptIds: badge === 'you' ? [] : row.gaps
    })
  }
  const rank = { you: 0, tracked: 1, observed: 2 }
  rows.sort((left, right) => rank[left.badge] - rank[right.badge] || right.aioCount - left.aioCount)
  return rows
}

export function buildCannibalizing(
  built: readonly BuiltPrompt[],
  pages: ReadonlyMap<string, string>
): CannibalizingPage[] {
  const groups = new Map<string, CannibalizingPage>()
  for (const item of built) {
    for (const reference of item.winning?.references ?? []) {
      if (reference.classification !== 'own') continue
      const current = groups.get(reference.normalizedUrl)
      const hit = { promptId: item.row.promptId, position: reference.position }
      if (current === undefined) {
        groups.set(reference.normalizedUrl, {
          url: reference.url,
          normalizedUrl: reference.normalizedUrl,
          tracked: !reference.untracked,
          pageId: pages.get(reference.normalizedUrl) ?? null,
          prompts: [hit]
        })
      } else {
        groups.set(reference.normalizedUrl, { ...current, prompts: [...current.prompts, hit] })
      }
    }
  }
  return [...groups.values()]
}

export function buildStageRates(rows: readonly PromptCheckRow[]): StageRate[] {
  return STAGE_ORDER.flatMap((stage) => {
    const prompts = rows.filter((row) => row.intentStage === stage)
    if (prompts.length === 0) return []
    return [
      {
        stage,
        prompts: prompts.length,
        pageCited: prompts.filter((row) => row.status === 'page_cited').length
      }
    ]
  })
}

export function buildTopActions(
  rows: readonly PromptCheckRow[],
  gaps: ReadonlyMap<string, string>
): TopAction[] {
  const actions: TopAction[] = []
  for (const row of rows) {
    if (row.status === 'page_cited') continue
    if (row.action === null || row.action.trim().length === 0) continue
    actions.push({
      rank: actions.length + 1,
      text: row.action,
      reason: gaps.get(row.promptId) ?? '',
      linkLabel: `Open the gap for prompt ${row.promptPosition}`,
      screen: 'gaps',
      promptId: row.promptId
    })
    if (actions.length === 3) break
  }
  return actions
}

export function contentChangeBetween(
  previous: { faqs: number; words: number; h2: number; h3: number },
  current: { faqs: number; words: number; h2: number; h3: number }
): ContentChange {
  const faqsAdded = current.faqs - previous.faqs
  const wordsAdded = current.words - previous.words
  const headingsChanged = Math.abs(current.h2 + current.h3 - (previous.h2 + previous.h3))
  const parts: string[] = []
  if (faqsAdded !== 0) parts.push(countPhrase(faqsAdded, 'FAQ', 'added', 'removed'))
  if (wordsAdded !== 0) parts.push(countPhrase(wordsAdded, 'word', 'added', 'removed'))
  if (headingsChanged !== 0) {
    parts.push(`${headingsChanged} heading${headingsChanged === 1 ? '' : 's'} changed`)
  }
  const summary = parts.length === 0 ? 'The page content changed.' : `${parts.join(', ')}.`
  return { summary, faqsAdded, wordsAdded, headingsChanged }
}

function countPhrase(delta: number, noun: string, up: string, down: string): string {
  const count = Math.abs(delta)
  const plural = noun === 'FAQ' ? (count === 1 ? 'FAQ' : 'FAQs') : count === 1 ? noun : `${noun}s`
  return `${count} ${plural} ${delta > 0 ? up : down}`
}

export interface PageScoreInput {
  scope: ResultsScope
  identity: RunIdentity | null
  prompts: readonly ScorePrompt[]
  previousRows: ReadonlyMap<string, { status: PromptCheckStatus; position: number | null }>
  contentChanged: boolean
  contentChange: ContentChange | null
  baseline: MarketCheckMetrics | null
  previous: MarketCheckMetrics | null
  ownDomain: string
  /** Project setting. Own subdomains join the `you` row only when this is true. */
  includeSubdomains: boolean
  gapReasons: ReadonlyMap<string, string>
  trackedPages: ReadonlyMap<string, string>
}

export function buildPageResults(input: PageScoreInput): PageResults {
  const built = input.identity === null ? [] : buildPromptRows(input.prompts, input.previousRows)
  const run =
    input.identity === null
      ? null
      : metricsFor(input.identity, built, input.contentChanged, input.contentChange)
  const rows = built.map((item) => item.row)
  return {
    scope: input.scope,
    run,
    scoreChange: {
      sincePrevious: scoreDelta(
        run?.visibilityScore ?? null,
        input.previous?.visibilityScore ?? null
      ),
      sinceBaseline: scoreDelta(
        run?.visibilityScore ?? null,
        input.baseline?.visibilityScore ?? null
      )
    },
    comparison: [
      comparisonColumn('baseline', input.baseline),
      comparisonColumn('previous', input.previous),
      comparisonColumn('current', run)
    ],
    runSummary: null,
    funnel: buildFunnel(rows),
    buckets: buildBuckets(rows),
    ugcOverlay: buildUgc(built),
    prompts: rows,
    leaderboard: buildLeaderboard(built, input.ownDomain, input.includeSubdomains),
    cannibalizing: buildCannibalizing(built, input.trackedPages),
    stageRates: buildStageRates(rows),
    topActions: buildTopActions(rows, input.gapReasons)
  }
}

export function emptyPageResults(scope: ResultsScope): PageResults {
  return buildPageResults({
    scope,
    identity: null,
    prompts: [],
    previousRows: new Map(),
    contentChanged: false,
    contentChange: null,
    baseline: null,
    previous: null,
    ownDomain: '',
    includeSubdomains: false,
    gapReasons: new Map(),
    trackedPages: new Map()
  })
}

export function trendPoint(metrics: MarketCheckMetrics, promptsTotal: number): TrendPoint {
  return {
    runId: metrics.runId,
    finishedAt: metrics.finishedAt ?? metrics.startedAt,
    promptSetVersion: metrics.promptSetVersion,
    partial: metrics.partial,
    pageCitedRate: metrics.promptsWithAio === 0 ? null : metrics.pageCited / metrics.promptsWithAio,
    promptsChecked: metrics.promptsChecked,
    promptsTotal,
    visibilityScore: metrics.visibilityScore,
    contentChanged: metrics.contentChanged
  }
}

/** NFR-14. Same checks the Results screen uses, so a stored payload cannot drift. */
export function consistencyIssues(results: PageResults): string[] {
  const issues: string[] = []
  results.funnel.forEach((step, index) => {
    if (step.promptIds.length !== step.count) {
      issues.push(`funnel ${step.id} count ${step.count} lists ${step.promptIds.length}`)
    }
    if (step.drop && step.drop.promptIds.length !== step.drop.count) {
      issues.push(`drop ${step.id} count ${step.drop.count} lists ${step.drop.promptIds.length}`)
    }
    const previous = results.funnel[index - 1]
    if (index > 0 && previous && step.drop && step.drop.count !== previous.count - step.count) {
      issues.push(`drop ${step.id} is ${step.drop.count}, expected ${previous.count - step.count}`)
    }
  })
  const seen = new Set<string>()
  let bucketSum = 0
  for (const bucket of results.buckets) {
    bucketSum += bucket.count
    if (bucket.promptIds.length !== bucket.count) {
      issues.push(`bucket ${bucket.id} count ${bucket.count} lists ${bucket.promptIds.length}`)
    }
    for (const id of bucket.promptIds) {
      if (seen.has(id)) issues.push(`prompt ${id} is in more than one bucket`)
      seen.add(id)
    }
  }
  const aioIds = results.prompts
    .filter((row) => AIO_STATUSES.has(row.status))
    .map((row) => row.promptId)
  if (results.run && bucketSum !== results.run.promptsWithAio) {
    issues.push(`buckets sum ${bucketSum}, promptsWithAio ${results.run.promptsWithAio}`)
  }
  if (bucketSum !== aioIds.length)
    issues.push(`buckets sum ${bucketSum}, aio rows ${aioIds.length}`)
  for (const id of aioIds) {
    if (!seen.has(id)) issues.push(`aio prompt ${id} is in no bucket`)
  }
  if (results.ugcOverlay.promptIds.length !== results.ugcOverlay.count) {
    issues.push(
      `ugc count ${results.ugcOverlay.count} lists ${results.ugcOverlay.promptIds.length}`
    )
  }
  for (const row of results.leaderboard) {
    if (row.promptIds.length !== row.aioCount) {
      issues.push(`${row.domain} aioCount ${row.aioCount} lists ${row.promptIds.length}`)
    }
    if (row.badge === 'you' && (row.overlap !== null || row.gap !== null)) {
      issues.push('you row has overlap or gap')
    } else if (row.gap !== null && row.gapPromptIds.length !== row.gap) {
      issues.push(`${row.domain} gap ${row.gap} lists ${row.gapPromptIds.length}`)
    }
  }
  if (results.run) {
    const run = results.run
    const score =
      run.pointsPossible === 0 ? null : Math.round((run.points / run.pointsPossible) * 100)
    if (score !== run.visibilityScore) issues.push(`score ${run.visibilityScore} expected ${score}`)
    const pageCited = results.prompts.filter((row) => row.status === 'page_cited').length
    if (pageCited !== run.pageCited) issues.push(`pageCited ${run.pageCited} rows ${pageCited}`)
    const stageCited = results.stageRates.reduce((sum, rate) => sum + rate.pageCited, 0)
    if (stageCited !== run.pageCited) {
      issues.push(`stage pageCited ${stageCited} run ${run.pageCited}`)
    }
  }
  return issues
}

export function isStale(checkedAt: string | null, builtAt: string): boolean {
  if (checkedAt === null) return false
  const checked = Date.parse(checkedAt)
  const built = Date.parse(builtAt)
  if (Number.isNaN(checked) || Number.isNaN(built)) return false
  return built - checked > STALE_CHECK_DAYS * 86_400_000
}

function scoreDelta(current: number | null, other: number | null): number | null {
  if (current === null || other === null) return null
  return current - other
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function clip(text: string | null): string | null {
  if (text === null) return null
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length === 0) return null
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}...`
}
