import { TOPIC_STAGES, WIN_ODDS_LABEL } from '@shared/domain'
import type { TopicDraft, TopicResultRow } from '@shared/domain'
import type { CheckJob, IpcHandlersFor, topicsChannels, TopicResults } from '@shared/ipc'
import { keywordDepthPreset, questionDepthPreset } from '@shared/topic-depth'
import type { CheckEngine } from '../engine/checks/engine'
import { toContext } from '../handlers/context'
import type { EngineContext } from '../handlers/context'
import { topicsHandlers } from '../handlers/topics'
import { createLogger } from '../logging'
import type { BinaryProbe } from '../providers'
import { createClaudeCodeProvider } from '../providers/claude/claude-code'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import { createSerpApiAccountClient } from '../providers/serpapi/account'
import type { MemorySecretStore } from '../secrets/secret-store'
import {
  closeProjectDatabase,
  createProjectDatabase,
  insertProject,
  openAppStorage,
  openProjectDatabase,
  projectDatabaseRelativePath
} from '../storage'
import type { AppStorage } from '../storage'
import type { SqliteDatabase } from '../storage/database'
import { insertPage } from '../storage/pages'
import { writeProjectProfile } from '../storage/project-profile'
import { randomUUID } from 'node:crypto'
import { normalizeUrl } from '../engine/checks/url'
import type { Logger } from '../logging/logger'
import { listPagesOfKind } from '../storage/pages'
import { listSiteReads } from '../topics/records'
import { setStageRunListener, type StageRun } from '../topics/steps-journey'
import { claudeChildEnv } from './env-file'
import {
  applyDiscoveredCompetitors,
  type SavedCompetitors,
  journeyChecks,
  profileSources,
  stageLines,
  syncSmokeSitemap
} from './topic-journey'
import { runTopicHooks } from './hooks'
import {
  fillTopicProject,
  firstRunLines,
  seedLines,
  seedProductCompetitors
} from './topic-discovery'
import type { EnvFile } from './env-file'
import {
  blankReport,
  createDataDir,
  failText,
  openEngine,
  SmokeError,
  step,
  storeKeys,
  watchSerp,
  writeReport
} from './live'
import type { SerpWatch, SmokeArgs, SmokeIo, SmokeReport, SmokeStage } from './live'
import {
  blankTopicSummary,
  countBy,
  formatCounts,
  namesBrand,
  pickAcrossStages,
  TOPIC_KEYWORD_CAP,
  TOPIC_MIN_SEARCHES_LEFT,
  TOPIC_SEARCH_BUDGET,
  TOPIC_SMOKE_PROJECT
} from './topic-args'
import type { TopicSmokeSummary } from './topic-args'

export interface TopicSmokeOptions {
  io: SmokeIo
  args: SmokeArgs & { topic: string }
  loaded: EnvFile
  secrets: readonly string[]
  parentEnv: NodeJS.ProcessEnv
  command: CommandTransport
  probe: BinaryProbe
  claudeBinary: string
  home: string
  platform: NodeJS.Platform
  clock: () => Date
  /** Unwatched transport. The smoke counts and caps SerpApi searches on top of it. */
  http: HttpTransport
  dataDir?: string
}

type TopicHandlers = IpcHandlersFor<typeof topicsChannels>

const PROJECT = TOPIC_SMOKE_PROJECT

/**
 * Topic mode (Docs/TOPICS-SPEC.md): the real `topics:*` handlers over a temp
 * data dir. Discover reads the site (Jina, no searches), Claude writes the
 * buyer profile, Quick questions and a capped Quick keyword set, pages are
 * matched, the estimate is read, and a check of `--prompts` questions runs in
 * one market. Then results, the topic summary and one "why not cited".
 * The search count is capped at {@link TOPIC_SEARCH_BUDGET} on the transport.
 */
