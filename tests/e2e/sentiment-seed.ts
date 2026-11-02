import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerPrompt, Market, PageSummary } from '@shared/domain'
import { createIpcHandlers, type IpcHandlerDeps } from '../../src/main/handlers'
import type { EngineHost } from '../../src/main/engine/host'
import { sentimentReply, serpBody } from '../../src/main/engine/sentiment/fixture-replies'
import { readRunSentiment } from '../../src/main/engine/sentiment/read'
import { createLogger } from '../../src/main/logging/logger'
import { contentHash } from '../../src/main/pipeline/hash'
import type { ClaudeProvider } from '../../src/main/providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../../src/main/providers/claude/parse'
import type { HttpResponse } from '../../src/main/providers/http'
import { MemorySecretStore } from '../../src/main/secrets/secret-store'
import { openAppStorage } from '../../src/main/storage/app-storage'
import { insertBrandPromptSet } from '../../src/main/storage/brand-records'
import { listStoredRunsForJob } from '../../src/main/storage/check-records'
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

const SERP = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
/** Three full checks, two weeks apart, like the mock-up's trend. */
const CHECKS = ['2026-09-21T12:00:00.000Z', '2026-10-05T12:00:00.000Z', '2026-10-19T12:00:00.000Z']

export const SENTIMENT_SEED = {
  projectId: 'proj-1',
  pageId: 'page-1',
  us: 'mkt-us',
  uk: 'mkt-uk',
  brandPrompts: ['TextBolt reviews', 'TextBolt pricing', 'TextBolt alternatives']
} as const

const US: Market = {
  id: SENTIMENT_SEED.us,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: SENTIMENT_SEED.uk, country: 'UK' }

/**
 * The TextBolt page tracked in US · EN and UK · EN with three brand prompts,
 * checked three times through the real IPC handlers against recorded SerpApi
 * bodies. After each check the overviews are read with the recorded Claude
 * replies, exactly as the report step would. The first check's pricing prompt
 * had no overview, so the trend moves.
 */
