import type {
  IntentStage,
  LoggedFix,
  Market,
  PromptCheckRow,
  PromptCheckStatus
} from '@shared/domain'
import { DEFAULT_LOOP_OWNERS, type LoopStep } from '@shared/fix-loop'
import { citesPage, type FixMeasure, type FixQuestionCheck } from '@shared/fix-verdict'
import { rollupPageFixes } from '@shared/page-fixes'
import type {
  AnchorText,
  ChangeCheck,
  CreateFixRequest,
  ProjectFix,
  ChangeLedger,
  ChangeRow,
  GridCsvRequest,
  IndexCheckPreview,
  IndexCheckRequest,
  LostGroundRequest,
  LostGroundView,
  ProjectFixList,
  RecoveryPlan,
  RunIndexCheckRequest,
  OwnerWhyResult,
  PageEditResult,
  SavedPageFixBrief,
  SaveRecoveryPlanRequest,
  SetFixKindRequest,
  SetLoopOwnerRequest,
  SuggestAnchorsRequest
} from '@shared/ipc'
import { row } from '../progress/fixtures'
import {
  assistResult,
  draftFixResult,
  pageBriefResult,
  projectSearches,
  questionTargets
} from './searchFixtures'
import type { ProjectFixesSource } from './source'

/**
 * Tests only. The TextBolt story the e2e seed tells too: a rewrite that lost ground,
 * a fix that got cited, a new page Google has not indexed, and one too new to judge.
 */

export const BUILT_AT = '2026-10-23T09:00:00.000Z'
export const NOW = new Date(BUILT_AT)

export const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

const SITE = 'https://textbolt.com'
export const ALERTS_URL = `${SITE}/blog/how-to-set-up-text-alerts-for-business/`
export const PRICING_URL = `${SITE}/pricing/`
export const FEATURES_URL = `${SITE}/features/`
export const SCHEDULE_URL = `${SITE}/blog/schedule-text-messages/`
export const GMAIL_URL = `${SITE}/blog/text-from-gmail/`

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

const STAGES: readonly IntentStage[] = ['problem', 'solution', 'comparison', 'objection', 'trigger']

/** A question of page `page`, numbered `n`, with its status and where it was cited. */
function q(
  page: string,
  n: number,
  status: PromptCheckStatus,
  extra: Partial<PromptCheckRow> = {}
): PromptCheckRow {
  return row(n, status, {
    promptId: `${page}-q${n}`,
    label: `${page} question ${n}`,
    text: `How do I handle ${page} case ${n}?`,
    intentStage: STAGES[(n - 1) % STAGES.length] ?? 'problem',
    citedUrl: null,
    ...extra
  })
}

function check(runId: string, days: number, rows: readonly PromptCheckRow[]): ChangeCheck {
  return { runId, marketId: US.id, checkedAt: daysAgo(days), rows }
}

export const ALERTS_BEFORE = check('run-alerts-1', 18, [
  q('alerts', 1, 'page_cited', { position: 1, citedUrl: ALERTS_URL }),
  q('alerts', 2, 'page_cited', { position: 2, citedUrl: ALERTS_URL }),
  q('alerts', 3, 'page_cited', { position: 1, citedUrl: ALERTS_URL }),
  q('alerts', 4, 'page_cited', { position: 3, citedUrl: ALERTS_URL }),
  q('alerts', 5, 'page_cited', { position: 2, citedUrl: ALERTS_URL }),
  q('alerts', 6, 'not_cited'),
  q('alerts', 7, 'not_cited')
])

export const ALERTS_NOW = check('run-alerts-2', 1, [
  q('alerts', 1, 'page_cited', { position: 2, citedUrl: ALERTS_URL }),
  q('alerts', 2, 'other_own_page', { citedUrl: PRICING_URL }),
  q('alerts', 3, 'other_own_page', { citedUrl: PRICING_URL }),
  q('alerts', 4, 'other_own_page', { citedUrl: FEATURES_URL }),
  q('alerts', 5, 'not_cited'),
  q('alerts', 6, 'not_cited'),
  q('alerts', 7, 'not_cited')
])

