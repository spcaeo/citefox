import type {
  AioReference,
  CompetitorLeaderboardRow,
  CoverageMatrix,
  FunnelStep,
  MarketCheckMetrics,
  OpportunityBucket,
  PromptCheckRow,
  TopAction
} from '@shared/domain'
import type { ExportRequest } from '@shared/ipc'
import type {
  ExportCheck,
  ExportDataSource,
  ExportDataset,
  ExportPage,
  ExportPromptDetail
} from './types'

export const SAMPLE_PAGE_ID = 'page-1'
export const SAMPLE_MARKET_US = 'market-us'
export const SAMPLE_MARKET_MX = 'market-mx'

const HASH = 'a'.repeat(64)

/** In-memory source. Tests pass a dataset; nothing is read from disk. */
export function fixtureExportSource(dataset: ExportDataset): ExportDataSource {
  return {
    loadExportDataset: () => Promise.resolve(dataset)
  }
}

export function sampleExportRequest(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    projectId: 'project-1',
    scope: 'page',
    pageIds: [SAMPLE_PAGE_ID],
    viewId: null,
    marketIds: [SAMPLE_MARKET_US],
    checks: 'trio',
    from: null,
    to: null,
    sections: ['overview', 'prompts'],
    format: 'csv',
    pdf: null,
    xlsx: null,
    csv: { delimiter: 'comma', bom: true },
    filenamePattern: '{project}-{page}-{date}.{ext}',
    timeZone: 'UTC',
    logoBase64: null,
    ...overrides
  }
}

/** TextBolt-shaped fixture: one page, two markets, three US checks, prompts on the latest US check. */
export function sampleExportDataset(): ExportDataset {
  const currentPrompts = samplePrompts()
  return {
    projectName: 'TextBolt',
    projectSlug: 'textbolt',
    clientName: 'Northwind',
    views: [{ id: 'view-money', slug: 'money-pages', pageIds: [SAMPLE_PAGE_ID] }],
    report: sampleReportFacts(),
    pages: [
      {
        pageId: SAMPLE_PAGE_ID,
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        title: 'How to set up text alerts',
        slug: 'text-alerts',
        metaDescription: 'Send text alerts to a team without building an app.',
        h1: 'Text alerts for a business',
        snapshotAt: '2026-10-19T12:00:00.000Z',
        modifiedAt: null,
        promptSetVersion: 2,
        stale: false,
        markets: [
          {
            marketId: SAMPLE_MARKET_US,
            code: 'us-en',
            checks: [
              sampleCheck({
                runId: 'run-baseline',
                finishedAt: '2026-09-21T16:00:00.000Z',
                role: 'baseline',
                pageCited: 2,
                promptsWithAio: 3,
                buckets: [2, 0, 1, 0],
                funnel: [3, 3, 2, 2, 1],
                contentChanged: true,
                wordsAdded: -5,
                faqsAdded: 0,
                headingsChanged: 0,
                summary: 'A heading was shortened.',
                visibilityScore: 40
              }),
              sampleCheck({
                runId: 'run-previous',
                finishedAt: '2026-10-05T16:00:00.000Z',
                role: 'previous',
                pageCited: 1,
                promptsWithAio: 2,
                buckets: [1, 0, 0, 1],
                funnel: [3, 2, 1, 1, 0],
                visibilityScore: 22
              }),
              sampleCheck({
                runId: 'run-current',
                finishedAt: '2026-10-19T16:00:00.000Z',
                role: 'current',
                pageCited: 3,
                promptsWithAio: 3,
                buckets: [1, 1, 1, 0],
                funnel: [3, 3, 2, 1, 1],
                contentChanged: true,
                wordsAdded: 40,
                faqsAdded: 2,
                headingsChanged: 1,
                summary: '2 FAQs added',
                visibilityScore: 50,
                averagePosition: 2.5,
                citationsThisPage: 4,
                prompts: currentPrompts.prompts,
                details: currentPrompts.details,
                topActions: [sampleAction()],
                leaderboard: [sampleLeaderboard()],
                cannibalizing: [
                  {
                    url: 'https://textbolt.com/other',
                    tracked: false,
                    promptIds: ['prompt-3']
                  }
                ]
              })
            ]
          },
          {
            marketId: SAMPLE_MARKET_MX,
            code: 'mx-es',
            checks: [
              sampleCheck({
                runId: 'run-mx',
                finishedAt: '2026-10-19T18:00:00.000Z',
                role: 'current',
                marketId: SAMPLE_MARKET_MX,
                pageCited: 4,
                promptsWithAio: 4,
                buckets: [2, 1, 1, 0],
                funnel: [4, 4, 3, 2, 1],
                visibilityScore: 61
              })
            ]
          }
        ],
        gaps: sampleGaps(),
        sentiment: [
          {
            marketId: SAMPLE_MARKET_US,
            theme: 'Setup',
            claim: 'Fast to set up',
            stance: 'positive',
            source: 'https://example.com/review',
            factualProblem: null
          }
        ],
        notes: [{ at: '2026-10-06T15:00:00.000Z', text: 'Rewrote the carrier section.' }],
        fixes: [
          {
            number: 1,
            goLiveAt: '2026-10-12T15:00:00.000Z',
            description: 'Added the two new FAQs.',
            status: 'completed',
            promptIds: [],
            marketIds: [],
            verdict: null
          }
        ]
      }
    ]
  }
}

