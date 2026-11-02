import type {
  AioReference,
  CannibalizingPage,
  CheckComparisonColumn,
  CitationClass,
  CitationSourceType,
  CompetitorLeaderboardRow,
  CoverageLevel,
  FunnelDrop,
  FunnelStep,
  FunnelStepId,
  IntentStage,
  Market,
  MarketCheckMetrics,
  OpportunityBucket,
  OpportunityBucketId,
  PageResults,
  PromptCheckRow,
  PromptCheckStatus,
  PromptMovement,
  PromptSource,
  StageRate,
  TopAction
} from '@shared/domain'
import {
  VISIBILITY_POINT_BRAND_MENTIONED,
  VISIBILITY_POINT_NOT_CITED,
  VISIBILITY_POINT_OTHER_OWN,
  VISIBILITY_POINT_PAGE_CITED
} from '@shared/domain'
import type { CheckJob, CheckMarketProgress, CheckStepSnapshot } from '@shared/ipc'
import { opportunityBucketOf } from '@shared/report-copy'
import type { PageChrome } from '../projects/chrome'
import { FUNNEL_STEPS, OPPORTUNITY_BUCKETS } from './model'

export const TEXTBOLT_PAGE_ID = 'textbolt-alerts'
export const TEXTBOLT_PROJECT_ID = 'textbolt'
const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const OWN = 'textbolt.com'
const TRACKED = ['simpletexting.com', 'clicksend.com', 'textmagic.com', 'twilio.com']

export const TEXTBOLT_MARKETS: readonly Market[] = [
  {
    id: 'us-en',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  },
  {
    id: 'us-austin',
    country: 'US',
    language: 'en',
    location: 'Austin',
    device: 'desktop',
    localWording: true,
    serpapiLocation: null
  },
  {
    id: 'uk-en',
    country: 'UK',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  },
  {
    id: 'mx-es',
    country: 'MX',
    language: 'es',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  }
]

export const TEXTBOLT_PAGE: PageChrome = {
  label: 'Text alerts for business',
  title:
    'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)',
  displayUrl: 'textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  href: PAGE_URL,
  markets: TEXTBOLT_MARKETS,
  intervalDays: 14,
  samples: 1,
  promptSetVersion: 2,
  promptCount: 10
}

interface Seed {
  position: number
  label: string
  text: string
  intentStage: IntentStage
  source: PromptSource
  status: PromptCheckStatus
  named: boolean | null
  movement: PromptMovement
  coverage: CoverageLevel
  action: string
  checkedAt: string | null
  previousStatus?: PromptCheckStatus | null
  previousPosition?: number | null
  sources: readonly { domain: string; position: number }[]
}

