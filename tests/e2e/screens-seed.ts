import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, Market, PageSummary } from '@shared/domain'
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
  insertSnapshot
} from '../../src/main/storage/content-records'
import { addPageMarket, insertPage } from '../../src/main/storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../src/main/storage/project-files'
import { insertMarket, writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
export const START = '2026-10-05T12:00:00.000Z'
export const SECOND = '2026-10-19T12:00:00.000Z'
export const SEED = {
  projectId: 'proj-1',
  pageId: 'page-1',
  us: 'mkt-us',
  uk: 'mkt-uk',
  prompts: ['How do I alert the crew without a developer?', 'Which plan covers scheduled texts?'],
  ukPrompt: 'How do I alert the crew in the UK without a developer?'
} as const

const US: Market = {
  id: SEED.us,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: SEED.uk, country: 'UK' }

/** Recorded follow-up body per market and prompt. US prompt 1 cites the page at position 2. */
const BODIES: Readonly<Record<string, string>> = {
  [`us|${SEED.prompts[0]}`]: 'google-ai-overview.json',
  [`us|${SEED.prompts[1]}`]: 'google-own-page.json',
  [`uk|${SEED.ukPrompt}`]: 'google-competitor.json',
  [`uk|${SEED.prompts[1]}`]: 'google-own-page.json'
}

/**
 * One TextBolt page tracked in 🇺🇸 US · EN and 🇬🇧 UK · EN, checked twice
 * against recorded SerpApi bodies through the real IPC handlers. The SerpApi
 * key stays (metadata only) so Status has a key to show; its secret lives
 * only in this seeding run's memory store.
 */
export async function seedTwoMarketProject(
  userDataDir: string,
  options: {
    /** When the seeded checks run. Default: two checks in October 2026. */
    checksAt?: readonly string[]
  } = {}
): Promise<void> {
  const storage = openAppStorage(userDataDir)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let host: EngineHost | undefined
  try {
    insertProject(storage.db, {
      id: SEED.projectId,
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
      competitors: ['simpletexting.com', 'twilio.com'],
      market: US
    })
    insertMarket(projectDb, UK)
    insertPage(projectDb, page())
    for (const marketId of [SEED.us, SEED.uk]) {
      addPageMarket(projectDb, {
        pageId: SEED.pageId,
        marketId,
        addedAt: START,
        baselineRunId: null
      })
    }
    const body = 'TextBolt sends text alerts from email. No developer required.'
    insertSnapshot(projectDb, {
      id: 'snap-1',
      pageId: SEED.pageId,
      fetchedAt: START,
      method: 'jina',
      httpStatus: 200,
      durationMs: 4,
      title: 'Text alerts for business',
      metaDescription: null,
      h1: 'Text alerts for business',
      canonical: null,
      publishedAt: null,
      modifiedAt: null,
      outline: [],
      faqs: [],
      h2Count: 0,
      h3Count: 0,
      tableCount: 0,
      bodyText: body,
      wordCount: 10,
      contentHash: contentHash(body),
      summary: null
    })
    insertBuyerProfile(projectDb, profile())
    insertPromptSet(
      projectDb,
      {
        id: 'pset-1',
        pageId: SEED.pageId,
        version: 1,
        savedAt: START,
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [
          buyerPrompt('prompt-1', 1, 'Crew alerts', SEED.prompts[0], SEED.ukPrompt),
          buyerPrompt('prompt-2', 2, 'Scheduled plan', SEED.prompts[1], SEED.prompts[1])
        ]
      },
      ['TextBolt']
    )
    const secret = 'fixture-serpapi-secret-screens'
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'My plan',
      keychainRef: 'citefox.serpapi.screens-key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' }
    })
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.screens-key-1', secret)
    let clock = Date.parse(START)
    let sequence = 0
    const handlers = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
      storage,
      secrets,
      logger: createLogger({ write: () => undefined, secrets: () => [secret] }),
      http: {
        async request(request) {
          const url = new URL(request.url)
          const engine = url.searchParams.get('engine')
          if (engine === 'google') {
            const gl = (url.searchParams.get('gl') ?? '').toLowerCase()
            const market = gl === 'uk' || gl === 'gb' ? 'uk' : 'us'
            return tokenEnvelope(`${market}|${url.searchParams.get('q') ?? ''}`)
          }
          const token = url.searchParams.get('page_token') ?? ''
          return envelope(BODIES[token] ?? 'google-competitor.json')
        }
      },
      claudeCommand: stubCommand(),
      claudeProbe: { exists: () => false, searchPath: () => null } satisfies BinaryProbe,
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => [secret],
      now: () => new Date(clock),
      createId: () => {
        sequence += 1
        clock += 1000
        return `seed-${sequence}`
      },
      onHost: (opened) => {
        host = opened
      }
    } satisfies IpcHandlerDeps)
    for (const at of options.checksAt ?? [START, SECOND]) {
      clock = Date.parse(at)
      const job = await handlers['checks:start']({
        projectId: SEED.projectId,
        pageIds: [SEED.pageId],
        marketIds: null,
        promptIds: null
      })
      if (job.status !== 'finished') {
        throw new Error(job.message ?? `Seed check ended as ${job.status}`)
      }
    }
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, SEED.projectId)
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

/**
 * The recorded page-token body, with a token that names the market and query. It
 * also holds Google's organic results and "People also ask" (the page ranks #3).
 */
function tokenEnvelope(token: string): HttpResponse {
  const parsed = JSON.parse(
    readFileSync(join(FIXTURES, 'google-page-token-extras.json'), 'utf8')
  ) as {
    status: number
    body: { ai_overview: { page_token: string } }
  }
  parsed.body.ai_overview.page_token = token
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function page(): PageSummary {
  return {
    id: SEED.pageId,
    projectId: SEED.projectId,
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: 'Text alerts for business',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 2,
    defaultMarketId: SEED.us,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function profile(): BuyerProfile {
  return {
    id: 'icp-1',
    pageId: SEED.pageId,
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
    createdAt: START,
    promptsStale: false
  }
}

function buyerPrompt(
  id: string,
  position: number,
  label: string,
  usText: string,
  ukText: string
): BuyerPrompt {
  return {
    id,
    position,
    label,
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [
      { marketId: SEED.us, language: 'en', text: usText, originalText: null },
      { marketId: SEED.uk, language: 'en', text: ukText, originalText: null }
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