/** One page, one market, one check, `count` prompt rows. Even rows have one own-domain link. */
export function largeExportDataset(count: number): ExportDataset {
  const prompts: PromptCheckRow[] = []
  const details: ExportPromptDetail[] = []
  for (let index = 0; index < count; index += 1) {
    const promptId = `prompt-${index}`
    const own = index % 2 === 0
    const references = own
      ? [reference(`ref-${index}`, 1, 'target', 'https://textbolt.com/alerts')]
      : []
    prompts.push(
      prompt({
        promptId,
        promptPosition: index + 1,
        label: `Prompt ${index}`,
        text: index === 0 ? '=1+1' : `Question ${index} café`,
        status: own ? 'page_cited' : 'not_cited',
        position: own ? 1 : null,
        references,
        movement: 'unchanged',
        named: false
      })
    )
    details.push({ promptId, aioText: `Overview ${index}`, references, aioGap: [] })
  }
  const pageCited = Math.ceil(count / 2)
  return {
    projectName: 'TextBolt',
    projectSlug: 'textbolt',
    clientName: null,
    views: [],
    report: sampleReportFacts(),
    pages: [
      emptyPage({
        markets: [
          {
            marketId: SAMPLE_MARKET_US,
            code: 'us-en',
            checks: [
              sampleCheck({
                runId: 'run-large',
                finishedAt: '2026-10-19T16:00:00.000Z',
                role: 'current',
                pageCited,
                promptsWithAio: count,
                promptsChecked: count,
                buckets: [pageCited, 0, 0, count - pageCited],
                funnel: [count, count, pageCited, pageCited, 0],
                prompts,
                details
              })
            ]
          }
        ]
      })
    ]
  }
}

/** Project facts shared by the fixture datasets. */
export function sampleReportFacts(): ExportDataset['report'] {
  return {
    domain: 'textbolt.com',
    brandNames: ['TextBolt'],
    competitors: ['competitor.example'],
    includeSubdomains: false,
    brandColor: null,
    markets: [
      { id: SAMPLE_MARKET_US, country: 'US', language: 'en' },
      { id: SAMPLE_MARKET_MX, country: 'MX', language: 'es' }
    ],
    templates: [],
    answerShapes: []
  }
}

function samplePrompts(): { prompts: PromptCheckRow[]; details: ExportPromptDetail[] } {
  const firstRefs = [
    reference(
      'ref-1',
      2,
      'target',
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
    )
  ]
  const thirdRefs = [
    reference('ref-3', 4, 'own', 'https://textbolt.com/other'),
    reference('ref-4', 5, 'competitor', 'https://competitor.example/alerts', 'competitor.example')
  ]
  const prompts = [
    prompt({
      promptId: 'prompt-1',
      promptPosition: 1,
      label: 'Alerts to employees',
      text: 'How can I send text alerts to my employees without hiring a developer?',
      status: 'page_cited',
      position: 2,
      references: firstRefs,
      movement: 'gained',
      coverage: 'strong',
      action: 'No change',
      named: true,
      citedUrl: firstRefs[0]?.url ?? null
    }),
    prompt({
      promptId: 'prompt-2',
      promptPosition: 2,
      label: 'Formula',
      text: '=HYPERLINK("http://evil.test","click")',
      status: 'not_cited',
      position: null,
      references: [],
      movement: 'lost',
      coverage: 'weak',
      action: 'Add a section',
      named: false
    }),
    prompt({
      promptId: 'prompt-3',
      promptPosition: 3,
      label: 'Unicode',
      text: 'Café 日本語 "quotes", and a comma',
      status: 'other_own_page',
      position: 4,
      references: thirdRefs,
      movement: 'unchanged',
      coverage: 'partial',
      action: 'Point the answer at this page',
      named: true,
      wrongPageCited: true,
      citedUrl: 'https://textbolt.com/other'
    })
  ]
  const details: ExportPromptDetail[] = [
    {
      promptId: 'prompt-1',
      aioText: 'TextBolt sends alerts from email.',
      references: firstRefs,
      aioGap: []
    },
    {
      promptId: 'prompt-2',
      aioText: 'No product is named.',
      references: [],
      aioGap: [{ fact: 'Carrier gateways shut down', likelySource: 'https://example.com/gateways' }]
    },
    {
      promptId: 'prompt-3',
      aioText: 'A different TextBolt page is cited.',
      references: thirdRefs,
      aioGap: []
    }
  ]
  return { prompts, details }
}