const PRICING_BEFORE = check('run-pricing-1', 16, [
  q('pricing', 1, 'not_cited'),
  q('pricing', 2, 'not_cited'),
  q('pricing', 3, 'brand_mentioned'),
  q('pricing', 4, 'not_cited')
])

const PRICING_NOW = check('run-pricing-2', 1, [
  q('pricing', 1, 'page_cited', { position: 1, citedUrl: PRICING_URL }),
  q('pricing', 2, 'page_cited', { position: 2, citedUrl: PRICING_URL }),
  q('pricing', 3, 'page_cited', { position: 3, citedUrl: PRICING_URL }),
  q('pricing', 4, 'not_cited')
])

const SCHEDULE_NOW = check('run-schedule-1', 1, [
  q('schedule', 1, 'not_cited'),
  q('schedule', 2, 'not_cited'),
  q('schedule', 3, 'no_aio')
])

/** The fix's searches read from its page's before and now checks, as main measures them. */
export function measureOf(
  url: string,
  before: ChangeCheck | null,
  now: ChangeCheck | null,
  pageId = 'page'
): FixMeasure {
  const ids = [...new Set([...(before?.rows ?? []), ...(now?.rows ?? [])].map((r) => r.promptId))]
  const stateIn = (check: ChangeCheck | null, promptId: string): FixQuestionCheck | null => {
    const found = check?.rows.find((item) => item.promptId === promptId)
    if (!check || !found) return null
    const cited = citesPage(found, url)
    return {
      runId: check.runId,
      checkedAt: check.checkedAt,
      cited,
      position: cited ? found.position : null
    }
  }
  return {
    url,
    questions: ids.map((promptId) => {
      const found = [...(now?.rows ?? []), ...(before?.rows ?? [])].find(
        (item) => item.promptId === promptId
      )
      return {
        promptId,
        sourceId: pageId,
        sourceKind: 'page' as const,
        sourceName: pageId,
        marketId: US.id,
        label: found?.label ?? promptId,
        text: found?.text ?? '',
        before: stateIn(before, promptId),
        now: stateIn(now, promptId)
      }
    }),
    control: null,
    trend: [before, now].flatMap((item) =>
      item
        ? [
            {
              at: item.checkedAt,
              cited: item.rows.filter((r) => citesPage(r, url)).length,
              checked: item.rows.length
            }
          ]
        : []
    )
  }
}

function change(
  extra: Partial<ChangeRow> & Pick<ChangeRow, 'fixId' | 'pageId' | 'url'>
): ChangeRow {
  return {
    measure: measureOf(extra.url, extra.before ?? null, extra.now ?? null, extra.pageId),
    number: 1,
    kind: 'fix',
    description: 'A change',
    title: null,
    liveSince: daysAgo(10),
    daysLive: 10,
    pageDates: null,
    before: null,
    now: null,
    measuredSinceLive: false,
    status: 'not_cited',
    index: null,
    latestOnPage: true,
    ...extra
  }
}

export const ALERTS_ROW = change({
  fixId: 'fix-alerts',
  pageId: 'page-alerts',
  url: ALERTS_URL,
  number: 2,
  kind: 'rewrite',
  description: 'Rewrote the guide as a **step-by-step** setup',
  title: 'How to set up text alerts for business',
  liveSince: daysAgo(15),
  daysLive: 15,
  pageDates: { publishedAt: daysAgo(400), modifiedAt: daysAgo(15), readAt: daysAgo(1) },
  before: ALERTS_BEFORE,
  now: ALERTS_NOW,
  measuredSinceLive: true,
  status: 'lost',
  index: { state: 'indexed', checkedAt: daysAgo(2), message: null }
})

