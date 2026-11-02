import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptCheckStatus } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { createCheckEngine, type CheckEngineDeps } from '../engine/checks/engine'
import { consistencyIssues } from '../engine/checks/score'
import { aioGapPath, checkReportsRoot, runSummaryPath } from '../engine/checks/report-files'
import { claimsCause } from '../engine/checks/report-templates'
import { createLogger } from '../logging/logger'
import { pageReadFlags } from './flags'
import { createAnthropicApiProvider } from '../providers/claude/anthropic-api'
import { createFileFixtureSource, createFixtureHttpTransport } from '../providers/fixtures'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage } from '../storage/app-storage'
import { APP_MIGRATIONS } from '../storage/app-schema'
import {
  listStoredAioReferences,
  listStoredCheckRuns,
  listStoredSerpResults
} from '../storage/check-records'
import {
  getLatestBuyerProfile,
  getLatestPromptSet,
  getLatestSnapshot,
  listGenerations
} from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { addPageMarket, getPage, insertPage, setPageStatus } from '../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { PROJECT_MIGRATIONS } from '../storage/project-schema'
import { insertApiKey, insertProject } from '../storage/records'
import { projectDatabasePath, projectDatabaseRelativePath } from '../storage/slug'
import { generateBuyerProfile, generateBuyerPrompts, type PageSetupDeps } from './setup'
import { readPage } from './page-reader'
import {
  TEXTBOLT_H1,
  TEXTBOLT_META,
  TEXTBOLT_PROMPTS_EN,
  TEXTBOLT_TITLE,
  TEXTBOLT_URL,
  textboltJinaBody
} from './textbolt-fixture'
import { validateBuyerProfile, validateBuyerPrompts } from './validate'

const FIXTURES = join(process.cwd(), 'src/main/providers/fixtures')
const NOW = '2026-10-20T13:00:00.000Z'
const SERP_SECRET = 'serp-fixture-key-textbolt'
const ANTHROPIC_SECRET = 'anthropic-fixture-key-textbolt'
const PAGE_TOKEN = 'textbolt-p1-token'
const TARGET = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business'
const ORIGINAL_FETCH = globalThis.fetch

/**
 * Hand map from the recorded SerpApi fixtures.
 * Points: page cited 3, other own page 1, brand mentioned 1, not cited 0.
 * No AIO is excluded from the denominator (section 7.1).
 */
const EXPECTED_STATUS: readonly PromptCheckStatus[] = [
  'page_cited',
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited',
  'no_aio',
  'page_cited',
  'other_own_page',
  'not_cited',
  'page_cited'
]

const closers: Array<() => void> = []

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  for (const close of closers.splice(0)) close()
})

