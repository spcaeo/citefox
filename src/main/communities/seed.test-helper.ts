/**
 * Test-only. A TextBolt project checked twice in 🇺🇸 US and 🇬🇧 UK through the
 * real IPC handlers, against recorded SerpApi bodies whose overviews cite
 * Reddit, YouTube (several URL forms of one video), LinkedIn, review sites and
 * forums. Shared by the Communities unit tests and the Playwright specs.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BuyerPrompt, Market, PageSummary } from '@shared/domain'
import type { IpcHandlerMap } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { createIpcHandlers, type IpcHandlerDeps } from '../handlers'
import { createLogger } from '../logging/logger'
import { contentHash } from '../pipeline/hash'
import type { ClaudeProvider } from '../providers/claude/claude-code'
import type { BinaryProbe } from '../providers/claude/binary'
import type { CommandTransport } from '../providers/command'
import type { HttpRequest, HttpResponse } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { insertBuyerProfile, insertPromptSet, insertSnapshot } from '../storage/content-records'
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

const ROOT = process.cwd()
const SERPAPI = join(ROOT, 'src/main/providers/fixtures/serpapi')
export const COMMUNITY_FIXTURES = join(ROOT, 'src/main/communities/fixtures')

export const COMMUNITY_SEED = {
  projectId: 'proj-1',
  pageId: 'page-1',
  us: 'mkt-us',
  uk: 'mkt-uk',
  checks: ['2026-10-05T12:00:00.000Z', '2026-10-19T12:00:00.000Z'],
  prompts: ['How do I alert the crew without a developer?', 'Which plan covers scheduled texts?'],
  ukPrompt: 'How do I alert the crew in the UK without a developer?',
  pageUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  youtubeKeyRef: 'citefox.youtube.seed-key',
  youtubeSecret: 'AIzaFAKE-youtube-fixture-key-0000000000',
  redditOpen:
    'https://reddit.com/r/sysadmin/comments/1abc23x/vtext_shutting_down_what_are_you_using',
  redditArchived:
    'https://reddit.com/r/smallbusiness/comments/1def45y/twilio_quote_was_crazy_alternatives'
} as const

const US: Market = {
  id: COMMUNITY_SEED.us,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: COMMUNITY_SEED.uk, country: 'UK' }

export function readFixture(name: string): { status: number; body: unknown } {
  return JSON.parse(readFileSync(join(COMMUNITY_FIXTURES, name), 'utf8')) as {
    status: number
    body: unknown
  }
}

export function fixtureResponse(name: string): HttpResponse {
  const file = readFixture(name)
  return { status: file.status, body: JSON.stringify(file.body) }
}

/** The Claude reply recorded for the seed page's video brief. */
export function recordedBrief(): unknown {
  const file = JSON.parse(readFileSync(join(COMMUNITY_FIXTURES, 'video-brief.json'), 'utf8')) as {
    structured_output: unknown
  }
  return file.structured_output
}

export interface SeedOptions {
  /** Store a YouTube Data API key (metadata in app.sqlite, secret in `secrets`). */
  youtubeKey?: boolean
  /** Extra HTTP answers after seeding: Reddit, YouTube. Unmatched requests fail. */
  http?: (request: HttpRequest) => HttpResponse | null
  claude?: ClaudeProvider
  /** Video details as if fetched with a key, so screens show views without a network call. */
  cacheVideoDetails?: boolean
}

export interface SeededHarness {
  storage: AppStorage
  secrets: MemorySecretStore
  handlers: IpcHandlerMap
  requests: HttpRequest[]
  clock: { now: number }
  close: () => void
}

/**
 * Seeds the project in `userDataDir` and returns the open handlers.
 * Call `close` when done (the e2e seed closes at once and relaunches the app).
 */