export async function runTopicSmoke(options: TopicSmokeOptions): Promise<SmokeReport> {
  const { io, args, secrets, clock } = options
  const summary = blankTopicSummary(args.topic)
  const report = blankReport(false)
  report.topic = summary
  const http = watchSerp(options.http, TOPIC_SEARCH_BUDGET)
  const dataDir = createDataDir(options.dataDir)
  report.dataDir = dataDir
  const errors: string[] = []
  const logger = createLogger({
    write: (level, line) => {
      if (level === 'error') errors.push(line)
    },
    secrets: () => secrets
  })
  let storage: AppStorage | null = null
  let ctx: EngineContext | null = null
  let engine: CheckEngine | null = null
  const push = (stage: SmokeStage): void => {
    report.stages.push(stage)
    io.stdout(formatStage(stage))
  }
  try {
    storage = openAppStorage(dataDir)
    const keys = storeKeys(storage, options.loaded)
    report.serpKeys = keys.count

    await step(push, secrets, 'quota', async () => {
      const left = await searchesLeft(keys.store, keys.refs, http.transport, logger, secrets)
      summary.searchesLeftBefore = left
      if (left === null || left < TOPIC_MIN_SEARCHES_LEFT) {
        throw new SmokeError(
          left === null
            ? 'SerpApi did not report the searches left. Stopped before any search.'
            : `SerpApi reports ${left} searches left, under ${TOPIC_MIN_SEARCHES_LEFT}. Stopped before any search.`
        )
      }
      return `searches-left=${left} keys=${keys.count} budget=${TOPIC_SEARCH_BUDGET}`
    })

    seedTopicProject(storage, args)
    const provider = createClaudeCodeProvider({
      command: options.command,
      probe: options.probe,
      logger,
      savedBinaryPath: options.claudeBinary,
      baseEnv: claudeChildEnv(options.parentEnv, Object.keys(options.loaded.values)),
      secrets: () => secrets,
      home: options.home,
      platform: options.platform,
      pathEnv: options.parentEnv.PATH
    })
    const opened = storage
    engine = openEngine(opened, keys.store, http.transport, logger, secrets, clock)
    const waiting = new Map<string, Promise<CheckJob>>()
    const checks = watchedChecks(engine, waiting)
    ctx = toContext({
      appInfo: () => ({ name: 'CiteFox', version: 'smoke' }),
      storage: opened,
      secrets: keys.store,
      logger,
      http: http.transport,
      claudeCommand: options.command,
      claudeProbe: options.probe,
      emitCheckupProgress: () => undefined,
      emit: () => undefined,
      knownSecrets: () => secrets,
      now: clock,
      claude: provider
    })
    const handlers = topicsHandlers(ctx, checks)
    const engineCtx = ctx
    // P2 live check (`--fill <domain> --topic`): fill and save the project first.
    const fillDomain = args.fill
    if (fillDomain !== null) {
      await step(push, secrets, 'fill', () =>
        fillTopicProject(engineCtx, PROJECT.id, fillDomain, (line) => io.stdout(line))
      )
      if (http.searches() !== 0) throw new SmokeError('Fill sent a SerpApi search.')
    }
    const flow = await runTopicFlow(handlers, opened, http, push, summary, args, waiting, secrets, {
      io,
      logger,
      clock,
      ctx: engineCtx
    })
    // Prompt-audit hooks (P4, P5). They print nothing until their package fills them.
    await runTopicHooks({
      io,
      push,
      secrets,
      args,
      summary,
      handlers,
      storage: opened,
      projectId: PROJECT.id,
      draftId: flow.draftId,
      topicId: flow.topicId,
      marketId: PROJECT.marketId,
      searches: () => http.searches()
    })
    summary.llmCalls = countLlmCalls(opened)
    summary.searches = http.searches()
    report.searches = summary.searches
    report.followUpSameKey = http.followUpSameKey()
    report.ok = true
    report.reportPath = writeReport(dataDir, report, secrets)
    for (const line of summaryLines(summary)) io.stdout(line)
    io.stdout(`data ${dataDir}`)
    io.stdout(`report ${report.reportPath}`)
    return report
  } catch (error) {
    if (error instanceof SmokeError && error.reported) throw error
    summary.searches = http.searches()
    report.searches = summary.searches
    if (storage !== null) summary.llmCalls = safeCount(storage)
    const failed = report.stages.find((stage) => !stage.ok)?.name ?? 'setup'
    const message = `Topic smoke failed at ${failed}: ${failText(error, secrets)}`
    io.stderr(message)
    for (const line of errors.slice(-3)) io.stderr(`log ${line.slice(0, 600)}`)
    io.stderr(`searches ${summary.searches} of ${TOPIC_SEARCH_BUDGET}`)
    try {
      report.reportPath = writeReport(dataDir, report, secrets)
    } catch {
      report.reportPath = null
    }
    throw new SmokeError(message, true)
  } finally {
    if (engine !== null) {
      try {
        await engine.reportsIdle()
      } catch {
        // Reports are off in the smoke. Nothing should be queued.
      }
    }
    try {
      ctx?.email.close()
    } catch {
      // Closing the temp email store should not hide the result.
    }
    try {
      storage?.close()
    } catch {
      // Closing a temp database should not hide the smoke result.
    }
  }
}

