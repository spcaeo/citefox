import { isCountryCode, isLanguageTag, isMarketDevice } from '@shared/domain'
import type { MarketDevice } from '@shared/domain'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CheckEngine } from '../engine/checks/engine'
import { createCheckEngine } from '../engine/checks'
import { createLogger, redactString } from '../logging'
import { PipelineError } from '../pipeline/errors'
import { readPage } from '../pipeline/page-reader'
import { generateBuyerProfile, generateBuyerPrompts } from '../pipeline/setup'
import type { PageSetupDeps } from '../pipeline/setup'
import { locateClaudeBinary } from '../providers'
import type { BinaryProbe } from '../providers'
import { createFsBinaryProbe } from '../providers/claude/binary'
import { createClaudeCodeProvider } from '../providers/claude/claude-code'
import { createSpawnCommandTransport } from '../providers/command'
import type { CommandTransport } from '../providers/command'
import { createFetchHttpTransport } from '../providers/http'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { keychainAccountForKey, MemorySecretStore } from '../secrets/secret-store'
import {
  closeProjectDatabase,
  createProjectDatabase,
  insertApiKey,
  insertProject,
  openAppStorage,
  projectDatabaseRelativePath
} from '../storage'
import type { AppStorage } from '../storage'
import type { SqliteDatabase } from '../storage/database'
import { addPageMarket, insertPage, MAX_PROMPT_COUNT } from '../storage/pages'
import { writeProjectProfile } from '../storage/project-profile'
import { claudeChildEnv, formatKeyStatus, isEnvSet, loadEnvFile, secretValues } from './env-file'
import type { EnvFile } from './env-file'
import { SmokeError } from './errors'
import { HOOK_FLAG_NAMES, readHookFlags, SWITCH_FLAGS, wantsPageHooks } from './hook-flags'
import type { HookFlags } from './hook-flags'
import {
  DEFAULT_TOPIC_SEED,
  TOPIC_DEFAULT_PROMPTS,
  TOPIC_MAX_PROMPTS,
  TOPIC_MIN_SEARCHES_LEFT,
  TOPIC_SEARCH_BUDGET
} from './topic-args'
import type { TopicSmokeSummary } from './topic-args'

/** Sample page from the buyer-prompt method. Overridable with `--url`. */
export const DEFAULT_SMOKE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/**
 * `validateBuyerPrompts` requires title_meta_h1, trigger_event, and objection
 * in one set. One prompt cannot carry all three sources, so Claude writes at
 * least this many. `--prompts` is how many of those prompts are searched.
 */
export const MIN_GENERATED_PROMPTS = 3

const PROJECT_ID = 'proj-smoke'
const PAGE_ID = 'page-smoke'
const MARKET_ID = 'mkt-smoke'
const SERP_ENV_NAMES = ['SERPAPI_API_KEY', 'SERPAPI_API_KEY_2', 'SERPAPI_API_KEY_3'] as const

export { SmokeError }