export const PRICING_ROW = change({
  fixId: 'fix-pricing',
  pageId: 'page-pricing',
  url: PRICING_URL,
  number: 3,
  kind: 'fix',
  description: 'Added a per-message price table',
  title: 'Pricing',
  liveSince: daysAgo(12),
  daysLive: 12,
  before: PRICING_BEFORE,
  now: PRICING_NOW,
  measuredSinceLive: true,
  status: 'cited',
  index: { state: 'indexed', checkedAt: daysAgo(2), message: null }
})

export const SCHEDULE_ROW = change({
  fixId: 'fix-schedule',
  pageId: 'page-schedule',
  url: SCHEDULE_URL,
  kind: 'new_page',
  description: 'New page: schedule text messages from email',
  title: 'Schedule text messages',
  liveSince: daysAgo(11),
  daysLive: 11,
  pageDates: { publishedAt: daysAgo(11), modifiedAt: null, readAt: daysAgo(1) },
  now: SCHEDULE_NOW,
  measuredSinceLive: true,
  status: 'not_cited',
  index: { state: 'not_indexed', checkedAt: daysAgo(2), message: null }
})

export const GMAIL_ROW = change({
  fixId: 'fix-gmail',
  pageId: 'page-gmail',
  url: GMAIL_URL,
  kind: 'new_page',
  description: 'New page: text from Gmail',
  title: null,
  liveSince: daysAgo(2),
  daysLive: 2,
  status: 'too_new'
})

export const SCHEDULE_ANCHOR: AnchorText = {
  pageId: 'page-schedule',
  text: 'schedule text messages from email',
  savedAt: daysAgo(1)
}

export function ledger(extra: Partial<ChangeLedger> = {}): ChangeLedger {
  return {
    projectId: 'proj-1',
    builtAt: BUILT_AT,
    domain: 'textbolt.com',
    brand: 'TextBolt',
    markets: [US],
    // Newest go-live first.
    rows: [GMAIL_ROW, SCHEDULE_ROW, PRICING_ROW, ALERTS_ROW],
    workingNotes: [],
    trackedPages: 6,
    schedule: {
      intervalDays: 14,
      nextCheckAt: '2026-11-02T09:00:00.000Z',
      lastCheckAt: daysAgo(1),
      paused: false
    },
    owners: { ...DEFAULT_LOOP_OWNERS },
    anchors: [SCHEDULE_ANCHOR],
    ...extra
  }
}

export function lostView(extra: Partial<LostGroundView> = {}): LostGroundView {
  return {
    pageId: 'page-alerts',
    url: ALERTS_URL,
    title: ALERTS_ROW.title,
    before: ALERTS_BEFORE,
    now: ALERTS_NOW,
    checks: [
      { runId: 'run-alerts-2', checkedAt: ALERTS_NOW.checkedAt, cited: 1 },
      { runId: 'run-alerts-1', checkedAt: ALERTS_BEFORE.checkedAt, cited: 5 },
      { runId: 'run-alerts-0', checkedAt: daysAgo(32), cited: 4 }
    ],
    buckets: {
      still_cited: ['alerts-q1'],
      moved_tracked: ['alerts-q2', 'alerts-q3'],
      moved_own: ['alerts-q4'],
      not_cited: ['alerts-q5']
    },
    notCheckedNow: [],
    movedTo: { 'alerts-q2': PRICING_URL, 'alerts-q3': PRICING_URL, 'alerts-q4': FEATURES_URL },
    movedToPage: { 'alerts-q2': 'page-pricing', 'alerts-q3': 'page-pricing' },
    change: {
      fixId: 'fix-alerts',
      kind: 'rewrite',
      liveSince: ALERTS_ROW.liveSince,
      description: ALERTS_ROW.description
    },
    beforeRead: {
      snapshotId: 'snap-1',
      fetchedAt: daysAgo(19),
      title: 'Text alerts: the complete guide'
    },
    nowRead: {
      snapshotId: 'snap-2',
      fetchedAt: daysAgo(1),
      title: 'Set up text alerts in 5 steps'
    },
    outline: {
      before: [
        { level: 'h2', text: 'What are business text alerts', match: 0, similarity: 0.8 },
        {
          level: 'h2',
          text: 'Alerts vs notifications vs reminders',
          match: null,
          similarity: null
        },
        { level: 'h2', text: 'How to set up text alerts', match: 1, similarity: 0.9 },
        { level: 'h2', text: 'Who should use text alerts', match: null, similarity: null }
      ],
      now: [
        { level: 'h2', text: 'What business text alerts are', match: 0, similarity: 0.8 },
        { level: 'h2', text: 'Set up text alerts in 5 steps', match: 2, similarity: 0.9 },
        { level: 'h2', text: 'Pricing', match: null, similarity: null }
      ],
      removed: 2,
      added: 1
    },
    plan: null,
    ...extra
  }
}

