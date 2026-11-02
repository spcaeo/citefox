/**
 * A TextBolt page with three buyer prompts in 🇺🇸 US · EN and 🇬🇧 UK · EN, checked
 * through the real IPC handlers against recorded SerpApi bodies. Shared by the
 * Progress and History handler tests and the e2e seed. Test-only: no network.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, Market, PageFaq, PageSummary } from '@shared/domain'
import type { IpcHandlerMap } from '@shared/ipc'
import type { AlertSenders } from '../alerts/deliver'
import { setEngineEmailTestPorts, type EngineEmailTestPorts } from '../email/engine-email'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import type { CommandTransport } from '../providers/command'
import type { BinaryProbe } from '../providers/claude/binary'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { HttpResponse, HttpTransport } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type StoredSnapshot
} from '../storage/content-records'
import { addPageMarket, insertPage } from '../storage/pages'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import { insertMarket, writeProjectProfile } from '../storage/project-profile'
import {
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { createIpcHandlers } from './index'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const SECRET = 'fixture-serpapi-secret-progress'
const KEYCHAIN_REF = 'citefox.serpapi.progress-key-1'

export const PROGRESS_SEED = {
  projectId: 'proj-1',
  pageId: 'page-1',
  us: 'mkt-us',
  uk: 'mkt-uk',
  prompts: [
    { id: 'prompt-1', label: 'Crew alerts', text: 'How do I alert the crew without a developer?' },
    { id: 'prompt-2', label: 'Scheduled plan', text: 'Which plan covers scheduled texts?' },
    { id: 'prompt-3', label: 'Replies by email', text: 'Can staff reply to an alert by email?' }
  ],
  first: '2026-10-05T12:00:00.000Z',
  second: '2026-10-19T12:00:00.000Z'
} as const

export const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** `market|query` → recorded body. Tests change entries between checks. */
export type FixtureBodies = Map<string, string>

export interface ProgressSeed {
  storage: AppStorage
  handlers: IpcHandlerMap
  bodies: FixtureBodies
  setClock(iso: string): void
  /** Runs one real `checks:start` and throws unless it finished. */
  check(at: string, promptIds?: readonly string[] | null): Promise<void>
  /** A second page read with new content (FR-7.3). */
  readPage(id: string, at: string, change: { body: string; faqs: readonly PageFaq[] }): void
  /** The recorded SerpApi transport, for an engine built outside the handlers (headless tests). */
  http: HttpTransport
  /** The keychain stand-in (SerpApi key, and any SMTP password or webhook saved through IPC). */
  secrets: MemorySecretStore
  /** Closes the handlers' email host, as when the window is gone (headless tests). */
  closeEmailHost(): void
  close(): void
}

export function defaultBodies(): FixtureBodies {
  const [one, two, three] = PROGRESS_SEED.prompts
  return new Map([
    [`us|${one.text}`, 'google-ai-overview.json'],
    [`us|${two.text}`, 'google-own-page.json'],
    [`us|${three.text}`, 'google-competitor.json'],
    [`uk|${one.text}`, 'google-competitor.json'],
    [`uk|${two.text}`, 'google-own-page.json'],
    [`uk|${three.text}`, 'google-competitor.json']
  ])
}

/**
 * Creates the project files in `userDataDir`. `serpKey: false` leaves no
 * SerpApi key, so a check cannot start (the "could not start" path).
 * `competitors` replaces the saved competitor domains; `claude` answers assists.
 */