const PROMPTS: readonly Seed[] = [
  {
    position: 1,
    label: 'Alerts to employees, no developer, no new app',
    text: 'How can I send text alerts to my employees without hiring a developer or learning a new app?',
    intentStage: 'problem',
    source: 'title_meta_h1',
    status: 'page_cited',
    named: true,
    movement: 'gained',
    coverage: 'partial',
    action: 'Update existing FAQ + new FAQ',
    checkedAt: '2026-10-19T09:14:00.000Z',
    sources: [
      { domain: 'reddit.com', position: 1 },
      { domain: 'textbolt.com', position: 2 },
      { domain: 'simpletexting.com', position: 3 },
      { domain: 'twilio.com', position: 4 }
    ]
  },
  {
    position: 2,
    label: 'Schedule a text to the whole team from Gmail/Outlook',
    text: 'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
    intentStage: 'solution',
    source: 'detail_check',
    status: 'other_own_page',
    named: false,
    movement: 'unchanged',
    coverage: 'strong',
    action: 'Update steps + existing FAQ',
    checkedAt: '2026-10-19T09:14:00.000Z',
    sources: [
      { domain: 'support.google.com', position: 1 },
      { domain: 'support.microsoft.com', position: 2 },
      { domain: 'zapier.com', position: 3 },
      { domain: 'textbolt.com', position: 4 }
    ]
  },
  {
    position: 3,
    label: 'Monitoring tool email alerts → texts',
    text: 'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
    intentStage: 'problem',
    source: 'title_meta_h1',
    status: 'page_cited',
    named: true,
    movement: 'unchanged',
    coverage: 'strong',
    action: 'Small update',
    checkedAt: '2026-10-19T09:15:00.000Z',
    sources: [
      { domain: 'textbolt.com', position: 1 },
      { domain: 'reddit.com', position: 2 },
      { domain: 'twilio.com', position: 3 },
      { domain: 'youtube.com', position: 4 },
      { domain: 'pagerduty.com', position: 5 }
    ]
  },
  {
    position: 4,
    label: 'txt.att.net stopped working, what to use instead',
    text: 'My email-to-text through txt.att.net stopped working. What’s the best replacement for business alerts?',
    intentStage: 'trigger',
    source: 'trigger_event',
    status: 'not_cited',
    named: false,
    movement: 'unchanged',
    coverage: 'partial',
    action: 'Fix FAQ + new FAQ',
    checkedAt: '2026-10-19T09:15:00.000Z',
    sources: [
      { domain: 'youtube.com', position: 1 },
      { domain: 'att.com', position: 2 },
      { domain: 'spiceworks.com', position: 3 },
      { domain: 'textmagic.com', position: 4 }
    ]
  },
  {
    position: 5,
    label: 'Verizon vtext.com shutdown, what to switch to',
    text: 'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
    intentStage: 'trigger',
    source: 'trigger_event',
    status: 'brand_mentioned',
    named: true,
    movement: 'improved',
    coverage: 'weak',
    action: 'New FAQ (high priority)',
    checkedAt: '2026-10-19T09:16:00.000Z',
    sources: [
      { domain: 'reddit.com', position: 1 },
      { domain: 'youtube.com', position: 2 },
      { domain: 'verizon.com', position: 3 },
      { domain: 'clicksend.com', position: 4 }
    ]
  },
  {
    position: 6,
    label: 'Scheduling software emails → SMS reminders',
    text: 'What’s the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?',
    intentStage: 'solution',
    source: 'detail_check',
    status: 'page_cited',
    named: false,
    movement: 'gained',
    coverage: 'partial',
    action: 'Update section + new FAQ',
    checkedAt: '2026-10-19T09:16:00.000Z',
    sources: [
      { domain: 'simpletexting.com', position: 1 },
      { domain: 'textmagic.com', position: 2 },
      { domain: 'textbolt.com', position: 3 }
    ]
  },
  {
    position: 7,
    label: '10DLC for own employees, service handles it',
    text: 'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
    intentStage: 'objection',
    source: 'objection',
    status: 'other_own_page',
    named: false,
    movement: 'improved',
    coverage: 'strong',
    action: 'Update existing FAQ',
    checkedAt: '2026-10-19T09:17:00.000Z',
    sources: [
      { domain: 'twilio.com', position: 1 },
      { domain: 'textbolt.com', position: 2 },
      { domain: 'campaignregistry.com', position: 3 }
    ]
  },
  {
    position: 8,
    label: 'Cheap Twilio alternative without developers',
    text: 'What’s a cheap alternative to Twilio for sending business text alerts if we don’t have developers?',
    intentStage: 'comparison',
    source: 'detail_check',
    status: 'no_aio',
    named: null,
    movement: 'unchanged',
    coverage: 'partial',
    action: 'Small comparison + new FAQ',
    checkedAt: '2026-10-19T09:17:00.000Z',
    sources: []
  },
  {
    position: 9,
    label: 'Text field techs Saturday morning, written Friday',
    text: 'How do I send a text to my field techs early Saturday morning when I’m writing the update Friday afternoon?',
    intentStage: 'problem',
    source: 'title_meta_h1',
    status: 'not_cited',
    named: false,
    movement: 'lost',
    coverage: 'strong',
    action: 'Optional new FAQ',
    checkedAt: '2026-10-19T09:18:00.000Z',
    previousStatus: 'page_cited',
    previousPosition: 5,
    sources: [
      { domain: 'simpletexting.com', position: 1 },
      { domain: 'reddit.com', position: 2 },
      { domain: 'clicksend.com', position: 3 }
    ]
  },
  {
    position: 10,
    label: 'Employees reply, reply comes back to email',
    text: 'Can employees reply to an automated business text alert and have the reply come back to my email?',
    intentStage: 'objection',
    source: 'objection',
    status: 'no_aio',
    named: null,
    movement: 'unchanged',
    coverage: 'strong',
    action: 'Update existing FAQ + Step 4',
    checkedAt: '2026-10-19T09:18:00.000Z',
    sources: []
  }
]