/** Every call the fake saw, by channel. */
export interface FakeCalls {
  ledger: number
  owners: SetLoopOwnerRequest[]
  kinds: SetFixKindRequest[]
  previews: IndexCheckRequest[]
  checks: RunIndexCheckRequest[]
  anchors: SuggestAnchorsRequest[]
  lost: LostGroundRequest[]
  plans: SaveRecoveryPlanRequest[]
  csv: GridCsvRequest[]
  /** What to fix: brief, owner and assist calls, by channel. */
  briefs: { channel: string; request: unknown }[]
  /** "I published this" and Log a fix: every `fixes:create`. */
  creates: CreateFixRequest[]
}

export function emptyFixList(): ProjectFixList {
  return { projectId: 'proj-1', markets: [US], subjects: [], fixes: [], suggestions: [] }
}

/** A fake source over the fixture ledger. `overrides` replace single channels. */
export function fakeLoopSource(
  start: ChangeLedger = ledger(),
  overrides: Partial<ProjectFixesSource> = {},
  preview: IndexCheckPreview = {
    pages: 4,
    searchesMin: 4,
    searchesMax: 8,
    left: 52,
    canRun: true,
    reason: null
  }
): { source: ProjectFixesSource; calls: FakeCalls } {
  let current = start
  let plan: RecoveryPlan | null = null
  let saved: SavedPageFixBrief[] = []
  let edits: PageEditResult[] = []
  let whys: OwnerWhyResult[] = []
  let logged: ProjectFix[] = []
  const calls: FakeCalls = {
    ledger: 0,
    owners: [],
    kinds: [],
    previews: [],
    checks: [],
    anchors: [],
    lost: [],
    plans: [],
    csv: [],
    briefs: [],
    creates: []
  }
  const source: ProjectFixesSource = {
    'fixes:listProject': () => Promise.resolve({ ...emptyFixList(), fixes: logged }),
    'fixes:create': (request) => {
      calls.creates.push(request)
      const fix = createdFix(request, logged.length + 1)
      logged = [...logged, { fix, searchesMin: 0, searchesMax: 0 }]
      return Promise.resolve(fix)
    },
    'prompts:addTargets': () => Promise.resolve(questionTargets()),
    'fixes:runFollowUp': () => Promise.reject(new Error('Not in this fake')),
    'fixes:delete': (request) => {
      logged = logged.filter((item) => item.fix.id !== request.fixId)
      return Promise.resolve({ pageId: '', fixes: [], nextFixNumber: 1 })
    },
    'fixes:restore': () => Promise.reject(new Error('Not in this fake')),
    'fixes:ledger': () => {
      calls.ledger += 1
      return Promise.resolve(current)
    },
    'fixes:setOwner': (request) => {
      calls.owners.push(request)
      const label = request.label.trim() || DEFAULT_LOOP_OWNERS[request.step]
      const owners: Record<LoopStep, string> = { ...current.owners, [request.step]: label }
      current = { ...current, owners }
      return Promise.resolve(owners)
    },
    'fixes:setKind': (request) => {
      calls.kinds.push(request)
      current = {
        ...current,
        rows: current.rows.map((item) =>
          item.fixId === request.fixId ? { ...item, kind: request.kind } : item
        )
      }
      return Promise.resolve({ fixId: request.fixId, kind: request.kind })
    },
    'fixes:indexPreview': (request) => {
      calls.previews.push(request)
      return Promise.resolve(preview)
    },
    'fixes:checkIndex': (request) => {
      calls.checks.push(request)
      const results = request.pageIds.map((pageId) => ({
        pageId,
        check: { state: 'indexed' as const, checkedAt: BUILT_AT, message: null }
      }))
      return Promise.resolve({ results, searchesUsed: 5, stoppedReason: null })
    },
    'fixes:suggestAnchors': (request) => {
      calls.anchors.push(request)
      const anchors = request.pageIds.map((pageId) => ({
        pageId,
        text: `anchor for ${pageId}`,
        savedAt: BUILT_AT
      }))
      current = { ...current, anchors: [...current.anchors, ...anchors] }
      return Promise.resolve({ anchors, failed: [] })
    },
    'fixes:lostGround': (request) => {
      calls.lost.push(request)
      const vs = request.vsRunId
      const view = lostView({ plan })
      if (vs === 'run-alerts-0') {
        return Promise.resolve({
          ...view,
          before: { ...ALERTS_BEFORE, runId: 'run-alerts-0', checkedAt: daysAgo(32) }
        })
      }
      return Promise.resolve(view)
    },
    'fixes:saveRecoveryPlan': (request) => {
      calls.plans.push(request)
      plan = { text: request.text, savedAt: BUILT_AT, edited: true, inputKey: request.inputKey }
      return Promise.resolve(plan)
    },
    'fixes:searches': () => Promise.resolve(projectSearches()),
    'topics:draftFix': (request) => {
      calls.briefs.push({ channel: 'topics:draftFix', request })
      return Promise.resolve(draftFixResult(request.promptId))
    },
    'topics:draftPageBrief': (request) => {
      calls.briefs.push({ channel: 'topics:draftPageBrief', request })
      return Promise.resolve(pageBriefResult(request.promptId))
    },
    'topics:setTarget': (request) => {
      calls.briefs.push({ channel: 'topics:setTarget', request })
      return Promise.resolve({ draft: null, rows: [] })
    },
    'assist:run': (request) => {
      calls.briefs.push({ channel: 'assist:run', request })
      return Promise.resolve(assistResult(request.assistId))
    },
    'fixes:briefs': (request) => Promise.resolve({ projectId: request.projectId, briefs: saved }),
    'fixes:saveBrief': (request) => {
      calls.briefs.push({ channel: 'fixes:saveBrief', request })
      const record = { fixId: request.fixId, brief: request.brief, savedAt: BUILT_AT }
      saved = [record, ...saved.filter((item) => item.fixId !== request.fixId)]
      return Promise.resolve(record)
    },
    'fixes:pageEdit': (request) =>
      Promise.resolve(edits.find((item) => item.fixId === request.fixId) ?? null),
    'fixes:draftPageEdit': (request) => {
      calls.briefs.push({ channel: 'fixes:draftPageEdit', request })
      const record = pageEditResult(request.fixId, request.url)
      edits = [record, ...edits.filter((item) => item.fixId !== request.fixId)]
      return Promise.resolve(record)
    },
    'fixes:ownerWhy': (request) =>
      Promise.resolve(whys.find((item) => item.fixId === request.fixId) ?? null),
    'fixes:draftOwnerWhy': (request) => {
      calls.briefs.push({ channel: 'fixes:draftOwnerWhy', request })
      const record = ownerWhyResult(request.fixId, request.target.url, request.citedUrl)
      whys = [record, ...whys.filter((item) => item.fixId !== request.fixId)]
      return Promise.resolve(record)
    },
    'fixes:savePageEditHtml': (request) => {
      calls.briefs.push({ channel: 'fixes:savePageEditHtml', request })
      return Promise.resolve({ saved: true })
    },
    'fixes:pageFixCount': () => {
      const rollup = rollupPageFixes(projectSearches().searches)
      return Promise.resolve({
        pageFixes: rollup.fixes.length,
        needWork: rollup.needWork,
        topicFixes: rollup.fixes.filter((fix) => fix.sources.some((s) => s.kind === 'topic')).length
      })
    },
    'grid:exportCsv': (request) => {
      calls.csv.push(request)
      return Promise.resolve({
        ok: true,
        rowCount: request.rows.length,
        columnCount: request.header.length,
        fileName: request.fileName
      })
    },
    ...overrides
  }
  return { source, calls }
}