describe('textbolt pipeline integration', () => {
  test('reads, writes prompts, checks, scores, and writes the two reports offline', async () => {
    let networkCalls = 0
    globalThis.fetch = (() => {
      networkCalls += 1
      throw new Error('network')
    }) as typeof fetch
    const serpCalls: string[] = []
    const directory = mkdtempSync(join(tmpdir(), 'citefox-textbolt-'))
    const storage = openAppStorage(directory)
    closers.push(() => storage.close())
    const transport = fixtureTransport(serpCalls)
    const secrets = new MemorySecretStore()
    secrets.set('citefox.serpapi.key-1', SERP_SECRET)
    secrets.set('citefox.anthropic.key-1', ANTHROPIC_SECRET)
    const logger = createLogger({ write: () => undefined })
    const provider = createAnthropicApiProvider({
      transport,
      secretStore: secrets,
      keychainRef: 'citefox.anthropic.key-1',
      logger,
      clock: () => Date.parse(NOW),
      secrets: [SERP_SECRET, ANTHROPIC_SECRET]
    })
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
    seedPage(projectDb)
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'serpapi',
      name: 'Search',
      keychainRef: 'citefox.serpapi.key-1',
      hint: 'bolt',
      rotationOrder: 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'ok',
      lastReason: null,
      serpapiUsage: null
    })
    expect(migrations(storage.db)).toEqual(
      APP_MIGRATIONS.map((item) => ({ version: item.version, name: item.name }))
    )
    expect(migrations(projectDb)).toEqual(
      PROJECT_MIGRATIONS.map((item) => ({ version: item.version, name: item.name }))
    )
    expect(existsSync(storage.paths.appDatabase)).toBe(true)
    expect(existsSync(projectDatabasePath(storage.paths.projectsDirectory, 'textbolt'))).toBe(true)

    const setup = setupDeps(storage.db, projectDb, transport, provider, secrets, logger)
    const read = await readPage({
      db: projectDb,
      transport,
      logger,
      secretStore: secrets,
      jinaKeychainRef: null,
      reader: 'jina',
      jinaMode: 'always',
      pageId: 'page-1',
      projectId: 'proj-1',
      now: () => NOW,
      clock: () => Date.parse(NOW)
    })
    const generatedProfile = await generateBuyerProfile(setup, 'page-1')
    const generatedPrompts = await generateBuyerPrompts(setup, 'page-1')
    setPageStatus(projectDb, 'page-1', 'setting_up', 'proj-1')
    const profile = getLatestBuyerProfile(projectDb, 'page-1')
    const prompts = getLatestPromptSet(projectDb, 'page-1', ['TextBolt', 'Text Bolt'])
    expect(profile).toMatchObject({ id: generatedProfile.id, pageId: 'page-1' })
    expect(prompts).toMatchObject({
      promptSetId: generatedPrompts.promptSetId,
      pageId: 'page-1',
      version: 1
    })
    if (profile === null || prompts === null) return
    expect(listGenerations(projectDb, 'page-1').map((row) => row.kind)).toEqual([
      'buyer_profile',
      'buyer_prompts'
    ])
    expect(listGenerations(projectDb, 'page-1').every((row) => row.ok)).toBe(true)

    const snapshot = getLatestSnapshot(projectDb, 'page-1')
    expect(snapshot).not.toBeNull()
    expect(read.method).toBe('jina')
    expect(read.httpStatus).toBe(200)
    expect(read.title).toBe(TEXTBOLT_TITLE)
    expect(read.h1).toBe(TEXTBOLT_H1)
    expect(read.metaDescription).toBe(TEXTBOLT_META)
    expect(read.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(read.snapshotReused).toBe(false)
    expect(read.flags).toEqual(
      pageReadFlags({ title: TEXTBOLT_TITLE, metaDescription: TEXTBOLT_META, h1: TEXTBOLT_H1 })
    )
    expect(read.flags.map((flag) => flag.code)).toContain('title_differs_from_h1')
    expect(snapshot).toMatchObject({
      method: 'jina',
      httpStatus: 200,
      title: TEXTBOLT_TITLE,
      h1: TEXTBOLT_H1,
      metaDescription: TEXTBOLT_META,
      contentHash: read.contentHash
    })
    expect(snapshot?.wordCount).toBeGreaterThan(0)
    expect(snapshot?.outline.length).toBeGreaterThan(0)
    expect(
      validateBuyerProfile({
        who: profile.who,
        environment: profile.environment,
        segments: profile.segments,
        triggers: profile.triggers,
        values: profile.values,
        poorFit: profile.poorFit
      })
    ).toBeNull()
    expect(profile.templateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(prompts.prompts).toHaveLength(10)
    expect(prompts.version).toBe(1)
    expect(prompts.brandsClear).toBe(true)
    const drafts = prompts.prompts.map((prompt) => ({
      text: prompt.variants[0]?.text ?? '',
      label: prompt.label,
      source: prompt.source,
      intentStage: prompt.intentStage,
      mappedElement: prompt.mappedElement
    }))
    expect(
      validateBuyerPrompts(
        { prompts: drafts },
        {
          count: 10,
          brands: ['TextBolt', 'Text Bolt'],
          canonical: null,
          language: 'en',
          canonicalLanguage: 'en'
        }
      )
    ).toBeNull()
    expect(drafts.map((prompt) => prompt.text)).toEqual(
      TEXTBOLT_PROMPTS_EN.prompts.map((prompt) => prompt.text)
    )

    let sequence = 0
    let clock = Date.parse(NOW)
    const engineDeps: CheckEngineDeps = {
      storage,
      secrets,
      logger,
      http: transport,
      now: () => new Date(clock),
      createId: () => {
        sequence += 1
        clock += 1000
        return `id-${sequence}`
      },
      emitProgress: () => undefined,
      emitFinished: () => undefined,
      knownSecrets: () => [SERP_SECRET, ANTHROPIC_SECRET],
      timeZone: 'UTC',
      claude: provider,
      sleep: async () => {
        throw new Error('unexpected provider retry')
      }
    }
    const engine = createCheckEngine(engineDeps)
    const job = await engine.start({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null,
      reason: 'manual'
    })
    await engine.reportsIdle()
    expect(job.status).toBe('finished')
    expect(job.runIds).toHaveLength(1)
    const runId = job.runIds[0] ?? ''

    const google = serpCalls.filter((url) => new URL(url).searchParams.get('engine') === 'google')
    const followUps = serpCalls.filter(
      (url) => new URL(url).searchParams.get('engine') === 'google_ai_overview'
    )
    expect(google).toHaveLength(10)
    expect(followUps).toHaveLength(1)
    const follow = new URL(followUps[0] ?? '')
    const firstGoogle = new URL(google[0] ?? '')
    expect(follow.searchParams.get('page_token')).toBe(PAGE_TOKEN)
    expect(follow.searchParams.get('api_key')).toBe(SERP_SECRET)
    expect(firstGoogle.searchParams.get('api_key')).toBe(SERP_SECRET)
    expect(new Set(serpCalls.map((url) => new URL(url).searchParams.get('api_key')))).toEqual(
      new Set([SERP_SECRET])
    )
    expect(firstGoogle.searchParams.get('gl')).toBe('us')
    expect(firstGoogle.searchParams.get('hl')).toBe('en')
    expect(firstGoogle.searchParams.get('device')).toBe('desktop')
    expect(firstGoogle.searchParams.get('no_cache')).toBe('true')
    expect(networkCalls).toBe(0)

    const runs = listStoredCheckRuns(projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketId: 'mkt-us',
      from: null,
      to: null,
      runId: null,
      promptId: null
    })
    expect(runs.map((run) => run.kind)).toEqual(['baseline'])
    expect(runs[0]).toMatchObject({ status: 'finished', partial: false, samples: 1 })
    const captures = listStoredSerpResults(projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketId: 'mkt-us',
      from: null,
      to: null,
      runId,
      promptId: null
    })
    const references = listStoredAioReferences(projectDb, {
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketId: 'mkt-us',
      from: null,
      to: null,
      runId,
      promptId: null
    })
    const byPosition = new Map(prompts.prompts.map((prompt) => [prompt.id, prompt.position]))
    const ordered = [...captures].sort(
      (left, right) => (byPosition.get(left.promptId) ?? 0) - (byPosition.get(right.promptId) ?? 0)
    )
    expect(ordered.map((row) => row.status)).toEqual(EXPECTED_STATUS)
    expect(ordered[0]).toMatchObject({ neededFollowup: true, searches: 2, hasAio: true })
    for (const row of ordered.slice(1)) {
      expect(row.neededFollowup).toBe(false)
      expect(row.searches).toBe(1)
    }
    // 1 follow-up pair (2 searches) + 9 single searches = 11.
    expect(ordered.reduce((sum, row) => sum + row.searches, 0)).toBe(11)
    expect(job.searchesUsed).toBe(11)
    const raw = ordered.map((row) => `${row.rawSearchJson ?? ''}${row.rawAioJson ?? ''}`).join('\n')
    expect(raw).not.toContain(SERP_SECRET)
    expect(raw).not.toContain(ANTHROPIC_SECRET)
    expect(raw).not.toContain(PAGE_TOKEN)
    const firstRefs = references
      .filter((reference) => reference.promptId === ordered[0]?.promptId)
      .sort((left, right) => left.position - right.position)
    expect(firstRefs.map((reference) => reference.classification)).toEqual([
      'other',
      'target',
      'competitor'
    ])
    expect(firstRefs[0]?.sourceType).toBe('reddit')
    expect(firstRefs[1]?.normalizedUrl).toBe(TARGET)
    expect(firstRefs[1]?.position).toBe(2)

    const results = engine.results({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      runId
    })
    const run = results.run
    expect(run).not.toBeNull()
    if (run === null) return
    expect(results.prompts.map((prompt) => prompt.status)).toEqual(EXPECTED_STATUS)
    // Page cited 4×3 + other own 2×1 + brand mentioned 1×1 + not cited 2×0 = 15.
    // Prompts with an AIO = 10 − 1 no-AIO = 9. Points possible = 9 × 3 = 27.
    // Visibility score = round(15 / 27 × 100) = round(55.555…) = 56.
    expect(run.points).toBe(15)
    expect(run.pointsPossible).toBe(27)
    expect(run.visibilityScore).toBe(56)
    // AIO coverage = 9 / 10 prompts. Target citation rate = 4 / 9. Own-domain rate = (4 + 2) / 9.
    expect(run.promptsChecked).toBe(10)
    expect(run.promptsWithAio).toBe(9)
    expect(run.pageCited).toBe(4)
    expect(run.otherOwnPage).toBe(2)
    expect(run.brandMentioned).toBe(1)
    expect(run.notCited).toBe(2)
    expect(run.noAio).toBe(1)
    expect(run.errors).toBe(0)
    // Target links: prompts 1, 2, 7, 10. Other own links: prompts 3, 8, and the second link on 10.
    expect(run.citationsThisPage).toBe(4)
    expect(run.citationsOtherOwn).toBe(3)
    // Cited and named: prompts 1, 2, and 10. Prompt 7 is cited and not named.
    expect(run.citedAndNamed).toBe(3)
    // Target positions 2, 1, 3, 1. Mean = 7 / 4 = 1.75.
    expect(run.averagePosition).toBe(1.75)
    expect(run.contentChanged).toBe(false)
    expect(run.kind).toBe('baseline')
    expect(run.partial).toBe(false)
    // First check: previous is empty, baseline column copies the current score, change since baseline is 0.
    expect(results.scoreChange).toEqual({ sincePrevious: null, sinceBaseline: 0 })
    expect(results.comparison.map((column) => column.which)).toEqual([
      'baseline',
      'previous',
      'current'
    ])
    expect(results.comparison[0]?.score).toBe(56)
    expect(results.comparison[1]?.pageCited).toBeNull()
    expect(results.comparison[2]?.pageCited).toBe(4)
    expect(results.comparison[2]?.aiosShown).toBe(9)
    // Funnel: 10 checked, 9 with an AIO, 6 own-domain, 4 this page, 3 cited and named.
    expect(results.funnel.map((step) => step.count)).toEqual([10, 9, 6, 4, 3])
    expect(results.funnel[1]?.drop?.count).toBe(1)
    expect(results.funnel[2]?.drop?.count).toBe(3)
    expect(results.funnel[3]?.drop?.count).toBe(2)
    expect(results.funnel[4]?.drop?.count).toBe(1)
    // Buckets are the four AIO statuses: 4 + 2 + 1 + 2 = 9.
    expect(results.buckets.map((bucket) => bucket.count)).toEqual([4, 2, 1, 2])
    expect(results.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(run.promptsWithAio)
    // Problem 1/3, solution 1/2, trigger 0/2, comparison 0/1, objection 2/2. Cited sums to 4.
    expect(results.stageRates).toEqual([
      { stage: 'problem', prompts: 3, pageCited: 1 },
      { stage: 'solution', prompts: 2, pageCited: 1 },
      { stage: 'trigger', prompts: 2, pageCited: 0 },
      { stage: 'comparison', prompts: 1, pageCited: 0 },
      { stage: 'objection', prompts: 2, pageCited: 2 }
    ])
    expect(results.stageRates.reduce((sum, rate) => sum + rate.pageCited, 0)).toBe(run.pageCited)
    expect(results.ugcOverlay.count).toBe(1)
    expect(results.leaderboard.find((row) => row.badge === 'you')).toMatchObject({
      domain: 'textbolt.com',
      aioCount: 6,
      overlap: null,
      gap: null
    })
    expect(results.leaderboard.find((row) => row.domain === 'simpletexting.com')).toMatchObject({
      badge: 'tracked',
      aioCount: 3,
      overlap: 2,
      gap: 1
    })
    expect(results.leaderboard.find((row) => row.domain === 'twilio.com')).toMatchObject({
      badge: 'tracked',
      aioCount: 3,
      overlap: 2,
      gap: 1
    })
    expect(results.cannibalizing).toHaveLength(3)
    expect(consistencyIssues(results)).toEqual([])
    expect(getPage(projectDb, 'page-1', 'proj-1')?.score).toBe(56)

    const root = checkReportsRoot(storage.paths.root)
    const gapFile = aioGapPath(root, 'proj-1', runId)
    const summaryFile = runSummaryPath(root, 'proj-1', runId)
    expect(existsSync(gapFile)).toBe(true)
    expect(existsSync(summaryFile)).toBe(true)
    const gapMarkdown = readFileSync(gapFile, 'utf8')
    const summaryMarkdown = readFileSync(summaryFile, 'utf8')
    expect(gapMarkdown).toContain('# What the overview says that the page does not')
    expect(gapMarkdown).toContain('Template: aio_gap.md')
    expect(gapMarkdown).toContain('### Facts the overview states that the page does not')
    expect(gapMarkdown).toContain('### References')
    expect(gapMarkdown).toContain('## Prompts not compared')
    expect(summaryMarkdown).toContain('# Run summary')
    expect(summaryMarkdown).toContain('## Headline')
    expect(summaryMarkdown).toContain('## Body')
    expect(summaryMarkdown).toContain('## Counts')
    expect(summaryMarkdown).toContain('## Citation change')
    expect(summaryMarkdown).toContain('## Content')
    expect(summaryMarkdown).toContain('## Notes')
    expect(summaryMarkdown).toContain(`- AIOs shown: **${run.promptsWithAio}**`)
    expect(summaryMarkdown).toContain(`- Page cited: **${run.pageCited}**`)
    expect(summaryMarkdown).toContain(`- Other own page: **${run.otherOwnPage}**`)
    expect(summaryMarkdown).toContain(`- Named without a link: **${run.brandMentioned}**`)
    expect(summaryMarkdown).toContain(`- Invisible: **${run.notCited}**`)
    // 4 / 9 = 0.444… rounds to 44%. Previous check does not exist.
    expect(summaryMarkdown).toContain('Current citation rate: 44% (4 of 9 AIOs shown).')
    expect(summaryMarkdown).toContain('Previous citation rate: no check.')
    expect(summaryMarkdown).toContain('Baseline citation rate: 44% (4 of 9 AIOs shown).')
    expect(summaryMarkdown).toContain('The content fingerprint did not change.')
    expect(summaryMarkdown).not.toContain(SERP_SECRET)
    expect(gapMarkdown).not.toContain(PAGE_TOKEN)
    // The shipped closing names the forbidden phrase in the negative. The model body must not.
    expect(summaryMarkdown).toContain(
      'This summary does not say that a content edit produced a citation change.'
    )
    expect(
      claimsCause('The check states the citation rate and the content fingerprint together.')
    ).toBe(false)
    const headline =
      '**9** AIOs shown, **4** page cited, **2** other own page, **1** named without a link, **2** invisible.'
    expect(results.runSummary?.headline).toBe(headline)
    expect(summaryMarkdown).toContain(headline)
    expect(results.runSummary?.body).toContain(
      'The check states the citation rate and the content fingerprint together.'
    )

    const gapPositions = [3, 4, 5, 8, 9]
    for (const position of gapPositions) {
      const prompt = prompts.prompts.find((item) => item.position === position)
      expect(prompt).toBeDefined()
      const detail = engine.getPrompt({
        projectId: 'proj-1',
        pageId: 'page-1',
        promptId: prompt?.id ?? '',
        marketId: 'mkt-us',
        runId
      })
      expect(detail.aioGap?.length).toBeGreaterThan(0)
      expect(gapMarkdown).toContain(`## Prompt ${prompt?.id}`)
      for (const fact of detail.aioGap ?? []) {
        expect(fact.fact.length).toBeGreaterThan(0)
        expect(claimsCause(fact.fact)).toBe(false)
        expect(fact.likelySource).toMatch(/^https:\/\//)
        expect(gapMarkdown).toContain(fact.fact)
        expect(gapMarkdown).toContain(`Likely source: ${fact.likelySource}`)
      }
    }
    const cited = prompts.prompts.find((prompt) => prompt.position === 1)
    const silent = engine.getPrompt({
      projectId: 'proj-1',
      pageId: 'page-1',
      promptId: cited?.id ?? '',
      marketId: 'mkt-us',
      runId
    })
    expect(silent.aioGap).toBeNull()
    expect(silent.samples[0]?.neededFollowup).toBe(true)
    expect(gapMarkdown).toContain(`- Prompt ${cited?.id} (page cited):`)
  })
})

