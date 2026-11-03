import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import type { CheckFinishedNotice, CheckProgress, ResultsChanged } from '@shared/ipc'
import { expect } from 'vitest'
import { createIpcHandlers } from '../../handlers'
import type { IpcHandlerDeps } from '../../handlers'
import { createLogger } from '../../logging/logger'
import { contentHash } from '../../pipeline/hash'
import type { HttpRequest, HttpResponse } from '../../providers/http'
import type { CommandTransport } from '../../providers/command'
import type { BinaryProbe } from '../../providers/claude/binary'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import type { RunningJob } from '../../queue/types'
import { MemorySecretStore } from '../../secrets/secret-store'
import { openAppStorage } from '../../storage/app-storage'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredCheckStep,
  insertStoredRun,
  insertStoredSerpResult,
  type CheckReadFilter
} from '../../storage/check-records'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type StoredSnapshot
} from '../../storage/content-records'
import { addPageMarket, insertPage, listPageMarkets } from '../../storage/pages'
import { createProjectDatabase, closeProjectDatabase } from '../../storage/project-files'
import { writeProjectProfile } from '../../storage/project-profile'
import { addKeyUsage, insertApiKey, insertProject } from '../../storage/records'
import { projectDatabaseRelativePath } from '../../storage/slug'
import { monthKey } from '../../scheduler/local-time'
import { createCheckEngine, type CheckEngine, type CheckEngineDeps } from './engine'

/**
 * Shared fixture project for the check engine tests: one page, one US market,
 * one SerpApi key, and a scripted HTTP transport.
 */
export const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
export const NOW = '2026-10-19T12:00:00.000Z'
export const SECRET = 'sk-test-secret-value'
export const closers: Array<() => void> = []

/** Call from `afterEach`. Closes every database the seeds opened. */
export function closeSeeds(): void {
  for (const close of closers.splice(0)) close()
}

export function scheduledJob(): RunningJob {
  return {
    id: 'job-scheduled',
    projectId: 'proj-1',
    pageId: 'page-1',
    marketIds: ['mkt-us'],
    reason: 'scheduled',
    promptIds: null,
    partial: false,
    needsClaude: false,
    maxSearches: 2,
    startedAt: NOW,
    cancelRequested: false
  }
}

export function runFilter(runId: string | null = null): CheckReadFilter {
  return {
    projectId: 'proj-1',
    pageIds: ['page-1'] as const,
    marketId: 'mkt-us',
    from: null,
    to: null,
    runId,
    promptId: null
  }
}

export function createGate(): {
  beforeRequest: () => Promise<void>
  release: () => void
  pending: () => number
} {
  const waiters: Array<() => void> = []
  return {
    beforeRequest: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve)
      }),
    release() {
      const next = waiters.shift()
      if (next === undefined) throw new Error('No check is waiting')
      next()
    },
    pending: () => waiters.length
  }
}