/** A fix `fixes:create` stored: planned, measured from the next check. */
export function createdFix(request: CreateFixRequest, number: number): LoggedFix {
  return {
    id: `fix-new-${number}`,
    pageId: request.pageId,
    number,
    kind: request.kind ?? 'fix',
    description: request.description,
    goLiveAt: request.goLiveAt,
    rule: request.rule,
    promptIds: request.promptIds,
    marketIds: request.marketIds,
    status: 'planned',
    followUpAt: null,
    followUpJobId: null,
    followUpRunId: null,
    createdAt: request.goLiveAt,
    verdict: null,
    markets: [],
    url: request.url ?? null,
    pageFixId: request.pageFixId ?? null,
    measure: { url: request.url ?? null, questions: [], control: null, trend: [] }
  }
}

/** A page with three edits: a rewrite under the title, a cut, and a new FAQ. */
export function pageEditResult(fixId: string, url: string): PageEditResult {
  return {
    fixId,
    url,
    title: 'AT&T email to text alternative',
    readAt: BUILT_AT,
    blocks: [
      { id: 'b1', kind: 'h1', text: 'AT&T email to text alternative' },
      { id: 'b2', kind: 'p', text: 'Many teams used carrier gateways for years.' },
      { id: 'b3', kind: 'p', text: 'We have been in business since 2015 and love texting.' },
      { id: 'b4', kind: 'h2', text: 'How it works' },
      { id: 'b5', kind: 'li', text: 'Pick a number' }
    ],
    changes: [
      {
        id: 'c1',
        op: 'replace',
        block: 'b2',
        kind: 'p',
        text: 'Carrier addresses such as @txt.att.net no longer deliver. Switch to an email-to-SMS gateway and keep writing from Gmail.',
        why: 'Answers the search in the first two sentences.'
      },
      { id: 'c2', op: 'delete', block: 'b3', why: 'Says nothing the buyer asked for.' },
      {
        id: 'c3',
        op: 'insert',
        after: 'b5',
        kind: 'h2',
        text: 'What can I use instead of the AT&T email-to-text gateway?',
        why: 'The exact search, as an FAQ heading.'
      }
    ],
    summary: 'Answers the main search up top and adds the FAQ buyers ask.',
    note: 'CiteFox AI · about 40 s · no searches',
    savedAt: BUILT_AT
  }
}