export const SMOKE_USAGE = `CiteFox live smoke. Opt-in only. It is not part of CI, npm test, test:unit, or test:e2e.

  npm run smoke:live -- --env "<path>"

The env file lives outside the repo. Quote a path that contains spaces:

  npm run smoke:live -- --env "../Parent Folder/.env"

Options:
  --env <path>       Env file. Required. A relative path is resolved from the current directory.
  --url <page>       Page to read with Jina Reader. Default: the TextBolt text-alerts page.
  --market <market>  CC, CC:language, or CC:language:device. Default: US:en:desktop.
  --prompts <n>      How many prompts to search. Default: 1 (one Google search plus its page_token follow-up).
  --query <n>        Alias of --prompts.
  --topic [seed]     Topic mode: run the topic engine for TextBolt (textbolt.com) from a seed, then
                     check --prompts questions (default ${TOPIC_DEFAULT_PROMPTS}, at most ${TOPIC_MAX_PROMPTS}). Without a value the seed is
                     "${DEFAULT_TOPIC_SEED}". At most ${TOPIC_SEARCH_BUDGET} SerpApi searches; it stops before
                     any search when the account reports fewer than ${TOPIC_MIN_SEARCHES_LEFT} searches left.
  --fill <domain>    Fill mode: run Fill from my website on <domain> with real page reads, Claude Code
                     and DNS (no SerpApi search, no SerpApi key needed), then print the competitor
                     groups with each domain and its source (site, lookup or unknown) and the reason.
                     With --topic, the topic project is filled and saved first (as onboarding
                     Finish does), then the first-run picks and the topic run on it.
  --gaps             After the page smoke, run the content-gap steps on the page.
  --reports          After the page smoke, write the check reports from its run (no extra search).
  --classify         Before the search, save Fill from my website as products (web search);
                     after it, check the prompt with the most sources again as a page about a
                     second product (1 more prompt) and print which cited domains count as
                     each product's competitors.
  --sentiment        After the page smoke, write brand prompts, search one, and read sentiment.
  --assist <id>      After the page smoke, run one assist on its page (for example audience.triggers).
  --competitor <url> With --topic: also read this competitor page and write its questions and claims.
  --help             Show this help.

--gaps, --reports, --sentiment, --assist and --competitor run hooks that the Docs/PROMPT-AUDIT.md packages fill. A hook that is not written yet prints "skipped".

Claude writes at least ${MIN_GENERATED_PROMPTS} prompts because the buyer-prompt method uses a title, a trigger, and an objection. --prompts chooses how many of those are searched. JINA_API_KEY is optional (Reader works without a key). claude -p uses the Claude Code login on this computer. The env file is not loaded into the environment, and the claude child does not receive those values.

SERPAPI_API_KEY, SERPAPI_API_KEY_2, and SERPAPI_API_KEY_3 are stored in that order, in memory only. They are not written to the system keychain or to the process environment. SerpApi keys must be ones you are entitled to use. The claude-code connection is for running CiteFox yourself, on your own computer, under your own plan.`

export interface SmokeIo {
  stdout(line: string): void
  stderr(line: string): void
}

export interface SmokeMarket {
  country: string
  language: string
  device: MarketDevice
}

export interface SmokeArgs extends HookFlags {
  envPath: string
  url: string
  market: SmokeMarket
  promptCount: number
  /** Topic mode seed. Null runs the page smoke. */
  topic: string | null
  /** Fill mode domain (`--fill textbolt.com`). Null otherwise. */
  fill: string | null
}

export interface SmokeStage {
  name: string
  ok: boolean
  ms: number
  detail: string
}

export interface SmokeReport {
  ok: boolean
  help: boolean
  dataDir: string | null
  reportPath: string | null
  stages: SmokeStage[]
  classification: string | null
  score: number | null
  searches: number | null
  followUpSameKey: boolean | null
  serpKeys: number
  generatedPrompts: number
  searchedPrompts: number
  provider: 'claude-code'
  /** Topic mode summary. Null in the page smoke. */
  topic: TopicSmokeSummary | null
}

export interface RunSmokeOptions {
  argv: readonly string[]
  cwd: string
  /** `CITEFOX_SMOKE_LIVE`. Only the exact value `1` opts in. */
  envFlag: string | undefined
  /** Parent environment. Copied for the claude child. This function does not write it. */
  parentEnv: NodeJS.ProcessEnv
  io: SmokeIo
  /** Isolated app directory. Default: a new temp directory. May contain spaces. */
  dataDir?: string
  http?: HttpTransport
  command?: CommandTransport
  probe?: BinaryProbe
  home?: string
  platform?: NodeJS.Platform
  now?: () => Date
}

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--help' || token === '-h')
}