async function runTopicFlow(
  handlers: TopicHandlers,
  storage: AppStorage,
  http: SerpWatch,
  push: (stage: SmokeStage) => void,
  summary: TopicSmokeSummary,
  args: SmokeArgs & { topic: string },
  waiting: Map<string, Promise<CheckJob>>,
  secrets: readonly string[],
  extra: { io: SmokeIo; logger: Logger; clock: () => Date; ctx: EngineContext }
): Promise<{ draftId: string; topicId: string }> {
  const base = { projectId: PROJECT.id }
  let draft: TopicDraft = await handlers['topics:createDraft']({
    ...base,
    path: 'seed',
    seed: args.topic
  })
  const ids = { ...base, draftId: draft.id }
  const brands = draft.brandNames
  let savedCompetitors: SavedCompetitors = { direct: [], partial: [], products: [] }

  const discovered = await step(push, secrets, 'discover', async () => {
    const result = await handlers['topics:discoverSeed'](ids)
    summary.pagesRead = result.pagesRead.length
    summary.pagesReadOk = result.pagesRead.filter((page) => page.ok).length
    summary.jinaReads = http.jinaReads()
    if (summary.pagesReadOk === 0) throw new SmokeError('Discover read no page of the site.')
    if (http.searches() !== 0) throw new SmokeError('Discover sent a SerpApi search.')
    for (const line of seedLines(result)) extra.io.stdout(line)
    return {
      detail: `pages=${summary.pagesReadOk}/${summary.pagesRead} jina-requests=${summary.jinaReads} seeds=${result.seeds.length} searches=0`,
      about: result.about,
      result
    }
  })

  // P3: the topic's own pages come from Site structure (the sitemap) and tracked pages.
  await step(push, secrets, 'sitemap', async () => {
    const synced = await syncSmokeSitemap({
      storage,
      slug: PROJECT.slug,
      projectId: PROJECT.id,
      domain: PROJECT.website,
      http: http.transport,
      logger: extra.logger,
      secrets,
      now: extra.clock,
      createId: () => randomUUID()
    })
    if (http.searches() !== 0) throw new SmokeError('The sitemap read sent a SerpApi search.')
    return `pages=${synced.pages}${synced.problems.length > 0 ? ` problems=${synced.problems.length}` : ''}`
  })

  // P2: the first run's page and topic picks on the filled project (two Claude calls).
  if (args.fill !== null) {
    await step(push, secrets, 'first-run', async () => {
      const lines = await firstRunLines(extra.ctx, PROJECT.id)
      for (const line of lines) extra.io.stdout(line)
      if (http.searches() !== 0) throw new SmokeError('The first-run picks sent a SerpApi search.')
      return lines[0] ?? 'no picks'
    })
  }

  // P3: the discovered competitors saved as a user adds them; switch-from options and
  // integrations marked "Use in buyer questions" on the draft.
  await step(push, secrets, 'apply-discovery', async () => {
    if (args.fill !== null) {
      // The catalog is saved already: "Use as seed" picks the seed's product, and every
      // later step reads that product's competitors.
      const found = seedProductCompetitors(extra.ctx, PROJECT.id, args.topic)
      await handlers['topics:updateDraft']({
        ...ids,
        patch: {
          switchingFrom: discovered.result.switchingFrom.map((item) => item.name),
          integrations: discovered.result.integrations.map((item) => item.name),
          ...(found.productId === null
            ? {}
            : { product: { mode: 'pick' as const, productId: found.productId } })
        }
      })
      savedCompetitors = found
      return `product=${found.product ?? 'whole business'} direct=${found.direct.join(', ') || 'none'} partial=${found.partial.join(', ') || 'none'}`
    }
    const saved = applyDiscoveredCompetitors(storage, PROJECT.slug, discovered.result, brands)
    await handlers['topics:updateDraft']({
      ...ids,
      patch: {
        switchingFrom: discovered.result.switchingFrom.map((item) => item.name),
        integrations: discovered.result.integrations.map((item) => item.name)
      }
    })
    savedCompetitors = saved
    return `products=${saved.products.join(' | ') || 'none'} direct=${saved.direct.join(', ') || 'none'} partial=${saved.partial.join(', ') || 'none'} switch-from=${discovered.result.switchingFrom.length} integrations=${discovered.result.integrations.length}`
  })

  await step(push, secrets, 'profile', async () => {
    const quick = keywordDepthPreset('quick')
    await handlers['topics:updateDraft']({
      ...ids,
      patch: {
        generate: 'both',
        questionDepth: questionDepthPreset('quick'),
        keywordDepth: { ...quick, preset: 'custom', maxKeywords: TOPIC_KEYWORD_CAP },
        ...(discovered.about === null ? {} : { about: discovered.about })
      }
    })
    draft = await handlers['topics:writeProfile'](ids)
    const version = draft.profile?.versions.find((item) => item.version === draft.profile?.current)
    summary.profilePoints = version?.points.length ?? 0
    if (summary.profilePoints === 0) throw new SmokeError('The buyer profile has no points.')
    const sources = profileSources(draft)
    for (const point of version?.points ?? []) {
      extra.io.stdout(`point [${point.section}] ${point.text} (${point.foundIn ?? '-'})`)
    }
    return `points=${summary.profilePoints} sources=${sources.paths.join(',') || 'none'} outside-key-pages=${sources.outside.length}`
  })

  await step(push, secrets, 'questions', async () => {
    const runs: StageRun[] = []
    const previous = setStageRunListener((run) => runs.push(run))
    try {
      draft = await handlers['topics:generateQuestions'](ids)
    } finally {
      setStageRunListener(previous)
    }
    for (const line of stageLines(runs)) extra.io.stdout(line)
    const questions = draft.prompts.filter((prompt) => prompt.kind === 'question')
    for (const question of questions) {
      extra.io.stdout(
        `q [${question.stage ?? 'none'}] (${question.text.split(/\s+/u).length}w) ${question.text}`
      )
    }
    const checks = journeyChecks({
      questions,
      perStage: draft.depth.questions.perStage,
      competitors: savedCompetitors
    })
    for (const line of checks) extra.io.stdout(line)
    summary.questions = questions.length
    summary.questionsByStage = countBy(questions, (prompt) => prompt.stage ?? 'none')
    summary.sampleQuestions = pickAcrossStages(questions, TOPIC_STAGES, 3).map((q) => q.text)
    if (questions.length === 0) throw new SmokeError('Claude wrote no questions.')
    const branded = questions.filter((prompt) => namesBrand(prompt.text, brands))
    if (branded.length > 0) {
      throw new SmokeError(`${branded.length} generated questions name the brand.`)
    }
    return `generated=${questions.length} ${formatCounts(summary.questionsByStage)} brand-free`
  })

  await step(push, secrets, 'keywords', async () => {
    const terms = await handlers['topics:discoverTerms'](ids)
    await handlers['topics:updateDraft']({ ...ids, patch: { keywordTerms: terms.terms } })
    const result = await handlers['topics:generateKeywords'](ids)
    draft = result.draft
    const keywords = draft.prompts.filter((prompt) => prompt.kind === 'keyword' && prompt.included)
    summary.keywords = keywords.length
    summary.keywordsByGroup = countBy(keywords, (prompt) => prompt.kwGroup ?? 'none')
    if (keywords.length > TOPIC_KEYWORD_CAP) {
      throw new SmokeError(`${keywords.length} keywords, over the cap of ${TOPIC_KEYWORD_CAP}.`)
    }
    if (keywords.some((prompt) => namesBrand(prompt.text, brands))) {
      throw new SmokeError('A generated keyword names the brand.')
    }
    return `keywords=${keywords.length} groups=${Object.keys(summary.keywordsByGroup).length} terms=${terms.terms.length}`
  })

  await step(push, secrets, 'pages', async () => {
    const candidates = seedPageCandidates(storage)
    const result = await handlers['topics:matchPages'](ids)
    draft = result.draft
    summary.pageMatch = countBy(
      draft.prompts.filter((prompt) => prompt.included),
      (prompt) => prompt.matchStatus
    )
    return `candidates=${candidates} matched=${result.matched} no-page=${result.noPage}`
  })

  const chosen = await step(push, secrets, 'estimate', async () => {
    const questions = draft.prompts.filter(
      (prompt) => prompt.kind === 'question' && prompt.included && !prompt.flags.includes('brand')
    )
    const picked = pickAcrossStages(questions, TOPIC_STAGES, args.promptCount)
    const keep = new Set(picked.map((prompt) => prompt.id))
    draft = await handlers['topics:updateDraft']({
      ...ids,
      patch: {
        upsertPrompts: questions
          .filter((prompt) => !keep.has(prompt.id))
          .map((prompt) => ({
            id: prompt.id,
            kind: prompt.kind,
            text: prompt.text,
            included: false
          }))
      }
    })
    const estimate = await handlers['topics:estimate']({ ...ids, scope: 'questions' })
    summary.estimate = {
      prompts: estimate.prompts,
      searchesLo: estimate.searchesLo,
      searchesHi: estimate.searchesHi
    }
    if (estimate.prompts !== picked.length) {
      throw new SmokeError(`The estimate counts ${estimate.prompts} prompts, not ${picked.length}.`)
    }
    if (http.searches() + estimate.searchesHi > TOPIC_SEARCH_BUDGET) {
      throw new SmokeError(
        `The check may need ${estimate.searchesHi} searches; the budget is ${TOPIC_SEARCH_BUDGET}.`
      )
    }
    summary.checkedQuestions = picked.map((prompt) => prompt.text)
    return {
      detail: `prompts=${estimate.prompts} searches=${estimate.searchesLo}-${estimate.searchesHi} left=${estimate.searchesLeft ?? 'unknown'}`,
      picked
    }
  })

  const topicId = await step(push, secrets, 'check', async () => {
    const started = await handlers['topics:start']({
      ...ids,
      plan: 'all_now',
      scope: 'questions'
    })
    if (started.jobId === null) throw new SmokeError(started.nextStep ?? started.message)
    if (started.batches.length > 0) throw new SmokeError('Start planned later batches.')
    const job = await jobDone(waiting, started.jobId)
    summary.jobStatus = job.status
    if (job.status !== 'finished') {
      throw new SmokeError(`The check ended ${job.status}: ${job.message ?? 'no message'}`)
    }
    const same = http.followUpSameKey()
    if (same === false) throw new SmokeError('A follow-up used a different SerpApi key.')
    return {
      detail: `${job.status} prompts=${chosen.picked.length} searches=${http.searches()} follow-up=${same === true ? 'same-key' : 'none'}`,
      topicId: started.topicId
    }
  })

  const results = await step(push, secrets, 'results', async () => {
    const loaded = await handlers['topics:results']({
      ...base,
      topicId: topicId.topicId,
      marketId: PROJECT.marketId,
      runId: null
    })
    if (loaded.rows.length !== chosen.picked.length) {
      throw new SmokeError(`Results have ${loaded.rows.length} rows, not ${chosen.picked.length}.`)
    }
    if (loaded.rows.some((row) => row.state === 'not_checked')) {
      throw new SmokeError('A checked question still reads not checked.')
    }
    fillResults(summary, loaded)
    if (loaded.rows.every((row) => row.state === 'failed')) {
      // A run with no readable result proves nothing about the topic results.
      throw new SmokeError(
        `Every checked question came back failed (${loaded.rows.length} of ${loaded.rows.length}). See check_steps in the data dir for the SerpApi reply.`
      )
    }
    return { detail: `rows=${loaded.rows.length} ${formatCounts(summary.rowStates)}`, loaded }
  })

  await step(push, secrets, 'topic-summary', async () => {
    const written = await handlers['topics:topicSummary']({
      ...base,
      topicId: topicId.topicId,
      marketId: PROJECT.marketId
    })
    summary.summaryLine = written.line
    if (written.line.trim().length === 0) throw new SmokeError('The topic summary is empty.')
    return `actions=${written.nextActions.length}`
  })

  await step(push, secrets, 'why-not-cited', async () => {
    const row = whyRow(results.loaded.rows)
    if (row === null) {
      summary.whyNotCitedSkipped = 'no checked question showed an AI Overview'
      return 'skipped: no checked question showed an AI Overview'
    }
    const why = await handlers['topics:whyNotCited']({
      ...base,
      topicId: topicId.topicId,
      promptId: row.promptId,
      marketId: PROJECT.marketId
    })
    summary.whyNotCited = { number: row.number, summary: why.summary, reasons: why.reasons.length }
    if (why.summary.trim().length === 0) throw new SmokeError('"Why not cited" came back empty.')
    return `Q${row.number} reasons=${why.reasons.length}`
  })
  return { draftId: ids.draftId, topicId: topicId.topicId }
}

