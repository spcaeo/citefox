import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, PageSummary } from '@shared/domain'
import { createCheckEngine, type CheckEngineDeps } from '../../src/main/engine/checks/engine'
import { createLogger } from '../../src/main/logging/logger'
import { contentHash, wordCount } from '../../src/main/pipeline/hash'
import {
  TEXTBOLT_H1,
  TEXTBOLT_META,
  TEXTBOLT_PROFILE,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_PUBLISHED_UTC,
  TEXTBOLT_TITLE,
  TEXTBOLT_URL,
  textboltJinaBody
} from '../../src/main/pipeline/textbolt-fixture'
import type { HttpResponse } from '../../src/main/providers/http'
import { MemorySecretStore } from '../../src/main/secrets/secret-store'
import { openAppStorage, type AppStorage } from '../../src/main/storage/app-storage'
import {
  insertBuyerProfile,
  insertPromptSet,
  insertSnapshot,
  type StoredSnapshot
} from '../../src/main/storage/content-records'
import { addPageMarket, insertPage } from '../../src/main/storage/pages'
import type { SqliteDatabase } from '../../src/main/storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../../src/main/storage/project-files'
import { writeProjectProfile } from '../../src/main/storage/project-profile'
import {
  insertApiKey,
  insertProject,
  writeActiveProjectId,
  writeOnboardingFinished
} from '../../src/main/storage/records'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const NOW = '2026-10-19T15:00:00.000Z'
const SECRET = 'fixture-serpapi-key'
const PROJECT_ID = 'proj-textbolt'
const PAGE_ID = 'page-alerts'
const MARKET_ID = 'mkt-us'

/**
 * Recorded SerpApi bodies, one per TextBolt prompt, in prompt order.
 * The Google search itself replays the page-token fixture with a token of its
 * own, then the follow-up replays the body for that token's prompt. A check runs
 * a few questions at once, so the follow-up is matched by token, never by the
 * last search seen. No socket is opened.
 */
const AIO_FIXTURES = [
  'google-ai-overview.json',
  'google-own-page.json',
  'google-brand-named.json',
  'google-competitor.json',
  'google-no-aio.json'
] as const

export interface LoadedCheck {
  userDataDir: string
  projectId: string
  pageId: string
  marketId: string
}