export async function seedCommunitiesProject(
  userDataDir: string,
  options: SeedOptions = {}
): Promise<SeededHarness> {
  const storage = openAppStorage(userDataDir)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  let host: EngineHost | undefined
  const secrets = new MemorySecretStore()
  const requests: HttpRequest[] = []
  const clock = { now: Date.parse(COMMUNITY_SEED.checks[0]) }
  let checkNo = 1
  let sequence = 0
  try {
    writeSeedProject(storage, projectDb)
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'My plan',
      keychainRef: 'citefox.serpapi.seed-key-1',
      hint: 'ab12',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' }
    })
    secrets.set('citefox.serpapi.seed-key-1', 'fixture-serpapi-secret-communities')
    if (options.youtubeKey === true) {
      insertApiKey(storage.db, {
        id: 'key-yt',
        provider: 'youtube',
        name: 'YouTube',
        keychainRef: COMMUNITY_SEED.youtubeKeyRef,
        hint: '0000',
        rotationOrder: 1,
        cap: null,
        on: true,
        projectIds: [],
        state: 'ok',
        lastReason: null,
        serpapiUsage: null
      })
      secrets.set(COMMUNITY_SEED.youtubeKeyRef, COMMUNITY_SEED.youtubeSecret)
    }
  } finally {
    closeProjectDatabase(projectDb)
  }
  const bodies = (
    JSON.parse(readFileSync(join(COMMUNITY_FIXTURES, 'serpapi-communities.json'), 'utf8')) as {
      bodies: Record<string, unknown>
    }
  ).bodies
  const deps: IpcHandlerDeps = {
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger: createLogger({ write: () => undefined, secrets: () => [] }),
    http: {
      async request(request) {
        requests.push(request)
        const url = new URL(request.url)
        if (url.hostname === 'serpapi.com') {
          const engine = url.searchParams.get('engine')
          if (engine === 'google') {
            const gl = (url.searchParams.get('gl') ?? '').toLowerCase()
            const market = gl === 'uk' || gl === 'gb' ? 'uk' : 'us'
            const query = url.searchParams.get('q') ?? ''
            const index = query === COMMUNITY_SEED.prompts[1] ? 1 : 0
            return tokenEnvelope(`${checkNo}|${market}|${index}`)
          }
          const token = url.searchParams.get('page_token') ?? ''
          const body = bodies[token]
          return body === undefined
            ? { status: 500, body: '{"error":"no fixture"}' }
            : { status: 200, body: JSON.stringify(body) }
        }
        const answer = options.http?.(request) ?? null
        if (answer !== null) return answer
        return { status: 599, body: '{"error":"no fixture for this request"}' }
      }
    },
    claudeCommand: stubCommand(),
    claudeProbe: { exists: () => false, searchPath: () => null } satisfies BinaryProbe,
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => [COMMUNITY_SEED.youtubeSecret],
    now: () => new Date(clock.now),
    createId: () => {
      sequence += 1
      clock.now += 1000
      return `seed-${sequence}`
    },
    onHost: (opened) => {
      host = opened
    },
    communities: { sleep: async () => undefined, redditIntervalMs: 0 },
    ...(options.claude !== undefined ? { claude: options.claude } : {})
  }
  const handlers = createIpcHandlers(deps)
  for (const [index, at] of COMMUNITY_SEED.checks.entries()) {
    checkNo = index + 1
    clock.now = Date.parse(at)
    const job = await handlers['checks:start']({
      projectId: COMMUNITY_SEED.projectId,
      pageIds: [COMMUNITY_SEED.pageId],
      marketIds: null,
      promptIds: null
    })
    if (job.status !== 'finished') throw new Error(job.message ?? `Seed check ${job.status}`)
  }
  clock.now = Date.parse('2026-10-20T09:00:00.000Z')
  writeOnboardingFinished(storage.db, true)
  writeActiveProjectId(storage.db, COMMUNITY_SEED.projectId)
  if (options.cacheVideoDetails === true) writeCachedVideoDetails(storage)
  return {
    storage,
    secrets,
    handlers,
    requests,
    clock,
    close: () => {
      host?.email.close()
      storage.close()
    }
  }
}