/** The engine with `start` watched, so the smoke can wait for the job Start leaves running. */
export function watchedChecks(
  engine: CheckEngine,
  waiting: Map<string, Promise<CheckJob>>
): CheckEngine {
  return {
    ...engine,
    start: (request, options) => {
      const run = engine.start(request, options)
      if (request.jobId !== undefined) waiting.set(request.jobId, run)
      return run
    }
  }
}

async function jobDone(waiting: Map<string, Promise<CheckJob>>, jobId: string): Promise<CheckJob> {
  const run = waiting.get(jobId)
  if (run === undefined) throw new SmokeError('Start did not start a check job.')
  return run
}

/** Searches left across the stored keys, from the free account endpoint. */
async function searchesLeft(
  store: MemorySecretStore,
  refs: readonly string[],
  transport: HttpTransport,
  logger: ReturnType<typeof createLogger>,
  secrets: readonly string[]
): Promise<number | null> {
  const client = createSerpApiAccountClient({ transport, logger, secrets: () => secrets })
  let total: number | null = null
  for (const ref of refs) {
    const tested = await client.testKey(store, ref)
    const usage = tested.usage
    if (usage === null || usage.planLimit === null) continue
    total = (total ?? 0) + Math.max(0, usage.planLimit - usage.used)
  }
  return total
}