export async function until(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('Timed out waiting for the check')
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export async function seed(input: {
  progress: CheckProgress[]
  finished?: CheckFinishedNotice[]
  events?: string[]
  /** `results:changed` pushes, in order. */
  changed?: ResultsChanged[]
  beforeRequest?: () => Promise<void>
  secondPage?: boolean
  secondPrompt?: boolean
  /** Extra SerpApi keys after `key-1`, in rotation order. Each secret is `${SECRET}-${id}`. */
  extraKeys?: readonly string[]
  sleep?: (ms: number) => Promise<void>
  claude?: ClaudeProvider
  /** Every log line the engine writes, for a test that checks a failure was logged. */
  logLines?: string[]
  /** A promise lets a test hold a response, so calls overlap as they do live. */
  http: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>
  /** Questions of one market at once. Default: the engine's own. */
  questionsAtOnce?: number
}): Promise<{
  handlers: ReturnType<typeof createIpcHandlers>
  projectDb: ReturnType<typeof createProjectDatabase>
  storage: ReturnType<typeof openAppStorage>
  checkEngine: CheckEngine
  checkDeps: CheckEngineDeps
}> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-checks-'))
  const storage = openAppStorage(directory)
  closers.push(() => storage.close())
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  closers.push(() => closeProjectDatabase(projectDb))
  writeProjectProfile(projectDb, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['SimpleTexting', 'Twilio'],
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
  insertPage(projectDb, page())
  addPageMarket(projectDb, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: NOW,
    baselineRunId: null
  })
  insertSnapshot(projectDb, snapshot())
  insertBuyerProfile(projectDb, profile())
  insertPromptSet(
    projectDb,
    {
      id: 'pset-1',
      pageId: 'page-1',
      version: 1,
      savedAt: NOW,
      icpId: 'icp-1',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [
        buyerPrompt('prompt-1', 'How do I alert the crew?', true),
        input.secondPrompt === true
          ? {
              ...buyerPrompt('prompt-2', 'How do I reach the night shift?', true),
              position: 2,
              label: 'Night'
            }
          : {
              ...buyerPrompt('prompt-2', 'disabled question should not be searched', false),
              position: 2
            }
      ]
    },
    ['TextBolt']
  )
  if (input.secondPage === true) {
    insertPage(projectDb, {
      ...page(),
      id: 'page-2',
      url: 'https://textbolt.com/blog/second-page/',
      title: 'Second',
      label: 'Second'
    })
    addPageMarket(projectDb, {
      pageId: 'page-2',
      marketId: 'mkt-us',
      addedAt: NOW,
      baselineRunId: null
    })
    insertSnapshot(projectDb, { ...snapshot(), id: 'snap-2', pageId: 'page-2' })
    insertBuyerProfile(projectDb, {
      ...profile(),
      id: 'icp-2',
      pageId: 'page-2',
      snapshotId: 'snap-2'
    })
    insertPromptSet(
      projectDb,
      {
        id: 'pset-2',
        pageId: 'page-2',
        version: 1,
        savedAt: NOW,
        icpId: 'icp-2',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [buyerPrompt('prompt-2b', 'How do I alert the second site?', true)]
      },
      ['TextBolt']
    )
  }
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
  const secrets = new MemorySecretStore()
  secrets.set('citefox.serpapi.key-1', SECRET)
  for (const [index, keyId] of (input.extraKeys ?? []).entries()) {
    insertApiKey(storage.db, {
      id: keyId,
      provider: 'serpapi',
      name: `Search ${index + 2}`,
      keychainRef: `citefox.serpapi.${keyId}`,
      hint: `k${index + 2}`.padEnd(4, '0'),
      rotationOrder: index + 2,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    secrets.set(`citefox.serpapi.${keyId}`, `${SECRET}-${keyId}`)
  }
  let clock = Date.parse(NOW)
  let sequence = 0
  const emit: IpcHandlerDeps['emit'] = (channel, payload) => {
    if (channel === 'checks:progress') {
      const event = payload as CheckProgress
      input.progress.push(event)
      // A "searching…" step names the question before its search; it ends with a `…`.
      input.events?.push(`progress:${event.phase}${event.state === 'running' ? '…' : ''}`)
    }
    if (channel === 'results:changed') {
      const event = payload as ResultsChanged
      input.changed?.push(event)
      input.events?.push(`results:${event.state}`)
    }
    if (channel === 'checks:finished') {
      const event = payload as CheckFinishedNotice
      input.finished?.push(event)
      input.events?.push('finished')
    }
  }
  const checkDeps: CheckEngineDeps = {
    storage,
    secrets,
    logger: createLogger({
      write: (_level, line) => {
        input.logLines?.push(line)
      }
    }),
    http: {
      async request(request) {
        return input.http(request)
      }
    },
    now: () => new Date(clock),
    createId: () => {
      sequence += 1
      clock += 1000
      return `id-${sequence}`
    },
    emitProgress: (event) => emit('checks:progress', event),
    emitFinished: (event) => emit('checks:finished', event),
    emitResultsChanged: (event) => emit('results:changed', event),
    ...(input.beforeRequest !== undefined ? { beforeRequest: input.beforeRequest } : {}),
    ...(input.sleep !== undefined ? { sleep: input.sleep } : {}),
    ...(input.claude !== undefined ? { claude: input.claude } : {}),
    ...(input.questionsAtOnce !== undefined ? { questionsAtOnce: input.questionsAtOnce } : {})
  }
  const checkEngine = createCheckEngine(checkDeps)
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '9.9.9' }),
    storage,
    secrets,
    logger: checkDeps.logger,
    http: checkDeps.http,
    claudeCommand: stubCommand(),
    claudeProbe: stubProbe(),
    emitCheckupProgress: () => undefined,
    emit,
    now: checkDeps.now,
    createId: checkDeps.createId,
    checkEngine
  } satisfies IpcHandlerDeps)
  expect(listPageMarkets(projectDb, 'page-1')).toHaveLength(1)
  return { handlers, projectDb, storage, checkEngine, checkDeps }
}

export function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