export function parseSmokeArgs(argv: readonly string[], cwd: string): SmokeArgs {
  const flags = new Map<string, string>()
  const known = new Set([
    'env',
    'url',
    'market',
    'prompts',
    'query',
    'topic',
    'fill',
    ...HOOK_FLAG_NAMES
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || token === '--' || token === '--help' || token === '-h') continue
    if (!token.startsWith('--') || token.length < 3) {
      throw new SmokeError(
        `Unexpected argument "${token}". Quote a path that contains spaces, and pass each flag separately.`
      )
    }
    const name = token.slice(2)
    if (!known.has(name)) throw new SmokeError(`Unknown flag --${name}. Run with --help.`)
    if (SWITCH_FLAGS.has(name)) {
      flags.set(name, '')
      continue
    }
    const value = argv[index + 1]
    if (name === 'topic' && (value === undefined || value.startsWith('--'))) {
      // `--topic` alone uses the default seed.
      flags.set(name, '')
      continue
    }
    if (value === undefined || value.startsWith('--')) {
      throw new SmokeError(`Missing value for --${name}.`)
    }
    flags.set(name, value)
    index += 1
  }
  const envValue = flags.get('env')
  if (envValue === undefined || envValue.length === 0) {
    throw new SmokeError(
      'Missing --env. Pass the env file outside the repo. Quote the path if it contains spaces: npm run smoke:live -- --env "../Parent Folder/.env"'
    )
  }
  const topic = readTopicSeed(flags.get('topic'))
  if (topic !== null && flags.has('url')) {
    throw new SmokeError('--url is for the page smoke. Topic mode reads textbolt.com itself.')
  }
  const fill = readFillDomain(flags.get('fill'))
  if (fill !== null && flags.has('url')) {
    throw new SmokeError('--fill runs on its own or with --topic. Leave out --url.')
  }
  const url = flags.get('url') ?? DEFAULT_SMOKE_URL
  assertPageUrl(url)
  const hooks = readHookFlags(flags, topic !== null, fill !== null && topic === null)
  return {
    envPath: resolve(cwd, envValue),
    url,
    market: readMarket(flags.get('market')),
    promptCount:
      topic === null
        ? readPromptCount(flags, 1, MAX_PROMPT_COUNT)
        : readPromptCount(flags, TOPIC_DEFAULT_PROMPTS, TOPIC_MAX_PROMPTS),
    topic,
    fill,
    ...hooks
  }
}

/**
 * One opt-in check: Jina page read, buyer profile, buyer prompts, one SerpApi
 * search with the immediate page_token follow-up on the same key, then
 * classify and score. Providers are the existing clients. `claude -p` is
 * spawned with an argument array and `shell: false`.
 */