function seedTopicProject(storage: AppStorage, args: SmokeArgs): void {
  insertProject(storage.db, {
    id: PROJECT.id,
    name: PROJECT.name,
    slug: PROJECT.slug,
    domain: PROJECT.website,
    dbPath: projectDatabaseRelativePath(PROJECT.slug),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, PROJECT.slug)
  try {
    writeProjectProfile(db, {
      includeSubdomains: false,
      brandNames: [...PROJECT.brandNames],
      competitors: [...PROJECT.competitors],
      market: {
        id: PROJECT.marketId,
        country: args.market.country,
        language: args.market.language,
        location: null,
        device: args.market.device,
        localWording: false,
        serpapiLocation: null
      }
    })
  } finally {
    closeProjectDatabase(db)
  }
}

/**
 * Pages to match against. A new project has no tracked pages or sitemap, so the
 * site pages Discover read (the homepage and the key pages that answered) are
 * added as untracked pages, the way sitemap entries appear. Returns the count.
 */
function seedPageCandidates(storage: AppStorage): number {
  const db: SqliteDatabase = openProjectDatabase(storage.paths.projectsDirectory, PROJECT.slug)
  try {
    // Pages the sitemap read already added stay as they are.
    const known = new Set(
      listPagesOfKind(db, PROJECT.id, 'page')
        .map((page) => (page.url === null ? null : (normalizeUrl(page.url) ?? page.url)))
        .filter((url): url is string => url !== null)
    )
    const reads = listSiteReads(db).filter(
      (read) =>
        read.ok && read.role !== 'competitor' && !known.has(normalizeUrl(read.url) ?? read.url)
    )
    const urls =
      reads.length === 0
        ? known.size > 0
          ? []
          : [`https://${PROJECT.website}/`]
        : reads.map((r) => r.url)
    urls.forEach((url, index) => {
      insertPage(db, {
        id: `page-site-${index + 1}`,
        projectId: PROJECT.id,
        url,
        title: reads[index]?.title ?? null,
        label: null,
        folder: null,
        status: 'not_tracked',
        setupStep: null,
        intervalDays: 14,
        samples: 1,
        promptCount: 10,
        defaultMarketId: PROJECT.marketId,
        pinned: false,
        score: null,
        promptSetVersion: null
      })
    })
    return known.size + urls.length
  } finally {
    closeProjectDatabase(db)
  }
}

function fillResults(summary: TopicSmokeSummary, results: TopicResults): void {
  summary.rowStates = countBy(results.rows, (row) => row.state)
  const goal = results.goals.questions
  summary.goal = {
    cited: goal.cited,
    withAio: goal.withAio,
    checked: goal.checked,
    rate: goal.rate
  }
  summary.winOdds = results.rows.map(
    (row) => `Q${row.number} ${row.winOdds === null ? 'none' : WIN_ODDS_LABEL[row.winOdds.level]}`
  )
}

/** A row with a stored overview, uncited first. Null when no row has one. */
export function whyRow(rows: readonly TopicResultRow[]): TopicResultRow | null {
  const withAio = rows.filter(
    (row) => row.state !== 'no_aio' && row.state !== 'not_checked' && row.state !== 'failed'
  )
  return withAio.find((row) => row.citedOwnUrl === null) ?? withAio[0] ?? null
}

function countLlmCalls(storage: AppStorage): number {
  const app =
    storage.db.prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM llm_calls').get()?.n ??
    0
  const db = openProjectDatabase(storage.paths.projectsDirectory, PROJECT.slug)
  try {
    const project =
      db.prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM llm_calls').get()?.n ?? 0
    return app + project
  } finally {
    closeProjectDatabase(db)
  }
}

function safeCount(storage: AppStorage): number {
  try {
    return countLlmCalls(storage)
  } catch {
    return 0
  }
}

/** The printed summary. Questions are quoted; no dates, keys or tokens. */
export function summaryLines(summary: TopicSmokeSummary): string[] {
  const goal = summary.goal
  const lines = [
    `topic "${summary.seed}"`,
    `questions ${summary.questions} by stage: ${formatCounts(summary.questionsByStage)}`,
    ...summary.sampleQuestions.map((text, index) => `sample ${index + 1}: ${text}`),
    `keywords ${summary.keywords} by group: ${formatCounts(summary.keywordsByGroup)}`,
    `page match ${formatCounts(summary.pageMatch)}`,
    ...summary.checkedQuestions.map((text, index) => `checked ${index + 1}: ${text}`),
    `match states ${formatCounts(summary.rowStates)}`,
    goal === null
      ? 'goal none'
      : `goal ${goal.cited} cited / ${goal.withAio} with AIO (${goal.checked} checked, rate ${goal.rate === null ? 'n/a' : `${goal.rate}%`})`,
    `win odds ${summary.winOdds.length === 0 ? 'none' : summary.winOdds.join(', ')}`,
    `topic summary ${summary.summaryLine ?? 'none'}`,
    summary.whyNotCited === null
      ? `why not cited skipped (${summary.whyNotCitedSkipped ?? 'not run'})`
      : `why not cited Q${summary.whyNotCited.number}: ${summary.whyNotCited.summary}`,
    `llm_calls ${summary.llmCalls}`,
    `searches ${summary.searches} of ${TOPIC_SEARCH_BUDGET} (left before: ${summary.searchesLeftBefore ?? 'unknown'})`
  ]
  return lines
}

function formatStage(stage: SmokeStage): string {
  const detail = stage.detail.length > 0 ? ` ${stage.detail}` : ''
  return `${stage.name} ${stage.ok ? 'ok' : 'fail'} ${stage.ms}ms${detail}`
}
