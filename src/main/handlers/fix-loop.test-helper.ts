/**
 * A TextBolt project with four tracked pages and one logged change each, checked
 * through the real IPC handlers against SerpApi bodies generated in code from a map of
 * `query → cited URLs`. It ends with one change per ledger status: Lost ground, Cited
 * now, Not cited yet and Too new. Every date is relative to `now`, because the e2e app
 * counts "days live" against the real clock. Shared by the fix-loop handler tests and
 * the e2e seed. Test-only: no network.
 */

import type {
  BuyerProfile,
  BuyerPrompt,
  FixKind,
  IntentStage,
  Market,
  OutlineEntry,
  PageSummary
} from '@shared/domain'
import type { IpcHandlerMap } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import type { BinaryProbe } from '../providers/claude/binary'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { CommandTransport } from '../providers/command'
import type { HttpResponse, HttpTransport } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type StoredSnapshot
} from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { insertIndexCheck, putPageAiText } from '../storage/fix-loop-records'
import { addPageMarket, insertPage } from '../storage/pages'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import {
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { createIpcHandlers } from './index'

const DAY_MS = 86_400_000
const SECRET = 'fixture-serpapi-secret-fix-loop'
const KEYCHAIN_REF = 'citefox.serpapi.fix-loop-key-1'
const SLUG = 'textbolt'

const COMPETITORS = [
  'https://simpletexting.com/blog/business-text-alerts/',
  'https://www.twilio.com/en-us/blog/sms-alerts'
] as const

interface SeedPrompt {
  id: string
  text: string
  stage: IntentStage
}

interface SeedPage {
  id: string
  url: string
  title: string
  prompts: readonly SeedPrompt[]
  change: { kind: FixKind; liveDaysAgo: number; description: string }
}

const ALERTS: SeedPage = {
  id: 'page-alerts',
  url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  title: 'Text alerts for business',
  prompts: [
    { id: 'alerts-1', text: 'How do I set up text alerts for my business?', stage: 'problem' },
    {
      id: 'alerts-2',
      text: 'Can I send business text alerts from email without a developer?',
      stage: 'solution'
    },
    {
      id: 'alerts-3',
      text: 'What can I do when carrier email-to-text stops working?',
      stage: 'problem'
    },
    { id: 'alerts-4', text: 'Which text alert plan is cheapest per message?', stage: 'comparison' },
    {
      id: 'alerts-5',
      text: 'How much do business text alerts cost per month?',
      stage: 'comparison'
    },
    {
      id: 'alerts-6',
      text: 'Is a text alert service better than a group chat?',
      stage: 'objection'
    }
  ],
  change: {
    kind: 'rewrite',
    liveDaysAgo: 15,
    description: 'Rewrote the guide as a short platform list.'
  }
}

const PRICING: SeedPage = {
  id: 'page-pricing',
  url: 'https://textbolt.com/pricing/',
  title: 'Pricing',
  prompts: [
    {
      id: 'pricing-1',
      text: 'How much does a business SMS service cost per text?',
      stage: 'comparison'
    },
    {
      id: 'pricing-2',
      text: 'Is there a per-message price table for business texting?',
      stage: 'comparison'
    },
    {
      id: 'pricing-3',
      text: 'Which business texting plans have no monthly fee?',
      stage: 'objection'
    }
  ],
  change: { kind: 'fix', liveDaysAgo: 12, description: 'Added a per-message price table.' }
}

const SCHEDULE: SeedPage = {
  id: 'page-schedule',
  url: 'https://textbolt.com/blog/schedule-text-messages/',
  title: 'Schedule text messages',
  prompts: [
    { id: 'schedule-1', text: 'How do I schedule text messages to my team?', stage: 'problem' },
    { id: 'schedule-2', text: 'Can I schedule a business text a week ahead?', stage: 'solution' },
    {
      id: 'schedule-3',
      text: 'What is the best app to schedule business texts?',
      stage: 'comparison'
    }
  ],
  change: {
    kind: 'new_page',
    liveDaysAgo: 11,
    description: 'Published a guide to scheduling texts.'
  }
}

const GMAIL: SeedPage = {
  id: 'page-gmail',
  url: 'https://textbolt.com/blog/text-from-gmail/',
  title: 'Text from Gmail',
  prompts: [
    { id: 'gmail-1', text: 'How do I send a text message from Gmail?', stage: 'problem' },
    {
      id: 'gmail-2',
      text: 'Can I text a phone number from my email account?',
      stage: 'solution'
    }
  ],
  change: {
    kind: 'new_page',
    liveDaysAgo: 2,
    description: 'Published a guide to texting from Gmail.'
  }
}

const PAGES = [ALERTS, PRICING, SCHEDULE, GMAIL] as const

/** The six H2s of the alerts guide before the rewrite, and after it (two gone, two new). */
const ALERTS_OUTLINE_BEFORE = [
  'What are text alerts for business?',
  'How to set up text alerts in 5 steps',
  'Send alerts from email without a developer',
  'What to do when carrier email-to-text stops working',
  'Scheduled alerts for shift changes',
  'Text alert pricing'
]
const ALERTS_OUTLINE_AFTER = [
  'What are text alerts for business?',
  'Best SMS platforms compared',
  'Send alerts from email without a developer',
  'Our top picks this year',
  'Scheduled alerts for shift changes',
  'Text alert pricing'
]

export const FIX_LOOP_SEED = {
  projectId: 'proj-fix',
  marketId: 'mkt-us',
  keyId: 'key-fix-1',
  domain: 'textbolt.com',
  brand: 'TextBolt',
  pages: { alerts: ALERTS, pricing: PRICING, schedule: SCHEDULE, gmail: GMAIL },
  featuresUrl: 'https://textbolt.com/features/',
  competitors: COMPETITORS,
  outline: { before: ALERTS_OUTLINE_BEFORE, after: ALERTS_OUTLINE_AFTER },
  anchor: { pageId: SCHEDULE.id, text: 'schedule text messages from email' },
  /** Days before `now` of each full check. */
  checks: { first: 18, second: 4, gmail: 1 }
} as const

/** Query → the URLs the overview cites, in order. An empty list means no overview. */
export type CitedBodies = Map<string, readonly string[]>

/** `site:<address>` target → the organic result links. Missing or empty: no results. */
export type SiteResults = Map<string, readonly string[]>

export interface FixLoopSeed {
  storage: AppStorage
  handlers: IpcHandlerMap
  host: EngineHost
  bodies: CitedBodies
  sites: SiteResults
  /** Every SerpApi request the fake transport answered, in order. */
  requests: URL[]
  /** The `now` every seeded date is relative to. */
  now: number
  setClock(iso: string): void
  /** ISO-8601 UTC `days` before `now`. */
  daysAgo(days: number): string
  /** Runs one real `checks:start` for these pages and throws unless it finished. */
  check(at: string, pageIds: readonly [string, ...string[]]): Promise<void>
  /** Opens the project file for direct reads in a test. Close it with `closeProjectDatabase`. */
  openProject(): SqliteDatabase
  close(): void
}

export interface FixLoopSeedOptions {
  now?: number
  /** Claude for assist tests (a scripted provider). */
  claude?: ClaudeProvider
  /** Replaces the generated SerpApi transport (recorded bodies in index-check tests). */
  http?: HttpTransport
  /** False leaves no SerpApi key. */
  serpKey?: boolean
}

/** The project files with every page, prompt and first page read, before any check. */
export function openFixLoopSeed(
  userDataDir: string,
  options: FixLoopSeedOptions = {}
): FixLoopSeed {
  const now = options.now ?? Date.now()
  const daysAgo = (days: number): string => new Date(now - days * DAY_MS).toISOString()
  const storage = openAppStorage(userDataDir)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, SLUG)
  try {
    seedRows(storage, projectDb, daysAgo)
    if (options.serpKey !== false) {
      insertApiKey(storage.db, {
        id: FIX_LOOP_SEED.keyId,
        provider: 'serpapi',
        name: 'My plan',
        keychainRef: KEYCHAIN_REF,
        hint: 'fx01',
        rotationOrder: 1,
        cap: null,
        on: true,
        projectIds: [],
        state: 'ok',
        lastReason: null,
        serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' }
      })
    }
  } finally {
    closeProjectDatabase(projectDb)
  }
  const bodies: CitedBodies = new Map()
  const sites: SiteResults = new Map([[siteOf(ALERTS.url), [ALERTS.url, PRICING.url]]])
  const requests: URL[] = []
  let clock = now
  let sequence = 0
  let host: EngineHost | undefined
  const secrets = new MemorySecretStore()
  secrets.set(KEYCHAIN_REF, SECRET)
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger: createLogger({ write: () => undefined, secrets: () => [SECRET] }),
    http: options.http ?? {
      async request(request) {
        const url = new URL(request.url)
        requests.push(url)
        return generatedBody(url, bodies, sites)
      }
    },
    claudeCommand: stubCommand(),
    claudeProbe: { exists: () => false, searchPath: () => null } satisfies BinaryProbe,
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => [SECRET],
    now: () => new Date(clock),
    createId: () => {
      sequence += 1
      clock += 1000
      return `fx-${sequence}`
    },
    ...(options.claude !== undefined ? { claude: options.claude } : {}),
    onHost: (opened) => {
      host = opened
    }
  })
  if (host === undefined) throw new Error('The seed host did not open')
  const opened = host
  return {
    storage,
    handlers,
    host: opened,
    bodies,
    sites,
    requests,
    now,
    setClock(iso: string): void {
      clock = Date.parse(iso)
    },
    daysAgo,
    async check(at: string, pageIds: readonly [string, ...string[]]): Promise<void> {
      clock = Date.parse(at)
      const job = await handlers['checks:start']({
        projectId: FIX_LOOP_SEED.projectId,
        pageIds,
        marketIds: null,
        promptIds: null
      })
      if (job.status !== 'finished') {
        throw new Error(job.message ?? `Seed check ended as ${job.status}`)
      }
    },
    openProject(): SqliteDatabase {
      return openProjectDatabase(storage.paths.projectsDirectory, SLUG)
    },
    close(): void {
      opened.email.close()
      storage.close()
    }
  }
}

