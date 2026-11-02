/** Seeded TextBolt project and a scripted Claude for the assist tests. Test-only. */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuyerProfile, BuyerPrompt, Market, PageSummary } from '@shared/domain'
import type { CoverageRecord } from '@shared/domain'
import type { AssistRunRequest } from '@shared/ipc'
import type { EngineHost } from '../engine/host'
import { createIpcHandlers, type IpcHandlerDeps } from '../handlers'
import { createLogger } from '../logging/logger'
import { contentHash, wordCount } from '../pipeline/hash'
import type { BinaryProbe } from '../providers/claude/binary'
import type {
  ClaudeCompletion,
  ClaudeCompletionRequest,
  ClaudeProvider
} from '../providers/claude/claude-code'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { CommandTransport } from '../providers/command'
import type { HttpResponse } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import {
  insertBuyerProfile,
  insertCoverage,
  insertGeneration,
  insertPromptSet,
  insertSnapshot
} from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { createFixFollowUp } from '../storage/fix-follow-ups'
import { insertLlmCall } from '../storage/llm-calls'
import { addPageMarket, insertPage } from '../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { insertMarket, writeProjectProfile } from '../storage/project-profile'
import { insertApiKey, insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'

export const FIXTURE_DIR = join(process.cwd(), 'src/main/assist/fixtures')
const SERP = join(process.cwd(), 'src/main/providers/fixtures/serpapi')
const FIRST = '2026-10-05T12:00:00.000Z'
const SECOND = '2026-10-19T12:00:00.000Z'
export const NOW = '2026-10-20T12:00:00.000Z'
export const SERP_SECRET = 'fixture-serpapi-secret-assists'

export const SEED = {
  projectId: 'proj-1',
  pageId: 'page-1',
  us: 'mkt-us',
  uk: 'mkt-uk',
  prompts: [
    'How can I send text alerts to my employees without hiring a developer or learning a new app?',
    'Which plan lets a small business schedule text messages to the whole team from Gmail?'
  ],
  ukPrompt:
    'How can I send text alerts to my staff in the UK without hiring a developer or learning a new app?',
  title:
    'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)',
  meta: 'Learn how to set up business text alerts in 5 steps without coding. Turn emails from your existing tools into SMS notifications with TextBolt.',
  body: 'Text alerts reach a crew faster than email. Each SMS holds 155 GSM characters. We will also cover what to do when carrier email-to-text stops working. Verizon is shutting down vtext.com.'
} as const

/** Every assist request field, with the seeded project and page. */
export function request(assistId: string, extra: Partial<AssistRunRequest> = {}): AssistRunRequest {
  return {
    assistId,
    projectId: SEED.projectId,
    pageId: SEED.pageId,
    marketId: null,
    promptId: null,
    inputs: {},
    instruction: null,
    ...extra
  }
}

export function readFixture(assistId: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${assistId}.json`), 'utf8')) as unknown
}

/** Answers `Assist: <id>` prompts with that id's fixture, unless a reply is queued. */
export interface ScriptedClaude extends ClaudeProvider {
  requests: ClaudeCompletionRequest[]
  queue: unknown[]
  /** When set, the next call throws this message. */
  failNext: string | null
}

export function scriptedClaude(): ScriptedClaude {
  const requests: ClaudeCompletionRequest[] = []
  const queue: unknown[] = []
  const claude: ScriptedClaude = {
    id: 'claude-code',
    requests,
    queue,
    failNext: null,
    async complete(input): Promise<ClaudeCompletion> {
      requests.push(input)
      if (claude.failNext !== null) {
        const message = claude.failNext
        claude.failNext = null
        throw new Error(message)
      }
      const id = /^Assist: (\S+)/.exec(input.prompt)?.[1]
      const json = queue.length > 0 ? queue.shift() : id === undefined ? null : readFixture(id)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json: json ?? null,
        inputTokens: 120,
        outputTokens: 40,
        durationMs: 5,
        model: 'fixture',
        resolvedModel: 'fixture',
        usage: { ...emptyClaudeCliUsage(), inputTokens: 120, outputTokens: 40 }
      }
    }
  }
  return claude
}

export interface AssistSeed {
  host: EngineHost
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  projectDb: SqliteDatabase
  claude: ScriptedClaude
  close: () => void
}

const US: Market = {
  id: SEED.us,
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: SEED.uk, country: 'UK', location: 'London' }

const BODIES: Readonly<Record<string, string>> = {
  [`us|${SEED.prompts[0]}`]: 'google-ai-overview.json',
  [`us|${SEED.prompts[1]}`]: 'google-own-page.json',
  [`uk|${SEED.ukPrompt}`]: 'google-competitor.json',
  [`uk|${SEED.prompts[1]}`]: 'google-own-page.json'
}

/**
 * TextBolt in US and UK, checked on Oct 5 and Oct 19 through the real check
 * engine with recorded SerpApi bodies, then a coverage matrix, two fixes, two
 * `buyer_prompts` generations and one failed Claude call. The returned host
 * answers Claude with `scriptedClaude`.
 */
export async function seedAssistProject(): Promise<AssistSeed> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-assist-'))
  const storage = openAppStorage(directory)
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
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
    addPageMarket(projectDb, { pageId: SEED.pageId, marketId, addedAt: FIRST, baselineRunId: null })
  }
  insertSnapshot(projectDb, {
    id: 'snap-1',
    pageId: SEED.pageId,
    fetchedAt: FIRST,
    method: 'jina',
    httpStatus: 200,
    durationMs: 4,
    title: SEED.title,
    metaDescription: SEED.meta,
    h1: SEED.title,
    canonical: null,
    publishedAt: null,
    modifiedAt: '2026-10-16T00:00:00.000Z',
    outline: [
      { level: 'h2', text: 'At a Glance', table: false },
      { level: 'h2', text: 'Step 3: Point your existing tools at your text address', table: false }
    ],
    faqs: [
      {
        question: 'Can employees reply to a text alert??',
        answer: 'Yes, replies come back to your email.',
        typo: 'Ends in ??'
      }
    ],
    h2Count: 2,
    h3Count: 0,
    tableCount: 0,
    bodyText: SEED.body,
    wordCount: wordCount(SEED.body),
    contentHash: contentHash(SEED.body),
    summary: null
  })
  insertBuyerProfile(projectDb, profile())
  insertPromptSet(
    projectDb,
    {
      id: 'pset-1',
      pageId: SEED.pageId,
      version: 1,
      savedAt: FIRST,
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
  insertApiKey(storage.db, {
    id: 'key-1',
    provider: 'serpapi',
    name: 'My plan',
    keychainRef: 'citefox.serpapi.assist-key-1',
    hint: 'ab12',
    rotationOrder: 1,
    cap: 200,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' }
  })
  const secrets = new MemorySecretStore()
  secrets.set('citefox.serpapi.assist-key-1', SERP_SECRET)
  const seeding = await seedChecks(storage, secrets)
  seeding.email.close()
  seedAnalysis(storage, projectDb)
  const claude = scriptedClaude()
  let host: EngineHost | undefined
  let sequence = 0
  const handlers = createIpcHandlers({
    ...baseDeps(storage, secrets),
    now: () => new Date(NOW),
    createId: () => {
      sequence += 1
      return `assist-test-${sequence}`
    },
    claude,
    onHost: (opened) => {
      host = opened
    }
  })
  if (host === undefined) throw new Error('No engine host')
  const opened = host
  return {
    host: opened,
    handlers,
    storage,
    projectDb,
    claude,
    close: () => {
      opened.email.close()
      closeProjectDatabase(projectDb)
      storage.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function baseDeps(
  storage: AppStorage,
  secrets: MemorySecretStore
): Omit<IpcHandlerDeps, 'now' | 'createId'> {
  return {
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger: createLogger({ write: () => undefined, secrets: () => [SERP_SECRET] }),
    http: {
      async request(input) {
        const url = new URL(input.url)
        if (url.searchParams.get('engine') === 'google') {
          const gl = (url.searchParams.get('gl') ?? '').toLowerCase()
          const market = gl === 'uk' || gl === 'gb' ? 'uk' : 'us'
          return tokenEnvelope(`${market}|${url.searchParams.get('q') ?? ''}`)
        }
        return envelope(
          BODIES[url.searchParams.get('page_token') ?? ''] ?? 'google-competitor.json'
        )
      }
    },
    claudeCommand: stubCommand(),
    claudeProbe: { exists: () => false, searchPath: () => null } satisfies BinaryProbe,
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => [SERP_SECRET]
  }
}

async function seedChecks(storage: AppStorage, secrets: MemorySecretStore): Promise<EngineHost> {
  let clock = Date.parse(FIRST)
  let sequence = 0
  let host: EngineHost | undefined
  const handlers = createIpcHandlers({
    ...baseDeps(storage, secrets),
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
  for (const at of [FIRST, SECOND]) {
    clock = Date.parse(at)
    const job = await handlers['checks:start']({
      projectId: SEED.projectId,
      pageIds: [SEED.pageId],
      marketIds: null,
      promptIds: null
    })
    if (job.status !== 'finished') throw new Error(job.message ?? `Seed check ${job.status}`)
  }
  if (host === undefined) throw new Error('No engine host')
  return host
}

function seedAnalysis(storage: AppStorage, db: SqliteDatabase): void {
  const hash = contentHash(SEED.body)
  insertCoverage(db, {
    runId: 'cov-1',
    pageId: SEED.pageId,
    recordedAt: SECOND,
    templateId: 'tpl-coverage',
    templateName: 'CiteFox default',
    templateHash: contentHash('coverage'),
    templateUpdatedAt: null,
    contentHash: hash,
    reused: false,
    stale: false,
    rows: [
      coverageRow(
        'prompt-1',
        'strong',
        'Says no developer is needed.',
        'Say staff install nothing.'
      ),
      coverageRow(
        'prompt-2',
        'weak',
        'Never names the plan that includes scheduling.',
        'Add an FAQ that names the plan with scheduled texts.'
      )
    ],
    findings: []
  })
  createFixFollowUp(db, {
    id: 'fix-1',
    pageId: SEED.pageId,
    description: 'Added a no-app line to At a Glance.',
    goLiveAt: '2026-10-10T09:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ['prompt-1'],
    marketIds: [SEED.us, SEED.uk]
  })
  createFixFollowUp(db, {
    id: 'fix-2',
    pageId: SEED.pageId,
    description: 'Added a plan FAQ.',
    goLiveAt: '2026-10-20T09:00:00.000Z',
    rule: 'after_3_days',
    promptIds: ['prompt-2'],
    marketIds: [SEED.us, SEED.uk]
  })
  const generation = {
    pageId: SEED.pageId,
    kind: 'buyer_prompts' as const,
    templateId: 'tpl-buyer-prompts',
    templateHash: contentHash('template'),
    durationMs: 9000,
    model: 'claude-sonnet',
    connection: 'claude-code' as const,
    usage: {
      inputTokens: 900,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      serpapiSearches: 0
    }
  }
  insertGeneration(
    db,
    {
      ...generation,
      id: 'gen-1',
      startedAt: '2026-10-04T10:00:00.000Z',
      ok: true,
      error: null,
      inputHash: contentHash('input-1')
    },
    { prompts: [{ label: 'Short one', text: 'sms alerts small business' }] }
  )
  insertGeneration(
    db,
    {
      ...generation,
      id: 'gen-2',
      startedAt: '2026-10-04T11:00:00.000Z',
      ok: false,
      error: 'A buyer prompt contains the brand name "TextBolt".',
      inputHash: contentHash('input-2')
    },
    null
  )
  insertLlmCall(
    storage.db,
    {
      id: 'llm-failed-1',
      connection: 'claude-code',
      model: 'claude-sonnet',
      source: 'report',
      templateKind: 'run_summary',
      templateId: null,
      templateHash: null,
      assistId: null,
      startedAt: '2026-10-19T12:05:00.000Z',
      durationMs: 1200,
      tokensIn: 0,
      tokensOut: 0,
      ok: false,
      error: 'Claude Code is signed out.'
    },
    { table: 'app', projectId: null }
  )
}

function coverageRow(
  promptId: string,
  coverage: CoverageRecord['coverage'],
  mainGap: string,
  whatToUpdate: string
): CoverageRecord {
  return {
    id: `row-${promptId}`,
    runId: 'cov-1',
    pageId: SEED.pageId,
    promptId,
    coverage,
    whereCovered: coverage === 'strong' ? ['H1', 'At a Glance'] : ['Step 2'],
    currentContent: 'Scheduling is available on paid plans.',
    whatToUpdate,
    mainGap,
    priority: coverage === 'strong' ? 'low' : 'high',
    actions: coverage === 'strong' ? ['small_update'] : ['new_faq'],
    suggestedFaq: null,
    done: false
  }
}

function envelope(name: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(SERP, name), 'utf8')) as {
    status: number
    body: unknown
  }
  return { status: parsed.status, body: JSON.stringify(parsed.body) }
}

function tokenEnvelope(token: string): HttpResponse {
  const parsed = JSON.parse(readFileSync(join(SERP, 'google-page-token.json'), 'utf8')) as {
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
    title: SEED.title,
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
    who: 'Office managers at US businesses with 10 to 250 staff.',
    environment: 'They live in Gmail or Outlook.',
    segments: [{ name: 'Field service', reason: 'Crews are away from desks.' }],
    triggers: ['A carrier email-to-text gateway stopped working.'],
    values: ['Setup in about 30 minutes.'],
    poorFit: [{ name: 'SMS marketers', reason: 'The page is about staff alerts.' }],
    templateId: 'tpl-buyer-profile',
    templateName: 'Buyer profile',
    templateHash: contentHash('template'),
    templateUpdatedAt: null,
    createdAt: FIRST,
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
    mappedElement: 'At a Glance',
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
