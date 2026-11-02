import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import type { ExportProgress, ExportRequest } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { createIpcHandlers, type IpcHandlerDeps } from '../handlers'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import type { HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import {
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  finishStoredRun
} from '../storage/check-records'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../storage/content-records'
import type { StoredSnapshot } from '../storage/content-records'
import { addPageMarket, insertPage } from '../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'

/**
 * A seeded TextBolt project (one page, one market, one prompt) with stored checks,
 * and real IPC handlers over it. Shared by the export IPC and auto-export tests.
 */

export const RAW_MARKER = 'raw-secret-marker'
const closers: Array<() => void> = []
const directories: string[] = []

/** Call from `afterEach`: closes seeded storage and removes temp folders. */
export function cleanupExportSeeds(): void {
  for (const close of closers.splice(0)) close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export function isExportProgress(channel: string, payload: unknown): payload is ExportProgress {
  return channel === 'exports:progress' && typeof payload === 'object' && payload !== null
}

export function run(id: string, startedAt: string, finishedAt: string): SeedRun {
  return { id, startedAt, finishedAt }
}

export function exportRequest(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    projectId: 'proj-1',
    scope: 'page',
    pageIds: ['page-1'],
    viewId: null,
    marketIds: ['mkt-us'],
    checks: 'latest',
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

export interface SeedRun {
  id: string
  startedAt: string
  finishedAt: string
}

export function seed(runs: readonly SeedRun[]): {
  handlers: ReturnType<typeof createIpcHandlers>
  progress: ExportProgress[]
  directory: string
  storage: AppStorage
} {
  const directory = tempDir()
  const storage = openAppStorage(directory)
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
  writeProjectProfile(projectDb, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
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
    addedAt: '2026-10-01T12:00:00.000Z',
    baselineRunId: null
  })
  const hash = contentHash('TextBolt page body')
  insertSnapshot(projectDb, snapshot(hash))
  insertBuyerProfile(projectDb, profile())
  insertPromptSet(projectDb, promptSet(), ['TextBolt'])
  if (runs.length > 0) {
    insertStoredCheckJob(projectDb, {
      id: 'job-1',
      startedAt: runs[0]?.startedAt ?? '2026-10-19T15:00:00.000Z',
      status: 'running',
      pageIds: ['page-1'],
      marketIds: ['mkt-us'],
      promptIds: ['prompt-1'],
      reason: 'manual',
      message: null,
      nextStep: null
    })
  }
  for (const item of runs) {
    insertStoredRun(projectDb, {
      id: item.id,
      jobId: 'job-1',
      pageId: 'page-1',
      promptSetId: 'pset-1',
      snapshotId: 'snap-1',
      marketId: 'mkt-us',
      startedAt: item.startedAt,
      kind: 'manual',
      partial: false,
      samples: 1,
      contentHash: hash
    })
    finishStoredRun(projectDb, item.id, item.finishedAt, 'finished')
    insertStoredSerpResult(projectDb, {
      id: `serp-${item.id}`,
      runId: item.id,
      promptId: 'prompt-1',
      sampleNo: 1,
      keyId: null,
      hasAio: true,
      neededFollowup: false,
      searches: 1,
      status: 'page_cited',
      named: true,
      citedUrl: 'https://textbolt.com/alerts',
      position: 1,
      aioText: 'Stored overview quote.',
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: `{"api_key":"${RAW_MARKER}"}`,
      rawAioJson: null,
      references: [
        {
          id: `ref-${item.id}`,
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
  closeProjectDatabase(projectDb)

  const registry = new SecretRegistry()
  const progress: ExportProgress[] = []
  let host: EngineHost | undefined
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets: new MemorySecretStore(registry),
    logger: createLogger({ write: () => undefined, secrets: () => registry.list() }),
    http: idleHttp(),
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: (channel, payload) => {
      if (isExportProgress(channel, payload)) progress.push(payload)
    },
    knownSecrets: () => registry.list(),
    now: () => new Date('2026-10-20T12:00:00.000Z'),
    createId: () => 'export-1',
    onHost: (opened) => {
      host = opened
    }
  } satisfies IpcHandlerDeps)
  closers.push(() => {
    host?.email.close()
    storage.close()
  })
  return { handlers, progress, directory, storage }
}

export function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-export-ipc-'))
  directories.push(directory)
  return directory
}

function idleHttp(): HttpTransport {
  return {
    async request() {
      throw new Error('no network')
    }
  }
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/alerts',
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

function snapshot(hash: string): StoredSnapshot {
  return {
    id: 'snap-1',
    pageId: 'page-1',
    fetchedAt: '2026-10-01T12:00:00.000Z',
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Alerts',
    metaDescription: 'Alert the crew.',
    h1: 'Alerts',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: 'TextBolt page body',
    wordCount: 3,
    contentHash: hash,
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
    createdAt: '2026-10-01T12:00:00.000Z',
    promptsStale: false
  }
}

function promptSet(): Parameters<typeof insertPromptSet>[1] {
  const prompt: BuyerPrompt = {
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
  return {
    id: 'pset-1',
    pageId: 'page-1',
    version: 1,
    savedAt: '2026-10-01T12:00:00.000Z',
    icpId: 'icp-1',
    templateId: 'tpl-buyer-prompts',
    templateName: 'CiteFox default',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    prompts: [prompt]
  }
}