/** A comparison that keeps the target and lists what to change on it. */
export function ownerWhyResult(
  fixId: string,
  targetUrl: string,
  citedUrl: string,
  verdict: OwnerWhyResult['verdict'] = 'target'
): OwnerWhyResult {
  return {
    fixId,
    targetUrl,
    citedUrl,
    verdict,
    reason:
      'Google quotes the compare page because it lines the options up side by side. The target page fits the buyer better, so strengthen it.',
    answerNeeds: [
      'Name the ways to send texts from email now',
      'Compare them on set-up and cost',
      'Say which suits a shared inbox'
    ],
    citedHas: [{ section: 'Price per message', point: 'A table of prices per message.' }],
    ownerUrl: verdict === 'cited' ? citedUrl : targetUrl,
    toChange: [
      {
        section: 'Opening',
        change: 'Open with the best replacement and who it suits. [check: the price]',
        why: 'Answers the comparison search first.'
      },
      {
        section: 'New section after How it works',
        change: 'Add a short comparison of the three options.',
        why: 'Gives the answer the side-by-side view.'
      }
    ],
    risk: 'Both pages answer the same searches; link the compare page to the guide.',
    overviews: 2,
    note: 'CiteFox AI · about 30 s · no searches',
    savedAt: BUILT_AT
  }
}