/**
 * The finished story: two full checks of the alerts and pricing pages around their
 * changes, the alerts guide read again after its rewrite, one check of the new pages,
 * a stored "not indexed" for the schedule page and its cached anchor. Leaves the seed
 * open for more steps; {@link seedFixLoopProject} closes it.
 */
export async function buildFixLoopStory(seed: FixLoopSeed): Promise<void> {
  const { bodies, daysAgo } = seed
  const ago = FIX_LOOP_SEED.checks
  // First full check: the guide is cited for 5 of its 6 questions, pricing for none.
  for (const prompt of ALERTS.prompts) {
    bodies.set(
      prompt.text,
      prompt.id === 'alerts-6' ? [...COMPETITORS] : [ALERTS.url, ...COMPETITORS]
    )
  }
  for (const prompt of PRICING.prompts) bodies.set(prompt.text, [...COMPETITORS])
  await seed.check(daysAgo(ago.first), [ALERTS.id, PRICING.id])

  for (const page of PAGES) await logChange(seed, page)
  readAlertsAgain(seed)

  // Second full check: the guide keeps 1, two plan questions move to pricing, the carrier
  // question to the features page, one goes to competitors; pricing is cited for all 3.
  const later: Readonly<Record<string, readonly string[]>> = {
    'alerts-1': [ALERTS.url, ...COMPETITORS],
    'alerts-2': [...COMPETITORS],
    'alerts-3': [FIX_LOOP_SEED.featuresUrl, ...COMPETITORS],
    'alerts-4': [PRICING.url, ...COMPETITORS],
    'alerts-5': [...COMPETITORS, PRICING.url],
    'alerts-6': [...COMPETITORS]
  }
  for (const prompt of ALERTS.prompts) bodies.set(prompt.text, later[prompt.id] ?? [])
  for (const prompt of PRICING.prompts) bodies.set(prompt.text, [PRICING.url, ...COMPETITORS])
  for (const prompt of SCHEDULE.prompts) bodies.set(prompt.text, [...COMPETITORS])
  await seed.check(daysAgo(ago.second), [ALERTS.id, PRICING.id, SCHEDULE.id])

  for (const prompt of GMAIL.prompts) bodies.set(prompt.text, [...COMPETITORS])
  await seed.check(daysAgo(ago.gmail), [GMAIL.id])

  const db = seed.openProject()
  try {
    insertIndexCheck(db, {
      id: 'idx-schedule-1',
      pageId: SCHEDULE.id,
      url: SCHEDULE.url,
      state: 'not_indexed',
      checkedAt: daysAgo(1),
      searches: 1,
      message: null
    })
    putPageAiText(db, {
      pageId: FIX_LOOP_SEED.anchor.pageId,
      kind: 'anchor',
      inputKey: FIX_LOOP_SEED.anchor.pageId,
      text: FIX_LOOP_SEED.anchor.text,
      edited: false,
      savedAt: daysAgo(1)
    })
  } finally {
    closeProjectDatabase(db)
  }
  seed.setClock(new Date(seed.now).toISOString())
}