/** Runs one check against the recorded TextBolt page and SerpApi fixtures. */
export async function loadTextboltCheck(): Promise<LoadedCheck> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'citefox-nfr14-'))
  let storage: AppStorage | undefined
  let projectDb: SqliteDatabase | undefined
  try {
    storage = openAppStorage(userDataDir)
    insertProject(storage.db, {
      id: PROJECT_ID,
      name: 'TextBolt',
      slug: 'textbolt',
      domain: 'textbolt.com',
      dbPath: projectDatabaseRelativePath('textbolt'),
      clientName: null,
      status: 'active'
    })
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, PROJECT_ID)
    projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    writeProjectProfile(projectDb, {
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: ['simpletexting.com', 'twilio.com'],
      market: {
        id: MARKET_ID,
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
      pageId: PAGE_ID,
      marketId: MARKET_ID,
      addedAt: NOW,
      baselineRunId: null
    })
    insertSnapshot(projectDb, snapshot())
    insertBuyerProfile(projectDb, profile())
    const prompts = buyerPrompts()
    insertPromptSet(
      projectDb,
      {
        id: 'pset-1',
        pageId: PAGE_ID,
        version: 1,
        savedAt: NOW,
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts
      },
      ['TextBolt']
    )
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Search',
      keychainRef: 'citefox.serpapi.key-1',
      hint: 'fix1',
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
    const fixtureFor = new Map(
      prompts.map((prompt, index) => [
        prompt.variants[0]?.text ?? '',
        AIO_FIXTURES[index % AIO_FIXTURES.length] ?? 'google-no-aio.json'
      ])
    )
    let clock = Date.parse(NOW)
    let sequence = 0
    const deps: CheckEngineDeps = {
      storage,
      secrets,
      logger: createLogger({ write: () => undefined, secrets: () => [SECRET] }),
      http: {
        async request(request): Promise<HttpResponse> {
          const url = new URL(request.url)
          const engine = url.searchParams.get('engine')
          if (engine === 'google') {
            // No overview comes back without a page token. An empty follow-up is an error (FR-5.5).
            const query = url.searchParams.get('q') ?? ''
            const body = fixtureFor.get(query) ?? 'google-no-aio.json'
            return body === 'google-no-aio.json' ? envelope(body) : tokenEnvelope(query)
          }
          if (engine === 'google_ai_overview') {
            return envelope(
              fixtureFor.get(url.searchParams.get('page_token') ?? '') ?? 'google-no-aio.json'
            )
          }
          throw new Error(`Unexpected fixture request for engine ${engine ?? 'none'}`)
        }
      },
      now: () => new Date(clock),
      createId: () => {
        sequence += 1
        clock += 1000
        return `nfr14-${sequence}`
      },
      emitProgress: () => undefined,
      emitFinished: () => undefined,
      knownSecrets: () => [SECRET]
    }
    const engine = createCheckEngine(deps)
    const job = await engine.start({
      projectId: PROJECT_ID,
      pageIds: [PAGE_ID],
      marketIds: null,
      promptIds: null,
      reason: 'manual'
    })
    if (job.status !== 'finished') {
      throw new Error(job.message ?? `Check finished as ${job.status}`)
    }
    closeProjectDatabase(projectDb)
    projectDb = undefined
    storage.close()
    storage = undefined
    return { userDataDir, projectId: PROJECT_ID, pageId: PAGE_ID, marketId: MARKET_ID }
  } catch (error) {
    if (projectDb) closeProjectDatabase(projectDb)
    storage?.close()
    await rm(userDataDir, { recursive: true, force: true })
    throw error
  }
}

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

/** The page-token search body, carrying the prompt text as its token. */
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
    id: PAGE_ID,
    projectId: PROJECT_ID,
    url: TEXTBOLT_URL,
    title: TEXTBOLT_TITLE,
    label: 'Text alerts for business',
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: TEXTBOLT_PROMPTS_EN.prompts.length,
    defaultMarketId: MARKET_ID,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function snapshot(): StoredSnapshot {
  const parsed = JSON.parse(textboltJinaBody()) as { data?: { content?: string } }
  const body = parsed.data?.content ?? ''
  if (!body.includes(TEXTBOLT_H1)) throw new Error('TextBolt Jina fixture has no page body')
  return {
    id: 'snap-1',
    pageId: PAGE_ID,
    fetchedAt: NOW,
    method: 'jina' as const,
    httpStatus: 200,
    durationMs: 4,
    title: TEXTBOLT_TITLE,
    metaDescription: TEXTBOLT_META,
    h1: TEXTBOLT_H1,
    canonical: TEXTBOLT_URL,
    publishedAt: TEXTBOLT_PUBLISHED_UTC,
    modifiedAt: null,
    outline: [],
    faqs: [],
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: wordCount(body),
    contentHash: contentHash(body),
    summary: null
  }
}

function profile(): BuyerProfile {
  return {
    ...TEXTBOLT_PROFILE,
    id: 'icp-1',
    pageId: PAGE_ID,
    snapshotId: 'snap-1',
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: NOW,
    promptsStale: false
  }
}

function buyerPrompts(): BuyerPrompt[] {
  return TEXTBOLT_PROMPTS_EN.prompts.map((draft, index) => ({
    id: `prompt-${index + 1}`,
    position: index + 1,
    label: draft.label,
    source: draft.source,
    intentStage: draft.intentStage,
    mappedElement: draft.mappedElement,
    enabled: true,
    variants: [{ marketId: MARKET_ID, language: 'en', text: draft.text, originalText: null }]
  }))
}
