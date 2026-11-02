import type {
  AioReference,
  CannibalizingPage,
  CheckComparisonColumn,
  CheckRunKind,
  CompetitorLeaderboardRow,
  ContentChange,
  FunnelDrop,
  FunnelStep,
  FunnelStepId,
  IntentStage,
  MarketCheckMetrics,
  OpportunityBucket,
  OpportunityBucketId,
  PageResults,
  PageScoreList,
  PageScoreSummary,
  ProjectScoreList,
  ProjectScoreSummary,
  PromptCheckRow,
  PromptCheckStatus,
  ResultsHistory
} from '@shared/domain'
import {
  VISIBILITY_POINT_BRAND_MENTIONED,
  VISIBILITY_POINT_NOT_CITED,
  VISIBILITY_POINT_OTHER_OWN,
  VISIBILITY_POINT_PAGE_CITED
} from '@shared/domain'
import type { GetResultsRequest, ProjectIdRequest, ResultsHistoryRequest } from '@shared/ipc'
import { opportunityBucketOf } from '@shared/report-copy'
import { textboltResults } from '../m3/fixtures'
import { hasAio } from '../m3/model'
import type { VisibilitySource } from './source'
import { averageScore, meanChange } from './trends'

const SAMPLE_PAGES = new Set(['alerts', 'textbolt-alerts'])
const FUNNEL: readonly FunnelStepId[] = [
  'checked',
  'aio_shown',
  'own_domain',
  'this_page',
  'cited_and_named'
]
const BUCKETS: readonly OpportunityBucketId[] = [
  'winning',
  'cited_only',
  'named_not_linked',
  'invisible'
]
const STAGES: readonly IntentStage[] = [
  'problem',
  'solution',
  'trigger',
  'comparison',
  'objection',
  'unset'
]

interface RunMeta {
  runId: string
  kind: CheckRunKind
  partial: boolean
  startedAt: string
  finishedAt: string
  contentChanged: boolean
  contentChange: ContentChange | null
  sincePrevious: number | null
  sinceBaseline: number | null
}