/**
 * For the e2e specs: the finished story in `userDataDir`, onboarding done and the
 * project active, then everything closed so a window can open the folder.
 */
export async function seedFixLoopProject(
  userDataDir: string,
  options: { now?: number } = {}
): Promise<void> {
  const seed = openFixLoopSeed(userDataDir, options)
  try {
    await buildFixLoopStory(seed)
    writeOnboardingFinished(seed.storage.db, true)
    writeActiveProjectId(seed.storage.db, FIX_LOOP_SEED.projectId)
  } finally {
    seed.close()
  }
}

async function logChange(seed: FixLoopSeed, page: SeedPage): Promise<void> {
  const liveAt = seed.daysAgo(page.change.liveDaysAgo)
  seed.setClock(liveAt)
  await seed.handlers['fixes:create']({
    projectId: FIX_LOOP_SEED.projectId,
    pageId: page.id,
    description: page.change.description,
    goLiveAt: liveAt,
    rule: 'next_scheduled',
    promptIds: page.prompts.map((prompt) => prompt.id),
    marketIds: [FIX_LOOP_SEED.marketId],
    kind: page.change.kind
  })
}

/** The alerts guide read again the day after its rewrite. */
function readAlertsAgain(seed: FixLoopSeed): void {
  const db = seed.openProject()
  try {
    insertSnapshot(
      db,
      snapshot(ALERTS, 'snap-alerts-2', seed.daysAgo(14), ALERTS_OUTLINE_AFTER, {
        publishedAt: seed.daysAgo(200),
        modifiedAt: seed.daysAgo(ALERTS.change.liveDaysAgo)
      })
    )
  } finally {
    closeProjectDatabase(db)
  }
}

