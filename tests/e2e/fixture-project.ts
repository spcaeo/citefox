import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import { createIpcHandlers, type IpcHandlerDeps } from '../../src/main/handlers'
import type { EngineHost } from '../../src/main/engine/host'
import { contentHash } from '../../src/main/pipeline/hash'
import type { CommandTransport } from '../../src/main/providers/command'
import type { BinaryProbe } from '../../src/main/providers/claude/binary'
import type { HttpResponse } from '../../src/main/providers/http'
import { MemorySecretStore } from '../../src/main/secrets/secret-store'
import { createLogger } from '../../src/main/logging/logger'
import { openAppStorage } from '../../src/main/storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type StoredSnapshot
} from '../../src/main/storage/content-records'
import { addPageMarket, insertPage } from '../../src/main/storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../src/main/storage/project-files'
import { writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  deleteApiKey,
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const NOW = '2026-10-19T12:00:00.000Z'
const PROJECT_ID = 'proj-1'

/**
 * Opens a user-data directory, runs one TextBolt check against the recorded
 * SerpApi fixtures, then closes every database so the production shell can
 * open the same files. No renderer mock and no sample catalog.
 */
export async function seedFixtureProject(userDataDir: string): Promise<void> {
  const storage = openAppStorage(userDataDir)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let host: EngineHost | undefined
  try {
    insertProject(storage.db, {
      id: PROJECT_ID,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
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
          {
            ...buyerPrompt('prompt-2', 'disabled question should not be searched', false),
            position: 2
          }
        ]
      },
      ['TextBolt']
    )
    const secret = randomBytes(24).toString('hex')
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
    secrets.set('citefox.serpapi.key-1', secret)
    let clock = Date.parse(NOW)
    let sequence = 0
    const handlers = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
      storage,
      secrets,
      logger: createLogger({ write: () => undefined, secrets: () => [secret] }),
      http: {
        async request(request) {
          const engine = new URL(request.url).searchParams.get('engine')
          return envelope(
            engine === 'google_ai_overview' ? 'google-ai-overview.json' : 'google-page-token.json'
          )
        }
      },
      claudeCommand: stubCommand(),
      claudeProbe: stubProbe(),
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => [secret],
      now: () => new Date(clock),
      createId: () => {
        sequence += 1
        clock += 1000
        return `id-${sequence}`
      },
      onHost: (opened) => {
        host = opened
      }
    } satisfies IpcHandlerDeps)
    const job = await handlers['checks:start']({
      projectId: PROJECT_ID,
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    if (job.status !== 'finished') {
      throw new Error(job.message ?? `Fixture check ended as ${job.status}`)
    }
    deleteApiKey(storage.db, 'key-1')
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, PROJECT_ID)
  } finally {
    host?.email.close()
    closeProjectDatabase(projectDb)
    storage.close()
  }
}

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: PROJECT_ID,
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
    createdAt: NOW,
    promptsStale: false
  }
}

function buyerPrompt(id: string, text: string, enabled: boolean): BuyerPrompt {
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

function stubCommand(): CommandTransport {
  return {
    async run() {
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
    }
  }
}

function stubProbe(): BinaryProbe {
  return { exists: () => false, searchPath: () => null }
}