export async function runSmokeLive(options: RunSmokeOptions): Promise<SmokeReport> {
  if (wantsHelp(options.argv)) {
    options.io.stdout(SMOKE_USAGE)
    return blankReport(true)
  }
  if (options.envFlag !== '1') {
    throw reported(
      options.io,
      'smoke:live is opt-in and does not run in CI, npm test, test:unit, or test:e2e. Run npm run smoke:live, which sets CITEFOX_SMOKE_LIVE=1.'
    )
  }

  const args = readArgs(options.io, options.argv, options.cwd)
  const loaded = readEnv(options.io, args.envPath)
  const secrets = secretValues(loaded.values)
  for (const line of formatKeyStatus(loaded.values)) options.io.stdout(line)
  if ((args.fill === null || args.topic !== null) && !isEnvSet(loaded.values, 'SERPAPI_API_KEY')) {
    throw reported(
      options.io,
      'SERPAPI_API_KEY is missing. Add it to the env file. SERPAPI_API_KEY_2 and SERPAPI_API_KEY_3 are optional.'
    )
  }

  const probe = options.probe ?? createFsBinaryProbe()
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  const located = locateClaudeBinary(null, probe, {
    home,
    platform,
    pathEnv: options.parentEnv.PATH
  })
  if (located.path === null) {
    throw reported(
      options.io,
      'Claude Code was not found on PATH. Install the claude CLI and log in on this computer, then run npm run smoke:live again.'
    )
  }

  const clock = options.now ?? ((): Date => new Date())
  const command = options.command ?? createSpawnCommandTransport()
  if (args.fill !== null && args.topic === null) {
    // Fill mode: real page reads, Claude Code and DNS; no SerpApi search.
    const { runFillSmoke } = await import('./fill')
    return runFillSmoke({
      io: options.io,
      domain: args.fill,
      loaded,
      secrets,
      parentEnv: options.parentEnv,
      command,
      probe,
      claudeBinary: located.path,
      home,
      platform,
      clock,
      http: options.http ?? createFetchHttpTransport(),
      dataDir: options.dataDir
    })
  }
  if (args.topic !== null) {
    // Loaded here so the page smoke does not import the topic engine.
    const { runTopicSmoke } = await import('./topic')
    return runTopicSmoke({
      io: options.io,
      args: { ...args, topic: args.topic },
      loaded,
      secrets,
      parentEnv: options.parentEnv,
      command,
      probe,
      claudeBinary: located.path,
      home,
      platform,
      clock,
      http: options.http ?? createFetchHttpTransport(),
      dataDir: options.dataDir
    })
  }
  const http = watchSerp(options.http ?? createFetchHttpTransport())
  const dataDir = createDataDir(options.dataDir)
  const report = blankReport(false)
  report.dataDir = dataDir
  const logger = createLogger({
    write: () => undefined,
    secrets: () => secrets
  })
  let storage: AppStorage | null = null
  let projectDb: SqliteDatabase | null = null

  const push = (stage: SmokeStage): void => {
    report.stages.push(stage)
    options.io.stdout(formatStage(stage))
  }

  try {
    storage = openAppStorage(dataDir)
    const site = siteFromUrl(args.url)
    const generateCount = Math.max(args.promptCount, MIN_GENERATED_PROMPTS)
    const serpKeys = storeKeys(storage, loaded)
    report.serpKeys = serpKeys.count
    projectDb = seedProject(storage, site, args, generateCount, clock)
    const provider = createClaudeCodeProvider({
      command,
      probe,
      logger,
      savedBinaryPath: located.path,
      baseEnv: claudeChildEnv(options.parentEnv, Object.keys(loaded.values)),
      secrets: () => secrets,
      home,
      platform,
      pathEnv: options.parentEnv.PATH
    })
    const setup: PageSetupDeps = {
      appDb: storage.db,
      projectDb,
      transport: http.transport,
      provider,
      logger,
      secretStore: serpKeys.store,
      jinaKeychainRef: serpKeys.jinaRef,
      jinaMode: 'always',
      projectId: PROJECT_ID,
      secrets,
      now: () => clock().toISOString(),
      clock: () => clock().getTime(),
      model: null
    }

    await step(push, secrets, 'page-read', async () => {
      const read = await readPage({
        db: projectDb as SqliteDatabase,
        transport: http.transport,
        logger,
        secretStore: serpKeys.store,
        jinaKeychainRef: serpKeys.jinaRef,
        reader: 'jina',
        jinaMode: 'always',
        pageId: PAGE_ID,
        projectId: PROJECT_ID,
        now: () => clock().toISOString(),
        clock: () => clock().getTime(),
        secrets
      })
      if (read.method !== 'jina') {
        throw new SmokeError('The page was not read with Jina Reader.')
      }
      return serpKeys.jinaRef === null ? 'jina keyless' : 'jina'
    })

    await step(push, secrets, 'buyer-profile', async () => {
      await generateBuyerProfile(setup, PAGE_ID)
      return 'claude-code'
    })

    const prompts = await step(push, secrets, 'prompts', async () => {
      const view = await generateBuyerPrompts(setup, PAGE_ID)
      const ordered = [...view.prompts].sort((left, right) => left.position - right.position)
      if (ordered.length < generateCount) {
        throw new SmokeError(
          `Claude saved ${ordered.length} prompts; ${generateCount} were required.`
        )
      }
      const searched = ordered.slice(0, args.promptCount)
      report.generatedPrompts = ordered.length
      report.searchedPrompts = searched.length
      return {
        detail: `claude-code generated=${ordered.length} searched=${searched.length}`,
        promptIds: searched.length === ordered.length ? null : searched.map((prompt) => prompt.id)
      }
    })

    if (args.classify) {
      // P9: products and competitors saved before the search, so it classifies by product.
      const { prepareClassifySmoke } = await import('./classify')
      await prepareClassifySmoke({
        io: options.io,
        push,
        secrets,
        args,
        setup,
        storage: storage as AppStorage,
        projectId: PROJECT_ID,
        pageId: PAGE_ID,
        clock
      })
    }

    const job = await step(push, secrets, 'search', async () => {
      const engine = openEngine(
        storage as AppStorage,
        serpKeys.store,
        http.transport,
        logger,
        secrets,
        clock
      )
      const finished = await engine.start({
        projectId: PROJECT_ID,
        pageIds: [PAGE_ID],
        marketIds: [MARKET_ID],
        promptIds: prompts.promptIds,
        reason: 'manual'
      })
      if (finished.status !== 'finished') {
        throw new SmokeError(finished.message ?? 'The check did not finish.')
      }
      const same = http.followUpSameKey()
      report.followUpSameKey = same
      report.searches = finished.searchesUsed
      if (same === false) {
        throw new SmokeError(
          'The AI Overview follow-up did not use the same SerpApi key as the search.'
        )
      }
      const follow = same === true ? 'follow-up=same-key' : 'follow-up=none'
      return {
        detail: `searches=${finished.searchesUsed} ${follow}`,
        engine,
        runId: finished.runIds[0] ?? null
      }
    })

    const classified = await step(push, secrets, 'classify', async () => {
      const results = job.engine.results({
        projectId: PROJECT_ID,
        pageId: PAGE_ID,
        marketId: MARKET_ID,
        runId: job.runId
      })
      if (results.prompts.length === 0) {
        throw new SmokeError('The check did not classify a prompt.')
      }
      const status = results.prompts.map((prompt) => prompt.status).join(', ')
      report.classification = status
      return { detail: status, results }
    })

    await step(push, secrets, 'score', async () => {
      const score = classified.results.run?.visibilityScore ?? null
      if (classified.results.run === null) {
        throw new SmokeError('The check did not produce a score.')
      }
      report.score = score
      return score === null ? 'none' : String(score)
    })

    if (wantsPageHooks(args)) {
      // Loaded here so the plain page smoke does not import the hook files.
      const { runPageHooks } = await import('./hooks')
      await runPageHooks({
        io: options.io,
        push,
        secrets,
        args,
        report,
        setup,
        storage,
        engine: job.engine,
        projectId: PROJECT_ID,
        pageId: PAGE_ID,
        marketId: MARKET_ID,
        runId: job.runId,
        searches: () => http.searches(),
        clock
      })
    }

    report.ok = true
    report.reportPath = writeReport(dataDir, report, secrets)
    options.io.stdout(`classification ${report.classification ?? ''}`)
    options.io.stdout(`score ${report.score === null ? 'none' : String(report.score)}`)
    options.io.stdout(`searches ${report.searches ?? 0}`)
    options.io.stdout(`data ${dataDir}`)
    options.io.stdout(`report ${report.reportPath}`)
    return report
  } catch (error) {
    if (error instanceof SmokeError && error.reported) throw error
    const message = failText(error, secrets)
    options.io.stderr(message)
    try {
      report.reportPath = writeReport(dataDir, report, secrets)
    } catch {
      report.reportPath = null
    }
    throw new SmokeError(message, true)
  } finally {
    if (projectDb !== null) {
      try {
        closeProjectDatabase(projectDb)
      } catch {
        // The check engine closes its own connection. This one may already be closed.
      }
    }
    if (storage !== null) {
      try {
        storage.close()
      } catch {
        // Closing a temp database should not hide the smoke result.
      }
    }
  }
}