function seedRows(
  storage: AppStorage,
  db: SqliteDatabase,
  daysAgo: (days: number) => string
): void {
  insertProject(storage.db, {
    id: FIX_LOOP_SEED.projectId,
    name: 'TextBolt',
    slug: SLUG,
    domain: FIX_LOOP_SEED.domain,
    dbPath: projectDatabaseRelativePath(SLUG),
    clientName: null,
    status: 'active'
  })
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: [FIX_LOOP_SEED.brand],
    competitors: ['simpletexting.com', 'twilio.com'],
    market: US
  })
  for (const page of PAGES) {
    // A new page was first read on its go-live day; the others long before.
    const isNew = page.change.kind === 'new_page'
    const readAt = daysAgo(isNew ? page.change.liveDaysAgo : 20)
    insertPage(db, pageSummary(page))
    addPageMarket(db, {
      pageId: page.id,
      marketId: FIX_LOOP_SEED.marketId,
      addedAt: readAt,
      baselineRunId: null
    })
    const outline = page.id === ALERTS.id ? ALERTS_OUTLINE_BEFORE : [`About ${page.title}`]
    insertSnapshot(
      db,
      snapshot(page, `snap-${page.id}`, readAt, outline, {
        publishedAt: isNew ? daysAgo(page.change.liveDaysAgo) : daysAgo(200),
        modifiedAt: null
      })
    )
    insertBuyerProfile(db, profile(page, readAt))
    insertPromptSet(
      db,
      {
        id: `pset-${page.id}`,
        pageId: page.id,
        version: 1,
        savedAt: readAt,
        icpId: `icp-${page.id}`,
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: page.prompts.map((prompt, index) => buyerPrompt(prompt, index + 1))
      },
      [FIX_LOOP_SEED.brand]
    )
  }
}