function fixtureTransport(serpCalls: string[]): HttpTransport {
  const source = createFileFixtureSource(FIXTURES)
  const recorded = createFixtureHttpTransport(source, (request) => fixtureName(request))
  return {
    async request(request): Promise<HttpResponse> {
      if (request.url.startsWith('https://r.jina.ai/')) {
        return { status: 200, body: textboltJinaBody() }
      }
      if (request.url.startsWith('https://serpapi.com/')) serpCalls.push(request.url)
      return recorded.request(request)
    }
  }
}

function fixtureName(request: HttpRequest): string {
  const url = new URL(request.url)
  if (url.hostname === 'serpapi.com') {
    if (url.searchParams.get('engine') === 'google_ai_overview') return 'textbolt/serp-01-aio.json'
    const query = url.searchParams.get('q') ?? ''
    const index = TEXTBOLT_PROMPTS_EN.prompts.findIndex((prompt) => prompt.text === query)
    if (index === 0) return 'textbolt/serp-01-token.json'
    if (index > 0) return `textbolt/serp-${String(index + 1).padStart(2, '0')}.json`
    throw new Error(`No SerpApi fixture for ${query}`)
  }
  const body = request.body ?? ''
  if (body.includes('Template: aio_gap.md')) {
    const index = TEXTBOLT_PROMPTS_EN.prompts.findIndex((prompt) => body.includes(prompt.text))
    const position = index + 1
    if ([3, 4, 5, 8, 9].includes(position)) return `textbolt/claude-gap-${position}.json`
    throw new Error(`No AIO gap fixture for prompt ${position}`)
  }
  if (body.includes('Template: run_summary.md')) return 'textbolt/claude-summary.json'
  if (body.includes('Write six parts')) return 'textbolt/claude-profile.json'
  if (body.includes('You are writing buyer prompts')) return 'textbolt/claude-prompts.json'
  throw new Error(`No Claude fixture for ${url.hostname}`)
}

function setupDeps(
  appDb: SqliteDatabase,
  projectDb: SqliteDatabase,
  transport: HttpTransport,
  provider: PageSetupDeps['provider'],
  secretStore: MemorySecretStore,
  logger: PageSetupDeps['logger']
): PageSetupDeps {
  return {
    appDb,
    projectDb,
    transport,
    provider,
    logger,
    secretStore,
    jinaKeychainRef: null,
    jinaMode: 'always',
    projectId: 'proj-1',
    secrets: [SERP_SECRET, ANTHROPIC_SECRET],
    now: () => NOW,
    clock: () => Date.parse(NOW)
  }
}

function seedPage(projectDb: SqliteDatabase): void {
  writeProjectProfile(projectDb, {
    includeSubdomains: false,
    brandNames: ['TextBolt', 'Text Bolt'],
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
  insertPage(projectDb, {
    id: 'page-1',
    projectId: 'proj-1',
    url: TEXTBOLT_URL,
    title: null,
    label: 'Text alerts',
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  addPageMarket(projectDb, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: NOW,
    baselineRunId: null
  })
}

function migrations(db: SqliteDatabase): { version: number; name: string }[] {
  return db
    .prepare<unknown[], { version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version'
    )
    .all()
}