function promptId(position: number): string {
  return `tb-${position}`
}

function ownPath(position: number, status: PromptCheckStatus): string {
  if (status === 'page_cited') return '/blog/how-to-set-up-text-alerts-for-business/'
  if (position === 2) return '/blog/schedule-text-messages-gmail/'
  if (position === 7) return '/blog/10dlc-registration-guide/'
  return '/'
}

function sourceType(domain: string): CitationSourceType {
  if (domain === 'reddit.com') return 'reddit'
  if (domain === 'youtube.com') return 'youtube'
  return 'web'
}

function classification(
  domain: string,
  status: PromptCheckStatus,
  position: number
): CitationClass {
  if (domain !== OWN) return TRACKED.includes(domain) ? 'competitor' : 'other'
  return status === 'page_cited' ? 'target' : position === 2 || position === 7 ? 'own' : 'other'
}

function referencesFor(seed: Seed): AioReference[] {
  return seed.sources.map((source) => {
    const kind = classification(source.domain, seed.status, seed.position)
    const path = source.domain === OWN ? ownPath(seed.position, seed.status) : '/'
    const url = `https://${source.domain}${path}`
    return {
      id: `${promptId(seed.position)}-r${source.position}`,
      position: source.position,
      url,
      normalizedUrl: url,
      domain: source.domain,
      title: null,
      classification: kind,
      untracked: kind === 'own',
      sourceType: sourceType(source.domain)
    }
  })
}

function rowFor(seed: Seed, refs: readonly AioReference[]): PromptCheckRow {
  const own = refs.find((ref) => ref.classification === 'target' || ref.classification === 'own')
  return {
    promptId: promptId(seed.position),
    promptPosition: seed.position,
    label: seed.label,
    text: seed.text,
    source: seed.source,
    intentStage: seed.intentStage,
    status: seed.status,
    frequency: { matching: 1, samples: 1 },
    position:
      own && (seed.status === 'page_cited' || seed.status === 'other_own_page')
        ? own.position
        : null,
    citedUrl:
      seed.status === 'page_cited' || seed.status === 'other_own_page' ? (own?.url ?? null) : null,
    references: refs,
    wrongPageCited: seed.status === 'other_own_page',
    named: seed.named,
    movement: seed.movement,
    previousStatus: seed.previousStatus ?? null,
    previousPosition: seed.previousPosition ?? null,
    coverage: seed.coverage,
    action: seed.action,
    aioSummary: null,
    checkedAt: seed.checkedAt
  }
}