function writeCachedVideoDetails(storage: AppStorage): void {
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    const items = (readFixture('youtube-videos.json').body as { items: unknown[] }).items
    for (const raw of items) {
      const item = raw as {
        id: string
        snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string }
        statistics: { viewCount: string }
      }
      db.prepare(
        `INSERT OR REPLACE INTO youtube_videos (video_id, title, channel_id, channel_title, views,
           published_at, duration_seconds, fetched_at, missing)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0)`
      ).run(
        item.id,
        item.snippet.title,
        item.snippet.channelId,
        item.snippet.channelTitle,
        Number(item.statistics.viewCount),
        item.snippet.publishedAt,
        '2026-10-19T13:00:00.000Z'
      )
    }
  } finally {
    closeProjectDatabase(db)
  }
}

function writeSeedProject(
  storage: AppStorage,
  projectDb: ReturnType<typeof createProjectDatabase>
): void {
  insertProject(storage.db, {
    id: COMMUNITY_SEED.projectId,
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
  insertPage(projectDb, seedPage())
  for (const marketId of [COMMUNITY_SEED.us, COMMUNITY_SEED.uk]) {
    addPageMarket(projectDb, {
      pageId: COMMUNITY_SEED.pageId,
      marketId,
      addedAt: COMMUNITY_SEED.checks[0],
      baselineRunId: null
    })
  }
  const body =
    'TextBolt sends text alerts from email. No developer required. Replies come back to the inbox that sent them.'
  insertSnapshot(projectDb, {
    id: 'snap-1',
    pageId: COMMUNITY_SEED.pageId,
    fetchedAt: COMMUNITY_SEED.checks[0],
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: 'Text alerts for business',
    metaDescription: null,
    h1: 'Text alerts for business',
    canonical: null,
    publishedAt: null,
    modifiedAt: null,
    outline: [{ level: 'h2', text: 'Send alerts from email', table: false }],
    faqs: [],
    h2Count: 1,
    h3Count: 0,
    tableCount: 0,
    bodyText: body,
    wordCount: 18,
    contentHash: contentHash(body),
    summary: null
  })
  insertBuyerProfile(projectDb, {
    id: 'icp-1',
    pageId: COMMUNITY_SEED.pageId,
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
    createdAt: COMMUNITY_SEED.checks[0],
    promptsStale: false
  })
  insertPromptSet(
    projectDb,
    {
      id: 'pset-1',
      pageId: COMMUNITY_SEED.pageId,
      version: 1,
      savedAt: COMMUNITY_SEED.checks[0],
      icpId: 'icp-1',
      templateId: 'tpl-buyer-prompts',
      templateName: 'CiteFox default',
      templateHash: contentHash('template'),
      templateUpdatedAt: null,
      prompts: [
        prompt('prompt-1', 1, 'Crew alerts', COMMUNITY_SEED.prompts[0], COMMUNITY_SEED.ukPrompt),
        prompt(
          'prompt-2',
          2,
          'Scheduled plan',
          COMMUNITY_SEED.prompts[1],
          COMMUNITY_SEED.prompts[1]
        )
      ]
    },
    ['TextBolt']
  )
}

function tokenEnvelope(token: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(SERPAPI, 'google-page-token.json'), 'utf8')) as {
    status: number
    body: { ai_overview: { page_token: string } }
  }
  parsed.body.ai_overview.page_token = token
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function seedPage(): PageSummary {
  return {
    id: COMMUNITY_SEED.pageId,
    projectId: COMMUNITY_SEED.projectId,
    url: COMMUNITY_SEED.pageUrl,
    title: 'Text alerts for business',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 2,
    defaultMarketId: COMMUNITY_SEED.us,
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}

function prompt(
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
      { marketId: COMMUNITY_SEED.us, language: 'en', text: usText, originalText: null },
      { marketId: COMMUNITY_SEED.uk, language: 'en', text: ukText, originalText: null }
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