export function openEngine(
  storage: AppStorage,
  secretStore: MemorySecretStore,
  http: HttpTransport,
  logger: ReturnType<typeof createLogger>,
  secrets: readonly string[],
  clock: () => Date
): CheckEngine {
  let sequence = 0
  return createCheckEngine({
    storage,
    secrets: secretStore,
    logger,
    http,
    now: clock,
    createId: () => {
      sequence += 1
      return `smoke-${sequence}-${randomUUID()}`
    },
    emitProgress: () => undefined,
    emitFinished: () => undefined,
    knownSecrets: () => secrets
  })
}

export async function step<T>(
  push: (stage: SmokeStage) => void,
  secrets: readonly string[],
  name: string,
  run: () => Promise<T>
): Promise<T> {
  const started = Date.now()
  try {
    const value = await run()
    const detail = typeof value === 'string' ? value : valueDetail(value)
    push({ name, ok: true, ms: elapsed(started), detail })
    return value
  } catch (error) {
    push({ name, ok: false, ms: elapsed(started), detail: failText(error, secrets) })
    throw error
  }
}

function valueDetail(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'detail' in value) {
    const detail = (value as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
  }
  return ''
}

export function storeKeys(
  storage: AppStorage,
  loaded: EnvFile
): { store: MemorySecretStore; jinaRef: string | null; count: number; refs: string[] } {
  const store = new MemorySecretStore()
  const refs: string[] = []
  let count = 0
  // FR-11.2. In memory only. The env file map is not process.env, and this
  // store is not the system keychain (SERP-1). Order is _KEY, _2, then _3.
  for (const name of SERP_ENV_NAMES) {
    const value = loaded.values[name] ?? ''
    if (value.length === 0) continue
    count += 1
    const id = `serp-${count}`
    const ref = keychainAccountForKey('serpapi', id)
    store.set(ref, value)
    refs.push(ref)
    insertApiKey(storage.db, {
      id,
      provider: 'serpapi',
      name: `SerpApi ${count}`,
      keychainRef: ref,
      hint: '',
      rotationOrder: count - 1,
      cap: null,
      on: true,
      projectIds: [],
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: null
    })
  }
  const jina = loaded.values.JINA_API_KEY ?? ''
  const jinaRef = jina.length > 0 ? 'citefox.jina.smoke' : null
  if (jinaRef !== null) store.set(jinaRef, jina)
  return { store, jinaRef, count, refs }
}