export function page(): PageSummary {
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

export function snapshot(): StoredSnapshot {
  const body = 'TextBolt page body'
  return {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: NOW,
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

export function profile(): BuyerProfile {
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
    createdAt: NOW,
    promptsStale: false
  }
}

export function buyerPrompt(id: string, text: string, enabled: boolean): BuyerPrompt {
  return {
    id,
    position: 1,
    label: 'Crew',
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled,
    variants: [{ marketId: 'mkt-us', language: 'en', text, originalText: null }]
  }
}

export function stubCommand(): CommandTransport {
  return {
    async run() {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
    }
  }
}

export function stubProbe(): BinaryProbe {
  return { exists: () => false, searchPath: () => null }
}

export function plantMixedRuns(projectDb: ReturnType<typeof createProjectDatabase>): void {
  const hash = snapshot().contentHash
  const finishedAt = '2026-10-19T16:00:00.000Z'
  insertStoredCheckJob(projectDb, {
    id: 'job-leak',
    startedAt: NOW,
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  const rows = [
    { id: 'run-finished', status: 'finished' as const, startedAt: '2026-10-19T15:00:00.000Z' },
    { id: 'run-cancelled', status: 'cancelled' as const, startedAt: '2026-10-19T15:10:00.000Z' },
    { id: 'run-error', status: 'error' as const, startedAt: '2026-10-19T15:20:00.000Z' }
  ]
  for (const row of rows) {
    insertStoredRun(projectDb, {
      id: row.id,
      jobId: 'job-leak',
      pageId: 'page-1',
      promptSetId: 'pset-1',
      snapshotId: 'snap-1',
      marketId: 'mkt-us',
      startedAt: row.startedAt,
      kind: 'manual',
      partial: false,
      samples: 1,
      contentHash: hash
    })
    finishStoredRun(projectDb, row.id, finishedAt, row.status)
    insertStoredSerpResult(projectDb, {
      id: `serp-${row.id}`,
      runId: row.id,
      promptId: 'prompt-1',
      sampleNo: 1,
      keyId: null,
      hasAio: false,
      neededFollowup: false,
      searches: 1,
      status: 'no_aio',
      named: null,
      citedUrl: null,
      position: null,
      aioText: null,
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: '{}',
      rawAioJson: null,
      references: [
        {
          id: `ref-${row.id}`,
          position: 1,
          url: 'https://textbolt.com/alerts',
          normalizedUrl: 'https://textbolt.com/alerts',
          domain: 'textbolt.com',
          title: 'Alerts',
          classification: 'target',
          untracked: false,
          sourceType: 'web'
        }
      ]
    })
  }
}

export function leaveNightShiftPending(
  projectDb: ReturnType<typeof createProjectDatabase>,
  storage: ReturnType<typeof openAppStorage>
): void {
  const hash = snapshot().contentHash
  insertStoredCheckJob(projectDb, {
    id: 'job-resume',
    startedAt: NOW,
    status: 'running',
    pageIds: ['page-1'],
    marketIds: null,
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(projectDb, {
    id: 'run-resume',
    jobId: 'job-resume',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt: NOW,
    kind: 'baseline',
    partial: false,
    samples: 1,
    contentHash: hash
  })
  insertStoredSerpResult(projectDb, {
    id: 'serp-resume',
    runId: 'run-resume',
    promptId: 'prompt-1',
    sampleNo: 1,
    keyId: 'key-1',
    hasAio: false,
    neededFollowup: false,
    searches: 1,
    status: 'no_aio',
    named: null,
    citedUrl: null,
    position: null,
    aioText: null,
    errorCode: null,
    message: null,
    nextStep: null,
    rawSearchJson: '{}',
    rawAioJson: null,
    references: []
  })
  for (const step of [
    ['search', 1, 'Loaded'],
    ['aio', 1, 'No AI Overview'],
    ['analysis', 0, 'Scored']
  ] as const) {
    insertStoredCheckStep(projectDb, {
      jobId: 'job-resume',
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptId: 'prompt-1',
      sampleNo: step[1],
      phase: step[0],
      promptPosition: 1,
      label: 'Crew',
      promptText: 'How do I alert the crew?',
      state: 'ok',
      detail: step[2],
      errorCode: null,
      error: null,
      retrySearches: 0,
      updatedAt: NOW
    })
  }
  addKeyUsage(storage.db, {
    id: 'usage-resume',
    keyId: 'key-1',
    projectId: 'proj-1',
    month: monthKey(Date.parse(NOW), timeZone()),
    searches: 1,
    calls: 1,
    tokens: 0
  })
}