interface CheckInput {
  runId: string
  finishedAt: string
  role: ExportCheck['role']
  pageCited: number
  promptsWithAio: number
  buckets: readonly [number, number, number, number]
  funnel: readonly [number, number, number, number, number]
  marketId?: string
  contentChanged?: boolean
  wordsAdded?: number
  faqsAdded?: number
  headingsChanged?: number
  summary?: string
  visibilityScore?: number
  averagePosition?: number | null
  citationsThisPage?: number
  promptsChecked?: number
  prompts?: readonly PromptCheckRow[]
  details?: readonly ExportPromptDetail[]
  topActions?: readonly TopAction[]
  leaderboard?: readonly CompetitorLeaderboardRow[]
  cannibalizing?: ExportCheck['cannibalizing']
}

function sampleCheck(input: CheckInput): ExportCheck {
  const metrics = baseMetrics({
    runId: input.runId,
    finishedAt: input.finishedAt,
    marketId: input.marketId ?? SAMPLE_MARKET_US,
    pageCited: input.pageCited,
    promptsWithAio: input.promptsWithAio,
    promptsChecked: input.promptsChecked ?? input.promptsWithAio,
    visibilityScore: input.visibilityScore ?? null,
    averagePosition: input.averagePosition ?? null,
    citationsThisPage: input.citationsThisPage ?? input.pageCited,
    contentChanged: input.contentChanged ?? false,
    contentChange:
      input.summary === undefined
        ? null
        : {
            summary: input.summary,
            faqsAdded: input.faqsAdded ?? 0,
            wordsAdded: input.wordsAdded ?? 0,
            headingsChanged: input.headingsChanged ?? 0
          }
  })
  return {
    finishedAt: input.finishedAt,
    role: input.role,
    metrics,
    prompts: input.prompts ?? [],
    details: input.details ?? [],
    funnel: funnel(input.funnel),
    buckets: buckets(input.buckets),
    topActions: input.topActions ?? [],
    leaderboard: input.leaderboard ?? [],
    cannibalizing: input.cannibalizing ?? []
  }
}

function baseMetrics(partial: {
  runId: string
  /** ISO-8601 UTC. A finished check always has one. */
  finishedAt: string
  marketId: string
  pageCited: number
  promptsWithAio: number
  promptsChecked: number
  visibilityScore: number | null
  averagePosition: number | null
  citationsThisPage: number
  contentChanged: boolean
  contentChange: MarketCheckMetrics['contentChange']
}): MarketCheckMetrics {
  return {
    runId: partial.runId,
    pageId: SAMPLE_PAGE_ID,
    marketId: partial.marketId,
    promptSetId: 'set-1',
    promptSetVersion: 2,
    snapshotId: 'snap-1',
    contentHash: HASH,
    contentChanged: partial.contentChanged,
    contentChange: partial.contentChange,
    kind: 'scheduled',
    partial: false,
    status: 'finished',
    startedAt: partial.finishedAt,
    finishedAt: partial.finishedAt,
    promptsChecked: partial.promptsChecked,
    promptsWithAio: partial.promptsWithAio,
    pageCited: partial.pageCited,
    otherOwnPage: 0,
    brandMentioned: 0,
    notCited: 0,
    noAio: 0,
    errors: 0,
    points: partial.pageCited * 3,
    pointsPossible: partial.promptsWithAio * 3,
    visibilityScore: partial.visibilityScore,
    citationsThisPage: partial.citationsThisPage,
    citationsOtherOwn: 0,
    citedAndNamed: 0,
    averagePosition: partial.averagePosition
  }
}

function funnel(counts: readonly [number, number, number, number, number]): FunnelStep[] {
  const ids = ['checked', 'aio_shown', 'own_domain', 'this_page', 'cited_and_named'] as const
  return ids.map((id, index) => ({
    id,
    count: counts[index] ?? 0,
    promptIds: [],
    drop: null
  }))
}

