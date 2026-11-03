import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { createCheckRunner } from '../engine/checks'
import { CheckInputError } from '../engine/checks/results'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import type { HttpResponse } from '../providers/http'
import { bindScheduleQueueTray } from '../scheduler/ipc'
import { manualClock } from '../scheduler/clock'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { listStoredCheckRuns, listStoredSerpResults } from '../storage/check-records'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type NewPromptSet,
  type StoredSnapshot
} from '../storage/content-records'
import { closeDatabase, type SqliteDatabase } from '../storage/database'
import { closeProjectDatabasePool } from '../storage/project-db-pool'
import { listFixFollowUps, createFixFollowUp } from '../storage/fix-follow-ups'
import {
  addPageMarket,
  getPageMarketLastCheckedAt,
  insertPage,
  setPageMarketFirstCheckNotBefore,
  setPageMarketLastCheckedAt
} from '../storage/pages'
import { appDataPaths } from '../storage/paths'
import { createProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { writeProjectScheduleCap } from '../storage/project-schedule'
import { insertApiKey, insertKeyUsage, insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { listRecentTrayChecks } from '../storage/tray-history'
import { MemorySecretStore } from '../secrets/secret-store'
import { CHECK_DUE_EXIT_CAP, CHECK_DUE_EXIT_ERROR, CHECK_DUE_EXIT_OK } from './check-due'
import { runCheckDueCommand } from './storage-pass'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const NOON = Date.parse('2026-04-20T12:00:00.000Z')
const FINISHED = '2026-04-20T12:00:00.000Z'
const SECRET = 'sk-test-secret-value-0123456789'
const dirs: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  // An app database also owns the project databases its pool opened; close those too, or Windows
  // cannot delete the temp folder.
  for (const db of databases.splice(0)) {
    closeProjectDatabasePool(db)
    closeDatabase(db)
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Engine check runner', () => {
  test('check-due records last-checked from the run id the real runner returns', async () => {
    const dir = seedReady({
      lastCheckedAt: '2026-04-18T08:00:00.000Z',
      followUp: true
    })
    const wired = wire(dir)
    const code = await runCheckDueCommand({
      storage: wired.storage,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: wired.runner,
      secrets: [SECRET],
      logger: wired.logger
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(wired.calls).toHaveLength(1)
    expect(new URL(wired.calls[0] ?? '').searchParams.get('engine')).toBe('google')
    expect(new URL(wired.calls[0] ?? '').searchParams.get('api_key')).toBe(SECRET)
    expect(wired.storage.db.open).toBe(true)
    const project = projectDb(dir)
    expect(getPageMarketLastCheckedAt(project, 'page-1', 'mkt-us')).toBe(FINISHED)
    const runs = listStoredCheckRuns(project, readFilter())
    expect(runs.map((run) => run.kind)).toEqual(['follow_up'])
    expect(listFixFollowUps(project, 'page-1')[0]).toMatchObject({
      id: 'fix-planned',
      followUpRunId: runs[0]?.id,
      verdict: null,
      status: 'completed'
    })
    expect(listRecentTrayChecks(wired.storage.db)).toHaveLength(1)
    const raw = listStoredSerpResults(project, readFilter())
      .map((row) => `${row.rawSearchJson ?? ''}${row.rawAioJson ?? ''}`)
      .join('')
    expect(raw).not.toContain(SECRET)
    expect(wired.lines.join('\n')).not.toContain(SECRET)
  })

  test('queue check now uses the same runner', async () => {
    const dir = seedReady({})
    const wired = wire(dir)
    const bound = bindScheduleQueueTray({
      now: () => new Date(NOON),
      timeZone: 'UTC',
      emit: () => undefined,
      claudeConcurrency: () => 2,
      keys: () => [
        {
          id: 'key-1',
          provider: 'serpapi',
          name: 'Search',
          keychainRef: 'citefox.serpapi.key-1',
          hint: 'ab12',
          rotationOrder: 1,
          cap: null,
          on: true,
          projectIds: [],
          state: 'ok',
          lastReason: null,
          serpapiUsage: null
        }
      ],
      storage: wired.storage,
      runner: wired.runner,
      logger: wired.logger,
      loadSecrets: () => [SECRET]
    })
    const started = await bound.queue.checkDue()
    const again = await bound.queue.checkDue()
    expect(started.started).toBe(true)
    expect(started.pages).toBe(1)
    expect(again).toEqual({ started: false, jobIds: started.jobIds, pages: 1 })
    expect(wired.calls).toHaveLength(1)
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBe(FINISHED)
    expect(listRecentTrayChecks(wired.storage.db)).toHaveLength(1)
    expect(wired.lines.join('\n')).not.toContain(SECRET)
  })

  test('a scheduled check stores each search as it is made, once, on the key that made it', async () => {
    const dir = seedReady({ lastCheckedAt: '2026-04-01T08:00:00.000Z' })
    const wired = wire(dir)
    const storedDuringRun: number[] = []
    const code = await runCheckDueCommand({
      storage: wired.storage,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: {
        async run(job) {
          const result = await wired.runner.run(job)
          // A crash here, before the queue sees the result, must not lose the search.
          storedDuringRun.push(storedSearches(wired.storage))
          return result
        }
      },
      secrets: [SECRET],
      logger: wired.logger
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(wired.calls).toHaveLength(1)
    expect(storedDuringRun).toEqual([1])
    expect(storedSearches(wired.storage)).toBe(1)
    const rows = wired.storage.db.prepare('SELECT key_id, project_id FROM key_usage').all()
    expect(rows).toEqual([{ key_id: 'key-1', project_id: 'proj-1' }])
  })

  test('a runner failure leaves last-checked untouched and logs a redacted message', async () => {
    const dir = seedReady({})
    const wired = wire(dir, true)
    const code = await runCheckDueCommand({
      storage: wired.storage,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: wired.runner,
      secrets: [SECRET],
      logger: wired.logger
    })
    expect(code).toBe(CHECK_DUE_EXIT_ERROR)
    expect(wired.calls).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(dir), 'page-1', 'mkt-us')).toBeNull()
    expect(listRecentTrayChecks(wired.storage.db)).toEqual([])
    expect(listStoredCheckRuns(projectDb(dir), readFilter())).toEqual([])
    const log = wired.lines.join('\n')
    expect(log).not.toContain(SECRET)
    expect(log).toContain('[REDACTED]')
    expect(log).toContain('Page check failed')
  })

  test('a project cap and a future first-check hold do not call the runner', async () => {
    const capped = seedReady({ searches: 10, cap: 10 })
    const cappedWire = wire(capped)
    const capCode = await runCheckDueCommand({
      storage: cappedWire.storage,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: cappedWire.runner,
      estimateSearches: () => 1
    })
    expect(capCode).toBe(CHECK_DUE_EXIT_CAP)
    expect(cappedWire.calls).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(capped), 'page-1', 'mkt-us')).toBeNull()

    const held = seedReady({ firstCheckNotBefore: '2026-04-25T00:00:00.000Z' })
    const heldWire = wire(held)
    const heldCode = await runCheckDueCommand({
      storage: heldWire.storage,
      clock: manualClock(NOON),
      timeZone: 'UTC',
      runner: heldWire.runner
    })
    expect(heldCode).toBe(CHECK_DUE_EXIT_OK)
    expect(heldWire.calls).toEqual([])
    expect(getPageMarketLastCheckedAt(projectDb(held), 'page-1', 'mkt-us')).toBeNull()
  })
})

function wire(
  dir: string,
  fail: boolean = false
): {
  storage: AppStorage
  runner: ReturnType<typeof createCheckRunner>
  calls: string[]
  lines: string[]
  logger: ReturnType<typeof createLogger>
} {
  const storage = openAppStorage(dir)
  databases.push(storage.db)
  const secrets = new MemorySecretStore()
  secrets.set('citefox.serpapi.key-1', SECRET)
  const calls: string[] = []
  const lines: string[] = []
  const logger = createLogger({
    write: (_level, line) => {
      lines.push(line)
    },
    secrets: [SECRET]
  })
  let sequence = 0
  const runner = createCheckRunner({
    storage,
    secrets,
    logger,
    http: {
      async request(request) {
        calls.push(request.url)
        return recorded('google-no-aio.json')
      }
    },
    now: () => new Date(NOON),
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    emitProgress: () => {
      if (fail) throw new CheckInputError(`provider said ${SECRET}`)
    },
    emitFinished: () => undefined,
    knownSecrets: () => [SECRET],
    sleep: async () => undefined
  })
  return { storage, runner, calls, lines, logger }
}

function storedSearches(storage: AppStorage): number {
  const row = storage.db
    .prepare<unknown[], { searches: number }>(
      'SELECT COALESCE(SUM(searches), 0) AS searches FROM key_usage'
    )
    .get()
  return row?.searches ?? 0
}

function recorded(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function readFilter(): {
  projectId: string
  pageIds: string[]
  marketId: string
  from: null
  to: null
  runId: null
  promptId: null
} {
  return {
    projectId: 'proj-1',
    pageIds: ['page-1'],
    marketId: 'mkt-us',
    from: null,
    to: null,
    runId: null,
    promptId: null
  }
}

function seedReady(input: {
  lastCheckedAt?: string
  followUp?: boolean
  searches?: number
  cap?: number
  firstCheckNotBefore?: string
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-engine-runner-'))
  dirs.push(dir)
  const storage = openAppStorage(dir)
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
    keychainRef: 'citefox.serpapi.key-1',
    hint: 'ab12',
    rotationOrder: 1,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null
  })
  if (input.searches !== undefined) {
    insertKeyUsage(storage.db, {
      id: 'usage-1',
      keyId: 'key-1',
      projectId: 'proj-1',
      month: '2026-04',
      searches: input.searches,
      calls: 0,
      tokens: 0
    })
  }
  const project = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
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
  insertPage(project, page())
  addPageMarket(project, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: '2026-04-01T08:00:00.000Z',
    baselineRunId: null
  })
  if (input.lastCheckedAt !== undefined) {
    setPageMarketLastCheckedAt(project, 'page-1', 'mkt-us', input.lastCheckedAt)
  }
  if (input.firstCheckNotBefore !== undefined) {
    setPageMarketFirstCheckNotBefore(project, 'page-1', 'mkt-us', input.firstCheckNotBefore)
  }
  insertSnapshot(project, snapshot())
  insertBuyerProfile(project, profile())
  insertPromptSet(project, promptSet(), ['TextBolt'])
  if (input.followUp === true) {
    createFixFollowUp(project, {
      id: 'fix-planned',
      pageId: 'page-1',
      description: 'Added a Saturday crew FAQ.',
      goLiveAt: '2026-04-10T00:00:00.000Z',
      rule: 'after_3_days',
      promptIds: ['prompt-1'],
      marketIds: ['mkt-us']
    })
  }
  if (input.cap !== undefined) {
    writeProjectScheduleCap(project, { cap: input.cap, capRule: 'pause', dedicatedKeyId: null })
  }
  closeDatabase(project)
  storage.close()
  return dir
}

function projectDb(dir: string): SqliteDatabase {
  const db = openProjectDatabase(appDataPaths(dir).projectsDirectory, 'textbolt')
  databases.push(db)
  return db
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: 'Alerts',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 1,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function snapshot(): StoredSnapshot {
  const body = 'TextBolt page body'
  return {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: '2026-04-01T08:00:00.000Z',
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: null,
    h1: 'Alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: 3,
    contentHash: contentHash(body),
    summary: null
  }
}

function profile(): BuyerProfile {
  return {
    id: 'icp-1',
    pageId: 'page-1',
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
    createdAt: '2026-04-01T08:00:00.000Z',
    promptsStale: false
  }
}

function promptSet(): NewPromptSet {
  return {
    id: 'pset-1',
    pageId: 'page-1',
    version: 1,
    savedAt: '2026-04-01T08:00:00.000Z',
    icpId: 'icp-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    prompts: [buyerPrompt()]
  }
}

function buyerPrompt(): BuyerPrompt {
  return {
    id: 'prompt-1',
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