function seedProject(
  storage: AppStorage,
  site: { domain: string; brand: string },
  args: SmokeArgs,
  generateCount: number,
  clock: () => Date
): SqliteDatabase {
  insertProject(storage.db, {
    id: PROJECT_ID,
    name: 'Smoke',
    slug: 'smoke',
    domain: site.domain,
    dbPath: projectDatabaseRelativePath('smoke'),
    clientName: null,
    status: 'active'
  })
  const projectDb = createProjectDatabase(storage.paths.projectsDirectory, 'smoke')
  writeProjectProfile(projectDb, {
    includeSubdomains: false,
    brandNames: [site.brand],
    competitors: [],
    market: {
      id: MARKET_ID,
      country: args.market.country,
      language: args.market.language,
      location: null,
      device: args.market.device,
      localWording: false,
      serpapiLocation: null
    }
  })
  insertPage(projectDb, {
    id: PAGE_ID,
    projectId: PROJECT_ID,
    url: args.url,
    title: null,
    label: 'Smoke',
    folder: null,
    status: 'setting_up',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: generateCount,
    defaultMarketId: MARKET_ID,
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  addPageMarket(projectDb, {
    pageId: PAGE_ID,
    marketId: MARKET_ID,
    addedAt: clock().toISOString(),
    baselineRunId: null
  })
  return projectDb
}

export interface SerpWatch {
  transport: HttpTransport
  followUpSameKey(): boolean | null
  /** SerpApi searches sent (`google` and `google_ai_overview`). The account endpoint is not a search. */
  searches(): number
  /** Jina Reader requests sent. */
  jinaReads(): number
}

/**
 * Remembers which key each SerpApi call used. The key is not logged. With a
 * `searchBudget`, a search past the budget is refused before it is sent.
 */
export function watchSerp(inner: HttpTransport, searchBudget: number | null = null): SerpWatch {
  let searchKey: string | null = null
  let followKey: string | null = null
  let sawFollow = false
  let mismatch = false
  let searches = 0
  let jina = 0
  return {
    transport: {
      async request(request: HttpRequest): Promise<HttpResponse> {
        noteSerp(request.url)
        return inner.request(request)
      }
    },
    followUpSameKey() {
      if (mismatch) return false
      if (!sawFollow) return null
      return searchKey !== null && followKey === searchKey
    },
    searches: () => searches,
    jinaReads: () => jina
  }

  function noteSerp(url: string): void {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.hostname === 'r.jina.ai') jina += 1
    if (parsed.hostname !== 'serpapi.com') return
    const key = parsed.searchParams.get('api_key')
    const engine = parsed.searchParams.get('engine')
    if (engine === 'google' || engine === 'google_ai_overview') {
      if (searchBudget !== null && searches >= searchBudget) {
        throw new SmokeError(
          `The smoke search budget of ${searchBudget} SerpApi searches is spent. The next search was not sent.`
        )
      }
      searches += 1
    }
    if (engine === 'google') searchKey = key
    if (engine === 'google_ai_overview') {
      sawFollow = true
      followKey = key
      if (searchKey === null || key === null || key !== searchKey) mismatch = true
    }
  }
}

export function createDataDir(requested: string | undefined): string {
  if (requested !== undefined) {
    mkdirSync(requested, { recursive: true })
    return requested
  }
  return mkdtempSync(join(tmpdir(), 'citefox-smoke-'))
}

export function writeReport(
  dataDir: string,
  report: SmokeReport,
  secrets: readonly string[]
): string {
  const path = join(dataDir, 'smoke-report.json')
  // The file is the thing the console prints. Set the path before serializing
  // so smoke-report.json does not store null.
  report.reportPath = path
  const body = redactString(`${JSON.stringify(report, null, 2)}\n`, { secrets })
  writeFileSync(path, body, 'utf8')
  if (process.platform !== 'win32') chmodSync(path, 0o600)
  return path
}

export function blankReport(help: boolean): SmokeReport {
  return {
    ok: help,
    help,
    dataDir: null,
    reportPath: null,
    stages: [],
    classification: null,
    score: null,
    searches: null,
    followUpSameKey: null,
    serpKeys: 0,
    generatedPrompts: 0,
    searchedPrompts: 0,
    provider: 'claude-code',
    topic: null
  }
}

function reported(io: SmokeIo, message: string): SmokeError {
  io.stderr(message)
  return new SmokeError(message, true)
}

function readArgs(io: SmokeIo, argv: readonly string[], cwd: string): SmokeArgs {
  try {
    return parseSmokeArgs(argv, cwd)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the arguments.'
    throw reported(io, message)
  }
}

function readEnv(io: SmokeIo, filePath: string): EnvFile {
  try {
    return loadEnvFile(filePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the env file.'
    throw reported(io, message)
  }
}

export function failText(error: unknown, secrets: readonly string[]): string {
  if (error instanceof SmokeError) return redactString(error.message, { secrets })
  const message = error instanceof Error ? error.message : 'The smoke failed.'
  const next = error instanceof PipelineError ? error.nextStep : ''
  const combined = next.length > 0 && !message.includes(next) ? `${message} ${next}` : message
  return redactString(combined, { secrets })
}

function formatStage(stage: SmokeStage): string {
  const detail = stage.detail.length > 0 ? ` ${stage.detail}` : ''
  return `${stage.name} ${stage.ok ? 'ok' : 'fail'} ${stage.ms}ms${detail}`
}

function elapsed(started: number): number {
  return Math.max(0, Date.now() - started)
}

function readPromptCount(
  flags: ReadonlyMap<string, string>,
  fallback: number,
  max: number
): number {
  const prompts = flags.get('prompts')
  const query = flags.get('query')
  if (prompts !== undefined && query !== undefined && prompts !== query) {
    throw new SmokeError('--prompts and --query must be the same number.')
  }
  const raw = prompts ?? query
  if (raw === undefined) return fallback
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new SmokeError(`--prompts must be a whole number from 1 to ${max}.`)
  }
  const count = Number(raw)
  if (count > max) {
    throw new SmokeError(`--prompts must be a whole number from 1 to ${max}.`)
  }
  return count
}

function readFillDomain(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const domain = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/\/.*$/u, '')
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u.test(domain)) {
    throw new SmokeError('--fill needs a domain such as textbolt.com.')
  }
  return domain
}