const US: Market = {
  id: FIX_LOOP_SEED.marketId,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function pageSummary(page: SeedPage): PageSummary {
  return {
    id: page.id,
    projectId: FIX_LOOP_SEED.projectId,
    url: page.url,
    title: page.title,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: page.prompts.length,
    defaultMarketId: FIX_LOOP_SEED.marketId,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function snapshot(
  page: SeedPage,
  id: string,
  at: string,
  headings: readonly string[],
  dates: { publishedAt: string | null; modifiedAt: string | null }
): StoredSnapshot {
  const outline: OutlineEntry[] = headings.map((text) => ({ level: 'h2', text, table: false }))
  const body = [
    page.title,
    ...headings.map((text) => `${text}. TextBolt turns email into SMS.`)
  ].join('\n')
  return {
    id,
    pageId: page.id,
    fetchedAt: at,
    method: 'direct',
    httpStatus: 200,
    durationMs: 4,
    title: page.title,
    metaDescription: null,
    h1: page.title,
    canonical: null,
    publishedAt: dates.publishedAt,
    modifiedAt: dates.modifiedAt,
    outline,
    faqs: [],
    h2Count: headings.length,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    contentHash: contentHash(body),
    summary: null
  }
}

function profile(page: SeedPage, at: string): BuyerProfile {
  return {
    id: `icp-${page.id}`,
    pageId: page.id,
    snapshotId: `snap-${page.id}`,
    who: 'Office managers at small US businesses.',
    environment: 'They send email all day.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: at,
    promptsStale: false
  }
}

function buyerPrompt(prompt: SeedPrompt, position: number): BuyerPrompt {
  return {
    id: prompt.id,
    position,
    label: prompt.text.slice(0, 40).trim(),
    source: 'title_meta_h1',
    intentStage: prompt.stage,
    mappedElement: 'intro',
    enabled: true,
    variants: [
      { marketId: FIX_LOOP_SEED.marketId, language: 'en', text: prompt.text, originalText: null }
    ]
  }
}

/** `site:` target of an address: no scheme, no trailing slash. */
function siteOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
}

/**
 * A Google SerpApi body built from the maps: a `site:` query answers with organic
 * results (or SerpApi's "no results" error), any other query with an AI Overview citing
 * the mapped URLs (or no overview).
 */
export function generatedBody(url: URL, bodies: CitedBodies, sites: SiteResults): HttpResponse {
  const query = url.searchParams.get('q') ?? ''
  if (query.startsWith('site:')) {
    const links = sites.get(query.slice('site:'.length)) ?? []
    if (links.length === 0) {
      return json({
        search_metadata: { status: 'Success', id: 'fx-site-empty' },
        error: "Google hasn't returned any results for this query."
      })
    }
    return json({
      search_metadata: { status: 'Success', id: 'fx-site' },
      organic_results: links.map((link, index) => ({ position: index + 1, link, title: link }))
    })
  }
  const cited = bodies.get(query) ?? []
  if (cited.length === 0) {
    return json({ search_metadata: { status: 'Success', id: 'fx-no-aio' }, organic_results: [] })
  }
  return json({
    search_metadata: { status: 'Success', id: 'fx-aio' },
    ai_overview: {
      text_blocks: [{ type: 'paragraph', snippet: `Answer to: ${query}` }],
      references: cited.map((link, index) => ({
        title: link,
        link,
        source: new URL(link).hostname,
        index
      }))
    }
  })
}

function json(body: unknown): HttpResponse {
  return { status: 200, body: JSON.stringify(body) }
}

function stubCommand(): CommandTransport {
  return {
    async run() {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
    }
  }
}