function pointsFor(status: PromptCheckStatus): number {
  switch (status) {
    case 'page_cited':
      return VISIBILITY_POINT_PAGE_CITED
    case 'other_own_page':
      return VISIBILITY_POINT_OTHER_OWN
    case 'brand_mentioned':
      return VISIBILITY_POINT_BRAND_MENTIONED
    case 'not_cited':
      return VISIBILITY_POINT_NOT_CITED
    default:
      return 0
  }
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function withStatus(
  row: PromptCheckRow,
  status: PromptCheckStatus,
  named: boolean | null
): PromptCheckRow {
  let references = row.references
  if (status === 'no_aio' || status === 'error') references = []
  else if (status !== 'page_cited' && status !== 'other_own_page') {
    references = row.references.filter(
      (ref) => ref.classification !== 'target' && ref.classification !== 'own'
    )
  }
  const cited = references.find(
    (ref) => ref.classification === 'target' || ref.classification === 'own'
  )
  return {
    ...row,
    status,
    references,
    citedUrl: cited?.url ?? null,
    position: cited?.position ?? null,
    wrongPageCited: status === 'other_own_page',
    named,
    aioSummary: status === 'no_aio' || status === 'error' ? null : row.aioSummary
  }
}

function communityAbove(refs: readonly AioReference[]): boolean {
  const community = refs.filter(
    (ref) => ref.sourceType === 'reddit' || ref.sourceType === 'youtube'
  )
  if (community.length === 0) return false
  const own = refs.filter((ref) => ref.classification === 'target' || ref.classification === 'own')
  if (own.length === 0) return true
  return (
    Math.min(...community.map((ref) => ref.position)) < Math.min(...own.map((ref) => ref.position))
  )
}

function leaderboard(
  prompts: readonly PromptCheckRow[],
  domain: string
): CompetitorLeaderboardRow[] {
  const buckets = new Map<string, { ids: string[]; positions: number[]; gap: string[] }>()
  for (const row of prompts) {
    if (!hasAio(row)) continue
    const seen = new Set<string>()
    const owns = row.references.some(
      (ref) => ref.classification === 'target' || ref.classification === 'own'
    )
    for (const ref of row.references) {
      if (seen.has(ref.domain)) {
        buckets.get(ref.domain)?.positions.push(ref.position)
        continue
      }
      seen.add(ref.domain)
      const entry = buckets.get(ref.domain) ?? { ids: [], positions: [], gap: [] }
      entry.ids.push(row.promptId)
      entry.positions.push(ref.position)
      if (!owns) entry.gap.push(row.promptId)
      buckets.set(ref.domain, entry)
    }
  }
  const rows: CompetitorLeaderboardRow[] = []
  for (const [name, entry] of buckets) {
    const you = name === domain
    const badge = you ? 'you' : entry.ids.length > 0 && isTracked(name) ? 'tracked' : 'observed'
    const average =
      entry.positions.reduce((sum, position) => sum + position, 0) / entry.positions.length
    rows.push({
      domain: name,
      badge,
      aioCount: entry.ids.length,
      overlap: you ? null : entry.ids.length - entry.gap.length,
      gap: you ? null : entry.gap.length,
      averagePosition: average,
      promptIds: entry.ids,
      gapPromptIds: you ? [] : entry.gap
    })
  }
  rows.sort((a, b) => {
    if (a.badge === 'you' && b.badge !== 'you') return -1
    if (b.badge === 'you' && a.badge !== 'you') return 1
    if (b.aioCount !== a.aioCount) return b.aioCount - a.aioCount
    return (b.gap ?? -1) - (a.gap ?? -1)
  })
  return rows
}

function isTracked(domain: string): boolean {
  return (
    domain === 'simpletexting.com' ||
    domain === 'clicksend.com' ||
    domain === 'textmagic.com' ||
    domain === 'twilio.com'
  )
}

function cannibalizing(prompts: readonly PromptCheckRow[]): CannibalizingPage[] {
  const pages = new Map<string, CannibalizingPage>()
  for (const row of prompts) {
    for (const ref of row.references) {
      if (ref.classification !== 'own') continue
      const existing = pages.get(ref.normalizedUrl) ?? {
        url: ref.url,
        normalizedUrl: ref.normalizedUrl,
        tracked: !ref.untracked,
        pageId: null,
        prompts: []
      }
      existing.prompts = [...existing.prompts, { promptId: row.promptId, position: ref.position }]
      pages.set(ref.normalizedUrl, existing)
    }
  }
  return [...pages.values()]
}

function blankColumn(which: CheckComparisonColumn['which']): CheckComparisonColumn {
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

export function emptyResults(): PageResults {
  const funnel: FunnelStep[] = FUNNEL.map((id) => ({
    id,
    count: 0,
    promptIds: [],
    drop: id === 'checked' ? null : { count: 0, reason: 'no questions', promptIds: [] }
  }))
  const buckets: OpportunityBucket[] = BUCKETS.map((id) => ({ id, count: 0, promptIds: [] }))
  return {
    scope: {
      promptCount: 0,
      marketCount: 1,
      brands: [],
      pageUrl: '',
      pageTitle: null,
      checkedAt: null,
      builtAt: new Date(0).toISOString(),
      promptSetVersion: null,
      promptSetSavedAt: null,
      stale: false,
      nextFixNumber: 1
    },
    run: null,
    scoreChange: { sincePrevious: null, sinceBaseline: null },
    comparison: [blankColumn('baseline'), blankColumn('previous'), blankColumn('current')],
    runSummary: null,
    funnel,
    buckets,
    ugcOverlay: { count: 0, promptIds: [] },
    prompts: [],
    leaderboard: [],
    cannibalizing: [],
    stageRates: [],
    topActions: []
  }
}

function rebuild(
  base: PageResults,
  prompts: readonly PromptCheckRow[],
  meta: RunMeta
): PageResults {
  const withAio = prompts.filter((row) => hasAio(row))
  const pageCited = withAio.filter((row) => row.status === 'page_cited')
  const domainCited = withAio.filter((row) =>
    row.references.some((ref) => ref.classification === 'target' || ref.classification === 'own')
  )
  const namedCited = pageCited.filter((row) => row.named === true)
  const points = withAio.reduce((sum, row) => sum + pointsFor(row.status), 0)
  const pointsPossible = withAio.length * VISIBILITY_POINT_PAGE_CITED
  const lists: Record<FunnelStepId, PromptCheckRow[]> = {
    checked: [...prompts],
    aio_shown: withAio,
    own_domain: domainCited,
    this_page: pageCited,
    cited_and_named: namedCited
  }
  const funnel: FunnelStep[] = FUNNEL.map((id, index) => {
    const list = lists[id]
    const previousId = FUNNEL[index - 1]
    const previous = previousId ? lists[previousId] : null
    const lost =
      previous === null
        ? null
        : previous.filter((row) => !list.some((kept) => kept.promptId === row.promptId))
    const drop: FunnelDrop | null =
      lost === null
        ? null
        : {
            count: lost.length,
            reason: 'not in the next step',
            promptIds: lost.map((row) => row.promptId)
          }
    return {
      id,
      count: list.length,
      promptIds: list.map((row) => row.promptId),
      drop: id === 'checked' ? null : drop
    }
  })
  const bucketOf = (row: PromptCheckRow): OpportunityBucketId | null => opportunityBucketOf(row)
  const buckets: OpportunityBucket[] = BUCKETS.map((id) => {
    const list = withAio.filter((row) => bucketOf(row) === id)
    return { id, count: list.length, promptIds: list.map((row) => row.promptId) }
  })
  const overlay = withAio.filter((row) => communityAbove(row.references))
  let citationsThisPage = 0
  let citationsOtherOwn = 0
  const targetPositions: number[] = []
  for (const row of prompts) {
    for (const ref of row.references) {
      if (ref.classification === 'target') {
        citationsThisPage += 1
        targetPositions.push(ref.position)
      }
      if (ref.classification === 'own') citationsOtherOwn += 1
    }
  }
  const domain = host(base.scope.pageUrl)
  const run: MarketCheckMetrics = {
    runId: meta.runId,
    pageId: base.run?.pageId ?? 'alerts',
    marketId: base.run?.marketId ?? 'us-en',
    promptSetId: base.run?.promptSetId ?? 'ps-textbolt',
    promptSetVersion: base.run?.promptSetVersion ?? 2,
    snapshotId: base.run?.snapshotId ?? 'snap',
    contentHash: base.run?.contentHash ?? 'hash',
    contentChanged: meta.contentChanged,
    contentChange: meta.contentChange,
    kind: meta.kind,
    partial: meta.partial,
    status: 'finished',
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    promptsChecked: prompts.length,
    promptsWithAio: withAio.length,
    pageCited: pageCited.length,
    otherOwnPage: withAio.filter((row) => row.status === 'other_own_page').length,
    brandMentioned: withAio.filter((row) => row.status === 'brand_mentioned').length,
    notCited: withAio.filter((row) => row.status === 'not_cited').length,
    noAio: prompts.filter((row) => row.status === 'no_aio').length,
    errors: prompts.filter((row) => row.status === 'error').length,
    points,
    pointsPossible,
    visibilityScore: pointsPossible === 0 ? null : Math.round((points / pointsPossible) * 100),
    citationsThisPage,
    citationsOtherOwn,
    citedAndNamed: namedCited.length,
    averagePosition:
      targetPositions.length === 0
        ? null
        : targetPositions.reduce((sum, position) => sum + position, 0) / targetPositions.length
  }
  const stageRates = STAGES.flatMap((stage) => {
    const group = prompts.filter((row) => row.intentStage === stage)
    if (group.length === 0) return []
    return [
      {
        stage,
        prompts: group.length,
        pageCited: group.filter((row) => row.status === 'page_cited').length
      }
    ]
  })
  return {
    ...base,
    scope: {
      ...base.scope,
      checkedAt: meta.startedAt,
      builtAt: meta.finishedAt,
      promptCount: prompts.length
    },
    run,
    scoreChange: { sincePrevious: meta.sincePrevious, sinceBaseline: meta.sinceBaseline },
    prompts,
    funnel,
    buckets,
    ugcOverlay: { count: overlay.length, promptIds: overlay.map((row) => row.promptId) },
    leaderboard: leaderboard(prompts, domain),
    cannibalizing: cannibalizing(prompts),
    stageRates
  }
}

function edit(
  prompts: readonly PromptCheckRow[],
  edits: ReadonlyMap<string, { status: PromptCheckStatus; named: boolean | null }>
): PromptCheckRow[] {
  return prompts.map((row) => {
    const next = edits.get(row.promptId)
    return next ? withStatus(row, next.status, next.named) : row
  })
}

interface SampleBundle {
  runs: ReadonlyMap<string, PageResults>
  current: PageResults
  history: ResultsHistory
  pages: PageScoreList
  projects: ProjectScoreList
}

function buildSample(): SampleBundle {
  const currentBase = textboltResults()
  const current =
    currentBase.run === null
      ? currentBase
      : {
          ...currentBase,
          run: { ...currentBase.run, kind: 'scheduled' as const }
        }
  const october = rebuild(
    currentBase,
    edit(currentBase.prompts, new Map([['tb-1', { status: 'not_cited', named: false }]])),
    {
      runId: 'run-previous',
      kind: 'scheduled',
      partial: false,
      startedAt: '2026-10-05T09:00:00.000Z',
      finishedAt: '2026-10-05T09:10:00.000Z',
      contentChanged: false,
      contentChange: null,
      sincePrevious: 14,
      sinceBaseline: 14
    }
  )
  const baseline = rebuild(
    currentBase,
    edit(
      currentBase.prompts,
      new Map([
        ['tb-1', { status: 'not_cited', named: false }],
        ['tb-5', { status: 'not_cited', named: false }],
        ['tb-6', { status: 'no_aio', named: null }]
      ])
    ),
    {
      runId: 'run-baseline',
      kind: 'baseline',
      partial: false,
      startedAt: '2026-09-21T09:00:00.000Z',
      finishedAt: '2026-09-21T09:10:00.000Z',
      contentChanged: false,
      contentChange: null,
      sincePrevious: null,
      sinceBaseline: null
    }
  )
  const runs = new Map<string, PageResults>([
    ['run-baseline', baseline],
    ['run-previous', october],
    ['run-current', current],
    [current.run?.runId ?? 'run-current', current]
  ])
  const ordered = [baseline, october, current]
  const history: ResultsHistory = {
    pageId: 'alerts',
    marketId: 'us-en',
    promptSetVersion: 2,
    points: ordered.map((results) => {
      const run = results.run
      const aios = run?.promptsWithAio ?? 0
      return {
        runId: run?.runId ?? '',
        finishedAt: run?.finishedAt ?? results.scope.builtAt,
        promptSetVersion: run?.promptSetVersion ?? 2,
        partial: run?.partial ?? false,
        pageCitedRate: run === null || aios === 0 ? null : run.pageCited / aios,
        promptsChecked: run?.promptsChecked ?? 0,
        promptsTotal: results.scope.promptCount,
        visibilityScore: run?.visibilityScore ?? null,
        contentChanged: run?.contentChanged ?? false
      }
    })
  }
  const pageRows: PageScoreSummary[] = [
    {
      pageId: 'alerts',
      score: 50,
      change: 12,
      nextCheckAt: '2026-11-02T15:00:00.000Z',
      lastCheckedAt: '2026-10-19T09:20:00.000Z',
      intervalDays: 14
    },
    {
      pageId: 'bulk',
      score: 31,
      change: -4,
      nextCheckAt: '2026-11-02T16:00:00.000Z',
      lastCheckedAt: '2026-10-12T09:00:00.000Z',
      intervalDays: 30
    },
    {
      pageId: 'optin',
      score: null,
      change: null,
      nextCheckAt: '2026-11-16T15:00:00.000Z',
      lastCheckedAt: null,
      intervalDays: 14
    }
  ]
  const textbolt = projectSummary('textbolt', pageRows, 1274, 5000, 14)
  const acme = projectSummary('acme', [], 80, 1000, 0)
  const fieldpro = projectSummary('fieldpro', [], 0, null, 0)
  const projects: ProjectScoreList = {
    projects: [textbolt, acme, fieldpro],
    searchesUsed: textbolt.searchesUsed + acme.searchesUsed + fieldpro.searchesUsed,
    nextCheckAt: textbolt.nextCheckAt
  }
  return {
    runs,
    current,
    history,
    pages: { projectId: 'textbolt', summary: textbolt, pages: pageRows },
    projects
  }
}

function projectSummary(
  projectId: string,
  pages: readonly PageScoreSummary[],
  searchesUsed: number,
  searchCap: number | null,
  pagesDueToday: number
): ProjectScoreSummary {
  const next = pages
    .map((page) => page.nextCheckAt)
    .filter((value): value is string => value !== null)
    .sort()
  return {
    projectId,
    averageScore: averageScore(pages),
    change: meanChange(pages),
    nextCheckAt: next[0] ?? null,
    searchesUsed,
    searchCap,
    pagesDueToday
  }
}

const SAMPLE = buildSample()

function isSample(pageId: string, marketId: string | null): boolean {
  return (
    SAMPLE_PAGES.has(pageId) && (marketId === null || marketId === 'us' || marketId === 'us-en')
  )
}

export function mockVisibilitySource(): VisibilitySource {
  return {
    'results:get': (request: GetResultsRequest) => {
      if (!isSample(request.pageId, request.marketId)) {
        return Promise.resolve(emptyResults())
      }
      const runId = request.runId
      if (runId === null) return Promise.resolve(SAMPLE.current)
      return Promise.resolve(SAMPLE.runs.get(runId) ?? SAMPLE.current)
    },
    'results:history': (request: ResultsHistoryRequest) => {
      if (!isSample(request.pageId, request.marketId)) {
        const empty: ResultsHistory = {
          pageId: request.pageId,
          marketId: request.marketId ?? 'default',
          promptSetVersion: null,
          points: []
        }
        return Promise.resolve(empty)
      }
      return Promise.resolve({
        ...SAMPLE.history,
        pageId: request.pageId,
        marketId: request.marketId ?? 'us-en'
      })
    },
    'scores:listProjects': () => Promise.resolve(SAMPLE.projects),
    'scores:listPages': (request: ProjectIdRequest) => {
      if (request.projectId !== 'textbolt') {
        const summary = projectSummary(request.projectId, [], 0, null, 0)
        const list: PageScoreList = { projectId: request.projectId, summary, pages: [] }
        return Promise.resolve(list)
      }
      return Promise.resolve(SAMPLE.pages)
    }
  }
}

export function sampleRuns(): ReadonlyMap<string, PageResults> {
  return SAMPLE.runs
}
