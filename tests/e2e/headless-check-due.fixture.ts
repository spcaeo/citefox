import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import { PASSWORD } from '../../src/main/email/harness'
import type { DueReportDelivery } from '../../src/main/headless/due-reports'
import {
  createCheckEngine,
  createCheckRunner,
  type CheckEngine,
  type CheckEngineDeps
} from '../../src/main/engine/checks/engine'
import { createLogger, type Logger } from '../../src/main/logging/logger'
import { contentHash } from '../../src/main/pipeline/hash'
import { createFileFixtureSource, readFixtureEnvelope } from '../../src/main/providers/fixtures'
import type { HttpResponse } from '../../src/main/providers/http'
import { SERPAPI_SEARCH_URL } from '../../src/main/providers/serpapi/search'
import type { CheckRunner } from '../../src/main/queue/runner'
import { estimateCheckSearches } from '../../src/main/queue/estimate'
import { manualClock, type Clock } from '../../src/main/scheduler/clock'
import { createNodemailerTransport } from '../../src/main/email/smtp-client'
import { MemorySecretStore } from '../../src/main/secrets/secret-store'
import { openAppStorage, type AppStorage } from '../../src/main/storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type NewPromptSet,
  type StoredSnapshot
} from '../../src/main/storage/content-records'
import { closeDatabase, type SqliteDatabase } from '../../src/main/storage/database'
import { insertEmailAccount, insertReportSchedule } from '../../src/main/storage/email-records'
import { addPageMarket, insertPage, setPageMarketLastCheckedAt } from '../../src/main/storage/pages'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../../src/main/storage/project-files'
import { appDataPaths } from '../../src/main/storage/paths'
import { writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  writeProjectScheduleCap,
  type ProjectScheduleCap
} from '../../src/main/storage/project-schedule'
import { insertApiKey, insertProject } from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

/** Recorded SerpApi replies. The check never opens a socket. */
const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
export const SERP_SECRET = 'sk-test-secret-value-0123456789'
const SERP_REF = 'citefox.serpapi.key-1'
const SMTP_REF = 'citefox.smtp.acct-1'

export const CHECK_DUE_NOON = Date.parse('2026-04-20T12:00:00.000Z')
export const CHECK_DUE_FINISHED = '2026-04-20T12:00:00.000Z'
/** Monday 2 Feb 2026 is the one due weekly slot at noon on 4 Feb. */
export const REPORT_DUE_AT = Date.parse('2026-02-04T12:00:00.000Z')
export const REPORT_SUBJECT = 'TextBolt weekly report'
/** `{project}-report-{date}.{ext}` (src/main/email/reports/export-request.ts), dated in UTC. */
export const REPORT_FILENAME = 'TextBolt-report-2026-02-04.pdf'

export interface SeedPage {
  id: string
  label: string
  url: string
  lastCheckedAt: string | null
  /** A saved snapshot and buyer prompts. Without them the check fails closed. */
  ready: boolean
}

export interface CheckDueWorkspace {
  dir: string
  storage: AppStorage
  secrets: MemorySecretStore
  close(): void
}

export interface FixtureRunner {
  runner: CheckRunner
  calls: string[]
  lines: string[]
  logger: Logger
}

const closers: Array<() => void> = []

export function trackClose(close: () => void): void {
  closers.push(close)
}

export function closeTracked(): void {
  for (const close of closers.splice(0)) close()
}

export function seedCheckDueWorkspace(input: {
  pages: readonly SeedPage[]
  cap?: ProjectScheduleCap
  smtpPort?: number
}): CheckDueWorkspace {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-check-due-e2e-'))
  const storage = openAppStorage(dir)
  const secrets = new MemorySecretStore()
  secrets.set(SERP_REF, SERP_SECRET)
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  insertApiKey(storage.db, {
    id: 'key-1',
    provider: 'serpapi',
    name: 'Search',
    keychainRef: SERP_REF,
    hint: '6789',
    rotationOrder: 1,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null
  })
  const project = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    writeProjectProfile(project, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: ['SimpleTexting'],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    for (const page of input.pages) {
      insertPage(project, pageRow(page))
      addPageMarket(project, {
        pageId: page.id,
        marketId: 'mkt-us',
        addedAt: '2026-01-01T08:00:00.000Z',
        baselineRunId: null
      })
      if (page.lastCheckedAt !== null) {
        setPageMarketLastCheckedAt(project, page.id, 'mkt-us', page.lastCheckedAt)
      }
      if (page.ready) seedReadyPage(project, page.id)
    }
    if (input.cap !== undefined) writeProjectScheduleCap(project, input.cap)
  } finally {
    closeProjectDatabase(project)
  }
  if (input.smtpPort !== undefined) {
    secrets.set(SMTP_REF, PASSWORD)
    insertEmailAccount(storage.db, {
      id: 'acct-1',
      provider: 'other',
      fromName: 'CiteFox',
      fromAddress: 'reports@example.com',
      replyTo: null,
      host: '127.0.0.1',
      port: input.smtpPort,
      security: 'none',
      username: 'mailer',
      keychainRef: SMTP_REF,
      isDefault: true,
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      lastTestNextStep: null
    })
    insertReportSchedule(storage.db, {
      id: 'sched-weekly',
      name: 'Monday report',
      projectId: 'proj-1',
      timing: { kind: 'weekly', day: 1, time: '08:00' },
      format: 'pdf',
      sections: ['results'],
      marketIds: ['mkt-us'],
      recipients: ['client@example.com'],
      accountId: 'acct-1',
      timeZone: 'UTC',
      subject: '{project} weekly report',
      summaryStyle: null,
      status: 'active',
      createdAt: '2026-02-01T00:00:00.000Z'
    })
  }
  const workspace: CheckDueWorkspace = {
    dir,
    storage,
    secrets,
    close() {
      closeDatabase(storage.db)
    }
  }
  trackClose(() => workspace.close())
  return workspace
}