function buckets(counts: readonly [number, number, number, number]): OpportunityBucket[] {
  const ids = ['winning', 'cited_only', 'named_not_linked', 'invisible'] as const
  return ids.map((id, index) => ({
    id,
    count: counts[index] ?? 0,
    promptIds: []
  }))
}

function prompt(partial: {
  promptId: string
  promptPosition: number
  label: string
  text: string
  status: PromptCheckRow['status']
  position: number | null
  references: readonly AioReference[]
  movement: PromptCheckRow['movement']
  named: boolean | null
  coverage?: PromptCheckRow['coverage']
  action?: string | null
  citedUrl?: string | null
  wrongPageCited?: boolean
}): PromptCheckRow {
  return {
    promptId: partial.promptId,
    promptPosition: partial.promptPosition,
    label: partial.label,
    text: partial.text,
    source: 'trigger_event',
    intentStage: 'problem',
    status: partial.status,
    frequency: { matching: 1, samples: 1 },
    position: partial.position,
    citedUrl: partial.citedUrl ?? null,
    references: partial.references,
    wrongPageCited: partial.wrongPageCited ?? false,
    named: partial.named,
    movement: partial.movement,
    previousStatus: null,
    previousPosition: null,
    coverage: partial.coverage ?? null,
    action: partial.action ?? null,
    aioSummary: null,
    checkedAt: '2026-10-19T16:00:00.000Z'
  }
}

function reference(
  id: string,
  position: number,
  classification: AioReference['classification'],
  url: string,
  domain = 'textbolt.com'
): AioReference {
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain,
    title: null,
    classification,
    untracked: classification === 'own',
    sourceType: 'web'
  }
}

function sampleAction(): TopAction {
  return {
    rank: 1,
    text: 'Add the txt.att.net migration step',
    reason: 'The overview names the shutdown.',
    linkLabel: 'Open the gap for prompt 2',
    screen: 'gaps',
    promptId: 'prompt-2'
  }
}

function sampleLeaderboard(): CompetitorLeaderboardRow {
  return {
    domain: 'competitor.example',
    badge: 'tracked',
    aioCount: 1,
    overlap: 0,
    gap: 1,
    averagePosition: 5,
    promptIds: ['prompt-3'],
    gapPromptIds: ['prompt-3']
  }
}

function sampleGaps(): CoverageMatrix {
  return {
    runId: 'coverage-1',
    pageId: SAMPLE_PAGE_ID,
    recordedAt: '2026-10-19T12:30:00.000Z',
    templateId: 'template-1',
    templateName: 'CiteFox default',
    templateHash: HASH,
    templateUpdatedAt: null,
    contentHash: HASH,
    reused: false,
    stale: false,
    rows: [
      {
        id: 'gap-1',
        runId: 'coverage-1',
        pageId: SAMPLE_PAGE_ID,
        promptId: 'prompt-2',
        coverage: 'weak',
        whereCovered: ['FAQ'],
        currentContent: 'The page mentions email alerts.',
        whatToUpdate: 'Add the carrier shutdown.',
        mainGap: 'Carrier gateways are missing.',
        priority: 'high',
        actions: ['new_faq'],
        suggestedFaq: {
          question: 'What replaced the carrier email gateways?',
          answer: 'A short draft answer of fifty five words.',
          wordCount: 55
        },
        done: false
      },
      {
        id: 'gap-2',
        runId: 'coverage-1',
        pageId: SAMPLE_PAGE_ID,
        promptId: 'prompt-1',
        coverage: 'strong',
        whereCovered: ['Intro'],
        currentContent: 'The intro covers employee alerts.',
        whatToUpdate: 'No change.',
        mainGap: 'None.',
        priority: 'low',
        actions: ['none'],
        suggestedFaq: null,
        done: true
      }
    ],
    findings: [
      {
        id: 'finding-1',
        runId: 'coverage-1',
        pageId: SAMPLE_PAGE_ID,
        kind: 'typo',
        summary: 'Double question mark',
        detail: 'One FAQ ends with ??'
      }
    ]
  }
}

function emptyPage(partial: Pick<ExportPage, 'markets'>): ExportPage {
  return {
    pageId: SAMPLE_PAGE_ID,
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: 'How to set up text alerts',
    slug: 'text-alerts',
    metaDescription: null,
    h1: null,
    snapshotAt: '2026-10-19T12:00:00.000Z',
    modifiedAt: null,
    promptSetVersion: 2,
    stale: false,
    markets: partial.markets,
    gaps: null,
    sentiment: [],
    notes: [],
    fixes: []
  }
}