export async function seedSentimentProject(userDataDir: string): Promise<void> {
  const storage = openAppStorage(userDataDir)
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let host: EngineHost | undefined
  try {
    insertProject(storage.db, {
      id: SENTIMENT_SEED.projectId,
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
      competitors: ['SimpleTexting', 'Twilio'],
      market: US
    })
    insertMarket(db, UK)
    insertPage(db, page())
    for (const marketId of [SENTIMENT_SEED.us, SENTIMENT_SEED.uk]) {
      addPageMarket(db, {
        pageId: SENTIMENT_SEED.pageId,
        marketId,
        addedAt: CHECKS[0] ?? '',
        baselineRunId: null
      })
    }
    const body =
      'TextBolt sends text alerts from email. Plans start at $29 a month. No developer required.'
    insertSnapshot(db, {
      id: 'snap-1',
      pageId: SENTIMENT_SEED.pageId,
      fetchedAt: CHECKS[0] ?? '',
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
      wordCount: 15,
      contentHash: contentHash(body),
      summary: null
    })
    insertBuyerProfile(db, {
      id: 'icp-1',
      pageId: SENTIMENT_SEED.pageId,
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
      createdAt: CHECKS[0] ?? '',
      promptsStale: false
    })
    insertPromptSet(
      db,
      {
        id: 'pset-1',
        pageId: SENTIMENT_SEED.pageId,
        version: 1,
        savedAt: CHECKS[0] ?? '',
        icpId: 'icp-1',
        templateId: 'tpl-buyer-prompts',
        templateName: 'CiteFox default',
        templateHash: contentHash('template'),
        templateUpdatedAt: null,
        prompts: [
          buyerPrompt('prompt-1', 1, 'Crew alerts', 'How do I alert the crew without a developer?'),
          buyerPrompt('prompt-2', 2, 'Scheduled plan', 'Which plan covers scheduled texts?')
        ]
      },
      ['TextBolt']
    )
    insertBrandPromptSet(db, {
      pageId: SENTIMENT_SEED.pageId,
      savedAt: CHECKS[0] ?? '',
      templateId: null,
      templateHash: null,
      prompts: [
        { id: 'bp-review', kind: 'review', language: 'en', text: 'TextBolt reviews' },
        { id: 'bp-pricing', kind: 'pricing', language: 'en', text: 'TextBolt pricing' },
        { id: 'bp-alt', kind: 'alternatives', language: 'en', text: 'TextBolt alternatives' }
      ]
    })
    const secret = 'fixture-serpapi-secret-sentiment'
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'My plan',
      keychainRef: 'citefox.serpapi.sentiment-key-1',
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
    secrets.set('citefox.serpapi.sentiment-key-1', secret)
    let clock = Date.parse(CHECKS[0] ?? '')
    let check = 0
    let sequence = 0
    const logger = createLogger({ write: () => undefined, secrets: () => [secret] })
    const createId = (): string => {
      sequence += 1
      clock += 1000
      return `seed-${sequence}`
    }
    const handlers = createIpcHandlers({
      appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
      storage,
      secrets,
      logger,
      http: {
        async request(request) {
          const q = new URL(request.url).searchParams.get('q') ?? ''
          return searchBody(q, check)
        }
      },
      claudeCommand: {
        async run() {
          return { exitCode: 0, stdout: '', stderr: '', timedOut: false, spawnError: null }
        }
      },
      claudeProbe: { exists: () => false, searchPath: () => null },
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => [secret],
      now: () => new Date(clock),
      createId,
      onHost: (opened) => {
        host = opened
      }
    } satisfies IpcHandlerDeps)
    for (const [index, at] of CHECKS.entries()) {
      check = index
      clock = Date.parse(at)
      const job = await handlers['checks:start']({
        projectId: SENTIMENT_SEED.projectId,
        pageIds: [SENTIMENT_SEED.pageId],
        marketIds: null,
        promptIds: null
      })
      if (job.status !== 'finished')
        throw new Error(job.message ?? `Seed check ended as ${job.status}`)
      for (const run of listStoredRunsForJob(db, SENTIMENT_SEED.projectId, job.id)) {
        await readRunSentiment(
          {
            db,
            appDb: storage.db,
            claude: recordedClaude(),
            logger,
            now: () => new Date(clock).toISOString(),
            createId
          },
          { projectId: SENTIMENT_SEED.projectId, runId: run.id }
        )
      }
    }
    writeOnboardingFinished(storage.db, true)
    writeActiveProjectId(storage.db, SENTIMENT_SEED.projectId)
  } finally {
    host?.email.close()
    closeProjectDatabase(db)
    storage.close()
  }
}

/** Brand questions get the recorded brand overviews; buyer prompts the shared fixtures. */
function searchBody(q: string, check: number): HttpResponse {
  if (q === 'TextBolt reviews') return serpBody('serp-brand-reviews.json')
  if (q === 'TextBolt pricing' && check > 0) return serpBody('serp-brand-pricing.json')
  if (q.includes('TextBolt')) return serpEnvelope('google-no-aio.json')
  if (q.startsWith('Which plan')) return serpEnvelope('google-own-page.json')
  return serpEnvelope('google-ai-overview.json')
}

function serpEnvelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(SERP, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

/** Same id as the live Claude Code connection, so an unchanged re-read reuses these readings. */
function recordedClaude(): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request) {
      const json = sentimentReply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 3,
        outputTokens: 2,
        durationMs: 1,
        model: 'fixture',
        resolvedModel: 'fixture',
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

function page(): PageSummary {
  return {
    id: SENTIMENT_SEED.pageId,
    projectId: SENTIMENT_SEED.projectId,
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: 'Text alerts for business',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 2,
    defaultMarketId: SENTIMENT_SEED.us,
    pinned: false,
    score: null,
    promptSetVersion: null
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
      { marketId: SENTIMENT_SEED.us, language: 'en', text, originalText: null },
      { marketId: SENTIMENT_SEED.uk, language: 'en', text, originalText: null }
    ]
  }
}