/** One prompt, one market, one sample. The queue reserves the SERP-2 maximum. */
export function reserveMaxSearches(): number {
  return estimateCheckSearches({ prompts: 1, markets: 1, samples: 1 }).maxSearches
}

export function fixtureRunner(
  storage: AppStorage,
  secrets: MemorySecretStore,
  clock: Clock,
  cancelPageIds: ReadonlySet<string> = new Set()
): FixtureRunner {
  const calls: string[] = []
  const lines: string[] = []
  const logger = createLogger({
    write: (_level, line) => {
      lines.push(line)
    },
    secrets: () => [SERP_SECRET, PASSWORD]
  })
  const source = createFileFixtureSource(FIXTURES)
  let sequence = 0
  let active: { jobId: string; pageId: string } | null = null
  const cancelled = new Set<string>()
  const cancelTarget: { engine: CheckEngine | null } = { engine: null }
  const deps: CheckEngineDeps = {
    storage,
    secrets,
    logger,
    http: {
      async request(request): Promise<HttpResponse> {
        calls.push(request.url)
        const url = new URL(request.url)
        if (url.origin + url.pathname !== SERPAPI_SEARCH_URL) {
          throw new Error(`Offline fixture refused ${url.hostname}`)
        }
        const name =
          url.searchParams.get('engine') === 'google_ai_overview'
            ? 'serpapi/google-ai-overview.json'
            : 'serpapi/google-no-aio.json'
        const envelope = readFixtureEnvelope(source, name)
        return { status: envelope.status, body: JSON.stringify(envelope.body) }
      }
    },
    now: () => new Date(clock.now()),
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    emitProgress: (event) => {
      active = { jobId: event.jobId, pageId: event.pageId }
    },
    emitFinished: () => undefined,
    knownSecrets: () => [SERP_SECRET, PASSWORD],
    sleep: async () => undefined,
    timeZone: 'UTC',
    beforeRequest: async () => {
      const current = active
      if (current === null || !cancelPageIds.has(current.pageId)) return
      if (cancelled.has(current.pageId)) return
      cancelled.add(current.pageId)
      const running = cancelTarget.engine
      if (running === null) return
      // `cancel` resolves when the job settles. Awaiting it here would deadlock.
      void running.cancel(current.jobId).catch(() => undefined)
    }
  }
  const engine = createCheckEngine(deps)
  cancelTarget.engine = engine
  return { runner: createCheckRunner(deps, engine), calls, lines, logger }
}

export function reportDelivery(secrets: MemorySecretStore, logger: Logger): DueReportDelivery {
  return {
    secrets,
    transport: createNodemailerTransport({
      connectionTimeoutMs: 5_000,
      greetingTimeoutMs: 5_000,
      socketTimeoutMs: 5_000
    }),
    logger,
    redacted: [SERP_SECRET, PASSWORD]
  }
}

export function clockAt(ms: number): Clock {
  return manualClock(ms)
}

export function openTrackedProject(dir: string): SqliteDatabase {
  const project = openProjectDatabase(appDataPaths(dir).projectsDirectory, 'textbolt')
  trackClose(() => closeProjectDatabase(project))
  return project
}

function pageRow(page: SeedPage): PageSummary {
  return {
    id: page.id,
    projectId: 'proj-1',
    url: page.url,
    title: page.label,
    label: page.label,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 1,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function seedReadyPage(db: SqliteDatabase, pageId: string): void {
  const body = `TextBolt page body ${pageId}`
  insertSnapshot(db, {
    id: `snap-${pageId}`,
    pageId,
    fetchedAt: '2026-01-01T08:00:00.000Z',
    method: 'file',
    httpStatus: null,
    durationMs: 0,
    title: pageId,
    metaDescription: null,
    h1: pageId,
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: 4,
    contentHash: contentHash(body),
    summary: null
  } satisfies StoredSnapshot)
  insertBuyerProfile(db, {
    id: `icp-${pageId}`,
    pageId,
    snapshotId: `snap-${pageId}`,
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
    createdAt: '2026-01-01T08:00:00.000Z',
    promptsStale: false
  } satisfies BuyerProfile)
  const prompts: NewPromptSet = {
    id: `pset-${pageId}`,
    pageId,
    version: 1,
    savedAt: '2026-01-01T08:00:00.000Z',
    icpId: `icp-${pageId}`,
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    prompts: [buyerPrompt(pageId)]
  }
  insertPromptSet(db, prompts, ['TextBolt'])
}

function buyerPrompt(pageId: string): BuyerPrompt {
  return {
    id: `prompt-${pageId}`,
    position: 1,
    label: 'Crew',
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      {
        marketId: 'mkt-us',
        language: 'en',
        text: 'How do I alert the crew?',
        originalText: null
      }
    ]
  }
}