export function openProgressSeed(
  userDataDir: string,
  options: {
    serpKey?: boolean
    competitors?: readonly string[]
    claude?: ClaudeProvider
    /** Fake alert senders (alert rules tests). */
    alertSenders?: AlertSenders
    /** Offline email ports, such as a memory Slack transport. */
    emailPorts?: EngineEmailTestPorts
    /** A keychain stand-in the test keeps (for a second engine on the same files). */
    secrets?: MemorySecretStore
  } = {}
): ProgressSeed {
  const storage = openAppStorage(userDataDir)
  if (options.emailPorts !== undefined) setEngineEmailTestPorts(storage, options.emailPorts)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  const bodies = defaultBodies()
  let host: EngineHost | undefined
  let clock = Date.parse(PROGRESS_SEED.first)
  let sequence = 0
  try {
    seedRows(storage, projectDb, options.competitors ?? ['simpletexting.com', 'twilio.com'])
    if (options.serpKey !== false) {
      insertApiKey(storage.db, {
        id: 'key-1',
        provider: 'serpapi',
        name: 'My plan',
        keychainRef: KEYCHAIN_REF,
        hint: 'ss01',
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
  const secrets = options.secrets ?? new MemorySecretStore()
  secrets.set(KEYCHAIN_REF, SECRET)
  const http: HttpTransport = {
    async request(request) {
      const url = new URL(request.url)
      if (url.searchParams.get('engine') === 'google') {
        const gl = (url.searchParams.get('gl') ?? '').toLowerCase()
        const market = gl === 'uk' || gl === 'gb' ? 'uk' : 'us'
        return tokenEnvelope(`${market}|${url.searchParams.get('q') ?? ''}`)
      }
      const token = url.searchParams.get('page_token') ?? ''
      return envelope(bodies.get(token) ?? 'google-competitor.json')
    }
  }
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger: createLogger({ write: () => undefined, secrets: () => [SECRET] }),
    http,
    claudeCommand: stubCommand(),
    claudeProbe: { exists: () => false, searchPath: () => null } satisfies BinaryProbe,
    ...(options.claude !== undefined ? { claude: options.claude } : {}),
    ...(options.alertSenders !== undefined ? { alertSenders: options.alertSenders } : {}),
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => [SECRET],
    now: () => new Date(clock),
    createId: () => {
      sequence += 1
      clock += 1000
      return `seed-${sequence}`
    },
    onHost: (opened) => {
      host = opened
    }
  })
  return {
    storage,
    handlers,
    bodies,
    setClock(iso: string): void {
      clock = Date.parse(iso)
    },
    async check(at: string, promptIds: readonly string[] | null = null): Promise<void> {
      clock = Date.parse(at)
      const job = await handlers['checks:start']({
        projectId: PROGRESS_SEED.projectId,
        pageIds: [PROGRESS_SEED.pageId],
        marketIds: null,
        promptIds
      })
      if (job.status !== 'finished') {
        throw new Error(job.message ?? `Seed check ended as ${job.status}`)
      }
    },
    readPage(id, at, change): void {
      const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
      try {
        insertSnapshot(db, snapshot(id, at, change.body, change.faqs))
      } finally {
        closeProjectDatabase(db)
      }
    },
    http,
    secrets,
    closeEmailHost(): void {
      host?.email.close()
    },
    close(): void {
      host?.email.close()
      storage.close()
    }
  }
}

/** Marks onboarding done and the project active, for a window launched on this folder. */
export function finishOnboarding(storage: AppStorage): void {
  writeOnboardingFinished(storage.db, true)
  writeActiveProjectId(storage.db, PROGRESS_SEED.projectId)
}

function seedRows(
  storage: AppStorage,
  db: ReturnType<typeof createProjectDatabase>,
  competitors: readonly string[]
): void {
  insertProject(storage.db, {
    id: PROGRESS_SEED.projectId,
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [...competitors],
    market: US
  })
  insertMarket(db, UK)
  insertPage(db, page())
  for (const marketId of [PROGRESS_SEED.us, PROGRESS_SEED.uk]) {
    addPageMarket(db, {
      pageId: PROGRESS_SEED.pageId,
      marketId,
      addedAt: PROGRESS_SEED.first,
      baselineRunId: null
    })
  }
  insertSnapshot(
    db,
    snapshot(
      'snap-1',
      PROGRESS_SEED.first,
      'TextBolt sends text alerts from email. No developer required.',
      []
    )
  )
  insertBuyerProfile(db, profile())
  insertPromptSet(
    db,
    {
      id: 'pset-1',
      pageId: PROGRESS_SEED.pageId,
      version: 1,
      savedAt: PROGRESS_SEED.first,
      icpId: 'icp-1',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: PROGRESS_SEED.prompts.map((prompt, index) =>
        buyerPrompt(prompt.id, index + 1, prompt.label, prompt.text)
      )
    },
    ['TextBolt']
  )
}

const US: Market = {
  id: PROGRESS_SEED.us,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: PROGRESS_SEED.uk, country: 'UK' }

function snapshot(id: string, at: string, body: string, faqs: readonly PageFaq[]): StoredSnapshot {
  return {
    id,
    pageId: PROGRESS_SEED.pageId,
    fetchedAt: at,
    method: 'jina' as const,
    httpStatus: 200,
    durationMs: 4,
    title: 'Text alerts for business',
    metaDescription: null,
    h1: 'Text alerts for business',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs,
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    contentHash: contentHash(body),
    summary: null
  }
}

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

/** The recorded page-token body, with a token that names the market and query. */
function tokenEnvelope(token: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, 'google-page-token.json'), 'utf8')) as {
    status: number
    body: { ai_overview: { page_token: string } }
  }
  parsed.body.ai_overview.page_token = token
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function page(): PageSummary {
  return {
    id: PROGRESS_SEED.pageId,
    projectId: PROGRESS_SEED.projectId,
    url: PAGE_URL,
    title: 'Text alerts for business',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 3,
    defaultMarketId: PROGRESS_SEED.us,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function profile(): BuyerProfile {
  return {
    id: 'icp-1',
    pageId: PROGRESS_SEED.pageId,
    snapshotId: 'snap-1',
    who: 'Office managers.',
    environment: 'They send email.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: [],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: PROGRESS_SEED.first,
    promptsStale: false
  }
}

function buyerPrompt(id: string, position: number, label: string, text: string): BuyerPrompt {
  return {
    id,
    position,
    label,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      { marketId: PROGRESS_SEED.us, language: 'en', text, originalText: null },
      { marketId: PROGRESS_SEED.uk, language: 'en', text, originalText: null }
    ]
  }
}

function stubCommand(): CommandTransport {
  return {
    async run() {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
    }
  }
}