const AIO: ReadonlySet<PromptCheckStatus> = new Set([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

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

function hasOwn(refs: readonly AioReference[]): boolean {
  return refs.some((ref) => ref.classification === 'target' || ref.classification === 'own')
}

function communityAbove(refs: readonly AioReference[]): boolean {
  const community = refs.filter(
    (ref) => ref.sourceType === 'reddit' || ref.sourceType === 'youtube'
  )
  if (community.length === 0) return false
  const own = refs.filter((ref) => ref.domain === OWN)
  if (own.length === 0) return true
  const communityPos = Math.min(...community.map((ref) => ref.position))
  const ownPos = Math.min(...own.map((ref) => ref.position))
  return communityPos < ownPos
}

function buildLeaderboard(rows: readonly PromptCheckRow[]): CompetitorLeaderboardRow[] {
  const buckets = new Map<string, { ids: string[]; positions: number[]; gap: string[] }>()
  for (const row of rows) {
    if (!AIO.has(row.status)) continue
    const refs = row.references
    const seen = new Set<string>()
    for (const ref of refs) {
      if (seen.has(ref.domain)) {
        buckets.get(ref.domain)?.positions.push(ref.position)
        continue
      }
      seen.add(ref.domain)
      const entry = buckets.get(ref.domain) ?? { ids: [], positions: [], gap: [] }
      entry.ids.push(row.promptId)
      entry.positions.push(ref.position)
      if (!hasOwn(refs)) entry.gap.push(row.promptId)
      buckets.set(ref.domain, entry)
    }
  }
  const leaderboard: CompetitorLeaderboardRow[] = []
  for (const [domain, entry] of buckets) {
    const you = domain === OWN
    const badge = you ? 'you' : TRACKED.includes(domain) ? 'tracked' : 'observed'
    const average =
      entry.positions.reduce((sum, position) => sum + position, 0) / entry.positions.length
    leaderboard.push({
      domain,
      badge,
      aioCount: entry.ids.length,
      overlap: you ? null : entry.ids.length - entry.gap.length,
      gap: you ? null : entry.gap.length,
      averagePosition: average,
      promptIds: entry.ids,
      gapPromptIds: you ? [] : entry.gap
    })
  }
  leaderboard.sort((a, b) => {
    if (a.badge === 'you' && b.badge !== 'you') return -1
    if (b.badge === 'you' && a.badge !== 'you') return 1
    if (b.aioCount !== a.aioCount) return b.aioCount - a.aioCount
    const gapA = a.gap ?? -1
    const gapB = b.gap ?? -1
    if (gapB !== gapA) return gapB - gapA
    return a.domain < b.domain ? -1 : 1
  })
  return leaderboard
}

function buildCannibalizing(rows: readonly PromptCheckRow[]): CannibalizingPage[] {
  const pages = new Map<string, CannibalizingPage>()
  for (const row of rows) {
    for (const ref of row.references) {
      if (ref.classification !== 'own') continue
      const page = pages.get(ref.normalizedUrl) ?? {
        url: ref.url,
        normalizedUrl: ref.normalizedUrl,
        tracked: false,
        pageId: null,
        prompts: []
      }
      page.prompts = [...page.prompts, { promptId: row.promptId, position: ref.position }]
      pages.set(ref.normalizedUrl, page)
    }
  }
  return [...pages.values()].sort(
    (a, b) => (a.prompts[0]?.position ?? 0) - (b.prompts[0]?.position ?? 0)
  )
}

const STAGE_ORDER: readonly IntentStage[] = [
  'problem',
  'solution',
  'trigger',
  'comparison',
  'objection'
]

function buildStages(rows: readonly PromptCheckRow[]): StageRate[] {
  return STAGE_ORDER.map((stage) => {
    const group = rows.filter((row) => row.intentStage === stage)
    return {
      stage,
      prompts: group.length,
      pageCited: group.filter((row) => row.status === 'page_cited').length
    }
  }).filter((rate) => rate.prompts > 0)
}

function ids(rows: readonly PromptCheckRow[]): string[] {
  return rows.map((row) => row.promptId)
}

function dropReason(rows: readonly PromptCheckRow[]): string {
  const errors = rows.filter((row) => row.status === 'error').length
  const quiet = rows.length - errors
  if (errors === 0) return 'no AI Overview'
  if (quiet === 0) return 'error'
  return 'no AI Overview or error'
}

function drop(reason: string, rows: readonly PromptCheckRow[]): FunnelDrop {
  return { count: rows.length, reason, promptIds: ids(rows) }
}

function assemble(
  seeds: readonly Seed[],
  summary: { headline: string; body: string },
  actions: readonly TopAction[]
): PageResults {
  const prompts = seeds.map((seed) => rowFor(seed, referencesFor(seed)))
  const withAio = prompts.filter((row) => AIO.has(row.status))
  const pageCited = withAio.filter((row) => row.status === 'page_cited')
  const domainCited = withAio.filter((row) => hasOwn(row.references))
  const namedCited = pageCited.filter((row) => row.named === true)
  const points = withAio.reduce((sum, row) => sum + pointsFor(row.status), 0)
  const pointsPossible = withAio.length * VISIBILITY_POINT_PAGE_CITED
  const excluded = prompts.filter((row) => !AIO.has(row.status))
  const funnelIds: Record<FunnelStepId, PromptCheckRow[]> = {
    checked: prompts,
    aio_shown: withAio,
    own_domain: domainCited,
    this_page: pageCited,
    cited_and_named: namedCited
  }
  const reasons: Record<Exclude<FunnelStepId, 'checked'>, string> = {
    aio_shown: dropReason(excluded),
    own_domain: `no ${OWN} link`,
    this_page: `another ${OWN} page cited`,
    cited_and_named: 'linked, but TextBolt not named'
  }
  const funnel: FunnelStep[] = FUNNEL_STEPS.map((id, index) => {
    const list = funnelIds[id]
    const previousId = FUNNEL_STEPS[index - 1]
    const previous = previousId ? funnelIds[previousId] : null
    const lost =
      previous === null
        ? null
        : previous.filter((row) => !list.some((kept) => kept.promptId === row.promptId))
    return {
      id,
      count: list.length,
      promptIds: ids(list),
      drop:
        lost === null || id === 'checked'
          ? null
          : drop(reasons[id as Exclude<FunnelStepId, 'checked'>], lost)
    }
  })
  const bucketOf = (row: PromptCheckRow): OpportunityBucketId | null => opportunityBucketOf(row)
  const buckets: OpportunityBucket[] = OPPORTUNITY_BUCKETS.map((id) => {
    const list = withAio.filter((row) => bucketOf(row) === id)
    return { id, count: list.length, promptIds: ids(list) }
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
  const averagePosition =
    targetPositions.length === 0
      ? null
      : targetPositions.reduce((sum, position) => sum + position, 0) / targetPositions.length
  const run: MarketCheckMetrics = {
    runId: 'run-current',
    pageId: TEXTBOLT_PAGE_ID,
    marketId: 'us-en',
    promptSetId: 'ps-textbolt',
    promptSetVersion: 2,
    snapshotId: 'snap-current',
    contentHash: 'textbolt-alerts-v2',
    contentChanged: true,
    contentChange: { summary: 'Added 5 FAQs', faqsAdded: 5, wordsAdded: 410, headingsChanged: 0 },
    kind: 'manual',
    partial: false,
    status: 'finished',
    startedAt: '2026-10-19T09:14:00.000Z',
    finishedAt: '2026-10-19T09:20:00.000Z',
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
    averagePosition
  }
  const prior = (
    which: 'baseline' | 'previous',
    runId: string,
    finishedAt: string,
    values: Omit<CheckComparisonColumn, 'which' | 'runId' | 'finishedAt'>
  ): CheckComparisonColumn => ({ which, runId, finishedAt, ...values })
  const comparison: PageResults['comparison'] = [
    prior('baseline', 'run-baseline', '2026-09-21T09:00:00.000Z', {
      score: 24,
      pageCited: 1,
      anyOwnPageCited: 3,
      linksThisPage: 1,
      linksOtherOwn: 2,
      brandMentioned: 0,
      aiosShown: 7,
      averagePosition: 4,
      contentChanged: null,
      promptsChecked: 10
    }),
    prior('previous', 'run-previous', '2026-10-05T09:00:00.000Z', {
      score: 38,
      pageCited: 2,
      anyOwnPageCited: 4,
      linksThisPage: 2,
      linksOtherOwn: 2,
      brandMentioned: 1,
      aiosShown: 8,
      averagePosition: 3,
      contentChanged: false,
      promptsChecked: 10
    }),
    {
      which: 'current',
      runId: run.runId,
      finishedAt: run.finishedAt,
      score: run.visibilityScore,
      pageCited: run.pageCited,
      anyOwnPageCited: domainCited.length,
      linksThisPage: run.citationsThisPage,
      linksOtherOwn: run.citationsOtherOwn,
      brandMentioned: run.brandMentioned,
      aiosShown: run.promptsWithAio,
      averagePosition: run.averagePosition,
      contentChanged: run.contentChanged,
      promptsChecked: prompts.length
    }
  ]
  const results: PageResults = {
    scope: {
      promptCount: prompts.length,
      marketCount: TEXTBOLT_MARKETS.length,
      brands: ['TextBolt', 'Text Bolt'],
      pageUrl: PAGE_URL,
      pageTitle: TEXTBOLT_PAGE.title,
      checkedAt: '2026-10-19T09:14:00.000Z',
      builtAt: '2026-10-19T09:20:00.000Z',
      promptSetVersion: 2,
      promptSetSavedAt: '2026-09-20T00:00:00.000Z',
      stale: false,
      nextFixNumber: 1
    },
    run,
    scoreChange: {
      sincePrevious: (run.visibilityScore ?? 0) - 38,
      sinceBaseline: (run.visibilityScore ?? 0) - 24
    },
    comparison,
    runSummary: summary,
    funnel,
    buckets,
    ugcOverlay: { count: overlay.length, promptIds: ids(overlay) },
    prompts,
    leaderboard: buildLeaderboard(prompts),
    cannibalizing: buildCannibalizing(prompts),
    stageRates: buildStages(prompts),
    topActions: actions
  }
  return results
}

function textboltActions(): readonly TopAction[] {
  return [
    {
      rank: 1,
      text: 'Publish the Verizon vtext.com FAQ',
      reason:
        'Question 5 names TextBolt without a link, and page coverage is Weak. Verizon retires vtext.com on March 31, 2027, so this one has a deadline.',
      linkLabel: 'Open the gap for question 5',
      screen: 'gaps',
      promptId: promptId(5)
    },
    {
      rank: 2,
      text: 'Add the txt.att.net migration step',
      reason:
        'Question 4 is invisible: youtube.com, att.com, spiceworks.com and textmagic.com are cited instead. Fix the "??" in that FAQ while you’re there.',
      linkLabel: 'Open the gap for question 4',
      screen: 'gaps',
      promptId: promptId(4)
    },
    {
      rank: 3,
      text: 'Point the 10DLC guide to this page, or merge the overlap',
      reason:
        'For question 7 Google cites textbolt.com/blog/10dlc-registration-guide/ at position 2 instead of this page. Link the guide here, or fold its staff-alerts part into this page.',
      linkLabel: 'Compare both pages in Content gaps',
      screen: 'gaps',
      promptId: promptId(7)
    },
    {
      rank: 4,
      text: 'Answer the open r/sysadmin thread on vtext.com',
      reason:
        'A Reddit thread is cited at position 1 for question 5, above every other source. A helpful answer with one link puts you where Google already looks.',
      linkLabel: 'Draft a reply in Communities',
      screen: 'communities',
      promptId: promptId(5)
    },
    {
      rank: 5,
      text: 'Shorten the title so "No Developer" isn’t cut',
      reason:
        'The title is 101 characters and Google cuts around 60, so "(No Developer Required)" never shows. Questions 1 and 8 ask for exactly that.',
      linkLabel: 'Open the page read',
      screen: 'page_read',
      promptId: null
    }
  ]
}

const assembled = assemble(
  PROMPTS,
  {
    headline:
      'On Oct 19, Google showed an AI Overview for 8 of 10 questions, citing this page in 3, another TextBolt page in 2 and naming TextBolt without a link in 1; TextBolt was invisible in the other 2.',
    body: 'This page is cited in 3 of 8 overviews, up from 2 on Oct 5. It gained question 1, "alerts to employees, no developer, no new app", and question 6, "scheduling software emails to SMS reminders", and lost question 9, "text field techs Saturday morning, written Friday". The page content changed between these checks, and you noted "Added 5 FAQs" on Oct 8. CiteFox shows both facts side by side; it can\'t tell you the edit caused the change.'
  },
  textboltActions()
)

export function textboltResults(): PageResults {
  return assembled
}

const AUSTIN: readonly [number, string, 'ok' | 'running' | 'waiting', string, string][] = [
  [
    1,
    'How can I send text alerts to my employees in Austin without hiring a developer or learning a new app?',
    'ok',
    'Follow-up loaded',
    ''
  ],
  [
    2,
    'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
    'ok',
    'Loaded',
    ''
  ],
  [
    3,
    'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
    'ok',
    'Follow-up loaded',
    ''
  ],
  [
    4,
    'My email-to-text through txt.att.net stopped working. What’s the best replacement for business alerts in Austin?',
    'ok',
    'Loaded',
    'Timed out once, retried'
  ],
  [
    5,
    'Verizon is shutting down vtext.com. What should a small business in Austin switch to so our automated alerts keep reaching phones?',
    'ok',
    'Follow-up loaded',
    ''
  ],
  [
    6,
    'What’s the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?',
    'ok',
    'Follow-up loaded',
    ''
  ],
  [
    7,
    'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
    'running',
    '',
    ''
  ],
  [
    8,
    'What’s a cheap alternative to Twilio for sending business text alerts in Austin if we don’t have developers?',
    'waiting',
    '',
    ''
  ],
  [
    9,
    'How do I send a text to my field techs in Austin early Saturday morning when I’m writing the update Friday afternoon?',
    'waiting',
    '',
    ''
  ],
  [
    10,
    'Can employees reply to an automated business text alert and have the reply come back to my email?',
    'waiting',
    '',
    ''
  ]
]

function austinSteps(): CheckStepSnapshot[] {
  const steps: CheckStepSnapshot[] = []
  for (const [position, prompt, search, overview, note] of AUSTIN) {
    const id = `austin-${position}`
    const searchState = search === 'ok' ? 'ok' : search === 'running' ? 'running' : 'waiting'
    const later = search === 'ok' ? 'ok' : 'waiting'
    const error = note.length > 0 ? note : null
    steps.push({
      pageId: TEXTBOLT_PAGE_ID,
      marketId: 'us-austin',
      promptId: id,
      promptPosition: position,
      label: `Question ${position}`,
      promptText: prompt,
      sampleNo: 1,
      phase: 'search',
      state: searchState,
      detail: '',
      errorCode: error ? 'timeout' : null,
      error,
      retrySearches: error ? 1 : 0
    })
    steps.push({
      pageId: TEXTBOLT_PAGE_ID,
      marketId: 'us-austin',
      promptId: id,
      promptPosition: position,
      label: `Question ${position}`,
      promptText: prompt,
      sampleNo: 1,
      phase: 'aio',
      state: later,
      detail: search === 'ok' ? overview : '',
      errorCode: null,
      error: null,
      retrySearches: 0
    })
    steps.push({
      pageId: TEXTBOLT_PAGE_ID,
      marketId: 'us-austin',
      promptId: id,
      promptPosition: position,
      label: `Question ${position}`,
      promptText: prompt,
      sampleNo: null,
      phase: 'analysis',
      state: later,
      detail: '',
      errorCode: null,
      error: null,
      retrySearches: 0
    })
  }
  return steps
}

const austinStepsForJob = austinSteps()

const RUNNING_MARKETS: readonly CheckMarketProgress[] = [
  { marketId: 'us-en', done: 10, total: 10, state: 'ok' },
  { marketId: 'us-austin', done: 6, total: 10, state: 'running' },
  { marketId: 'uk-en', done: 0, total: 10, state: 'waiting' },
  { marketId: 'mx-es', done: 0, total: 10, state: 'waiting' }
]

export function textboltJob(): CheckJob {
  return {
    id: 'job-textbolt',
    projectId: TEXTBOLT_PROJECT_ID,
    pageIds: [TEXTBOLT_PAGE_ID],
    marketIds: TEXTBOLT_MARKETS.map((market) => market.id),
    promptIds: null,
    status: 'running',
    startedAt: '2026-10-19T10:14:00.000Z',
    finishedAt: null,
    done: 16,
    total: 40,
    searchesUsed: 34,
    searchesMax: 80,
    brandSearchesMax: 0,
    monthUsed: 1274,
    monthLimit: 5000,
    runIds: ['run-us-en'],
    markets: RUNNING_MARKETS,
    steps: austinStepsForJob,
    message: null,
    nextStep: null
  }
}

const EXCLUDED_SEEDS: readonly Seed[] = [
  {
    position: 1,
    label: 'Cited',
    text: 'Cited question',
    intentStage: 'problem',
    source: 'written_by_user',
    status: 'page_cited',
    named: true,
    movement: 'unchanged',
    coverage: 'strong',
    action: 'None',
    checkedAt: '2026-10-19T09:14:00.000Z',
    sources: [{ domain: OWN, position: 1 }]
  },
  {
    position: 2,
    label: 'Quiet',
    text: 'No overview',
    intentStage: 'solution',
    source: 'written_by_user',
    status: 'no_aio',
    named: null,
    movement: 'unchanged',
    coverage: 'none',
    action: 'None',
    checkedAt: '2026-10-19T09:14:00.000Z',
    sources: []
  },
  {
    position: 3,
    label: 'Failed',
    text: 'Capture failed',
    intentStage: 'trigger',
    source: 'written_by_user',
    status: 'error',
    named: null,
    movement: 'unchanged',
    coverage: 'none',
    action: 'None',
    checkedAt: null,
    sources: []
  }
]

export function excludedResults(): PageResults {
  return assemble(
    EXCLUDED_SEEDS,
    { headline: 'One scored question.', body: 'Two questions are outside the score.' },
    []
  )
}