function readTopicSeed(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const seed = raw.replace(/\s+/gu, ' ').trim()
  if (seed.length === 0) return DEFAULT_TOPIC_SEED
  if (seed.length > 500) throw new SmokeError('--topic must be at most 500 characters.')
  return seed
}

function readMarket(raw: string | undefined): SmokeMarket {
  if (raw === undefined || raw.length === 0) {
    return { country: 'US', language: 'en', device: 'desktop' }
  }
  const parts = raw.split(':')
  if (parts.length > 3) {
    throw new SmokeError('Use --market CC, CC:language, or CC:language:device.')
  }
  const country = (parts[0] ?? '').toUpperCase()
  const language = (parts[1] ?? 'en').toLowerCase()
  const device = (parts[2] ?? 'desktop').toLowerCase()
  if (!isCountryCode(country) || !isLanguageTag(language) || !isMarketDevice(device)) {
    throw new SmokeError(
      'Use --market CC, CC:language, or CC:language:device. Example: US:en:desktop.'
    )
  }
  return { country, language, device }
}

function assertPageUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SmokeError('The page URL is not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SmokeError('The page URL must start with http:// or https://.')
  }
  if (url.username !== '' || url.password !== '') {
    throw new SmokeError('The page URL must not include a username or password.')
  }
}

function siteFromUrl(pageUrl: string): { domain: string; brand: string } {
  const url = new URL(pageUrl)
  let host = url.hostname.toLowerCase()
  if (host.startsWith('www.')) host = host.slice(4)
  const brand = host.split('.')[0]
  if (host.length === 0 || brand === undefined || brand.length === 0) {
    throw new SmokeError('The page URL needs a hostname.')
  }
  return { domain: host, brand }
}
