import { questionTargetPages } from '../../topics/question-targets'
import {
  ENGINE_IDS,
  SEARCHES_PER_PROMPT_MAX,
  type EngineId,
  type SearchProvider
} from '@shared/domain'
import type { CheckJob } from '@shared/ipc'
import type { CheckSearch } from '../../queue/runner'
import type { QueueProjectInput } from '../../queue/types'
import { capAllowance } from '../../queue/usage'
import { monthKey } from '../../scheduler/local-time'
import type { AppStorage } from '../../storage/app-storage'
import {
  finishStoredCheckJob,
  insertStoredCheckJob,
  listStoredCheckSteps,
  listStoredRunsForJob,
  readStoredCheckJob,
  sumStoredJobSearches
} from '../../storage/check-records'
import { getLatestSnapshot } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage } from '../../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { readProjectProfile } from '../../storage/project-profile'
import { readEngineSettings, runEngines } from '../../storage/engine-records'
import { readEffectiveScheduleCap } from '../../storage/project-schedule'
import { getProject } from '../../storage/records'
import { getTopicTargetPage } from '../../topics/records'
import type { NamedCompetitor } from '../competitor-context'
import { brandPromptsForCheck, brandSearchesMax } from '../sentiment/capture'
import { errorJob, liveJob } from './job-progress'
import { capNextStep } from './cap-copy'
import { checkCompetitors, type CompetitorLists } from './competitor-match'
import { loadRotationKeys, projectUsedForMonth, type RotationKey } from './key-rotation'
import { CLORO_ATTEMPTS } from './cloro-capture'
import {
  answerEnginesOf,
  cloroAvailable,
  keyPricing,
  resolveProvider,
  runnableEngines,
  selectedEngines,
  type KeyPricing
} from './engines-plan'
import { marketPlans, promptsFromLatest, promptsFromStored, type PagePlan } from './plan'
import { CheckInputError } from './results'

export interface CheckRequest {
  projectId: string
  pageIds: readonly string[]
  marketIds: readonly string[] | null
  promptIds: readonly string[] | null
  /** These engines instead of the page's (a one-question re-check). Null: the page's. */
  engines?: readonly EngineId[] | null
  reason?: 'manual' | 'scheduled' | 'follow_up' | 'catch_up'
  jobId?: string
  /** Continue a stored `running` job. Completed samples are not searched again. */
  resume?: boolean
}

export interface PrepareDeps {
  storage: AppStorage
  now: () => Date
  createId: () => string
}

/**
 * Builds a job before any search: the plan per page and market, the keys, and
 * the cap. A request that cannot run is stored as an `error` job with a next
 * step, and comes back with `db: null`. A resume reloads the stored job.
 */
export interface Prepared {
  job: CheckJob
  db: SqliteDatabase | null
  plan: PagePlan[]
  keys: RotationKey[]
  queueProject: QueueProjectInput
  domain: string
  includeSubdomains: boolean
  brands: readonly string[]
  /**
   * Per page id: the competitors its citations are classified against, those of the
   * page's product (a topic: the topic's product), else the project-wide list
   * (Docs/PROMPT-AUDIT.md P9). Read once when the job starts.
   */
  competitorsByPage: ReadonlyMap<string, CompetitorLists>
  month: string
  projectUsed: number
  reason: 'manual' | 'scheduled' | 'follow_up' | 'catch_up'
  resume: boolean
  /** True when the job was refused before any search because of the project cap (FR-11.4). */
  capBlocked?: boolean
  /** Who runs the Google AI Overview search: cloro when a cloro key is saved, else SerpApi. */
  provider: SearchProvider
  /** True when a cloro key the project may use is on, so answer engines can run. */
  withCloro: boolean
  /** Prices each capture by its key's plan. */
  pricing: KeyPricing
}

export function prepare(
  deps: PrepareDeps,
  jobs: Map<string, CheckJob>,
  slots: Map<string, CheckSearch[]>,
  zone: string,
  request: CheckRequest
): Prepared {
  const project = getProject(deps.storage.db, request.projectId)
  if (project === null) throw new CheckInputError('Unknown project')
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
  const profile = readProjectProfile(db)
  const reason = request.reason ?? 'manual'
  const id = request.jobId ?? deps.createId()
  const existingJob = request.resume === true ? readStoredCheckJob(db, id) : null
  if (request.resume === true && (existingJob === null || existingJob.status !== 'running')) {
    closeProjectDatabase(db)
    throw new CheckInputError('Unknown job')
  }
  const startedAt = existingJob?.startedAt ?? deps.now().toISOString()
  const month = monthKey(deps.now().getTime(), zone)
  const cap = readEffectiveScheduleCap(db, month)
  const queueProject: QueueProjectInput = {
    projectId: project.id,
    name: project.name,
    cap: cap.cap,
    capRule: cap.capRule,
    dedicatedKeyId: cap.dedicatedKeyId,
    paused: false
  }
  const withCloro = cloroAvailable(deps.storage, queueProject)
  const provider = resolveProvider(deps.storage, queueProject, readEngineSettings(db).provider)
  const keys = loadRotationKeys(deps.storage, queueProject, undefined, provider)
  const pricing = keyPricing(deps.storage)
  const projectUsed = projectUsedForMonth(deps.storage, project.id, month)
  const fail = (message: string, nextStep: string | null, total = 0, searchesMax = 0): Prepared => {
    const finishedAt = deps.now().toISOString()
    const job = {
      ...errorJob(
        request,
        id,
        startedAt,
        message,
        nextStep,
        projectUsed,
        cap.cap,
        total,
        searchesMax
      ),
      finishedAt
    }
    if (request.resume === true) {
      finishStoredCheckJob(
        db,
        id,
        finishedAt,
        'error',
        sumStoredJobSearches(db, id),
        message,
        nextStep
      )
    } else {
      insertStoredCheckJob(db, {
        id,
        startedAt,
        status: 'error',
        pageIds: request.pageIds,
        marketIds: request.marketIds,
        promptIds: request.promptIds,
        reason,
        message,
        nextStep
      })
    }
    jobs.set(id, job)
    slots.set(id, [])
    closeProjectDatabase(db)
    return {
      job,
      db: null,
      plan: [],
      keys,
      queueProject,
      domain: project.domain,
      includeSubdomains: profile?.includeSubdomains ?? false,
      brands: profile?.brandNames ?? [],
      competitorsByPage: new Map(),
      month,
      projectUsed,
      reason,
      resume: request.resume === true,
      provider,
      withCloro,
      pricing
    }
  }
  const pages = request.pageIds.map((pageId) => {
    const page = getPage(db, pageId, project.id)
    if (page === null) {
      closeProjectDatabase(db)
      throw new CheckInputError('Unknown page')
    }
    return page
  })
  const resumeRuns = request.resume === true ? listStoredRunsForJob(db, project.id, id) : []
  const resumeSteps = request.resume === true ? listStoredCheckSteps(db, id) : []
  const plan: PagePlan[] = []
  let skippedForCloro = false
  for (const page of pages) {
    const pageRuns = resumeRuns.filter((run) => run.pageId === page.id)
    const anchor = pageRuns.find((run) => run.status === 'running') ?? pageRuns[0] ?? null
    const snapshot = anchor === null ? getLatestSnapshot(db, page.id) : null
    if (anchor === null && snapshot === null) return fail('Read the page before checking it.', null)
    const markets = marketPlans(
      db,
      page.id,
      request.marketIds,
      request.resume === true,
      pageRuns.map((run) => run.marketId)
    )
    const promptSetId = anchor?.promptSetId ?? ''
    const selected =
      anchor === null
        ? promptsFromLatest(db, page.id, profile?.brandNames ?? [], request.promptIds)
        : {
            promptSetId,
            prompts: promptsFromStored(db, page.id, promptSetId, request.promptIds, resumeSteps)
          }
    if (selected.prompts.length === 0) {
      return fail('Save buyer prompts before checking this page.', null)
    }
    const defaultMarketId = page.defaultMarketId ?? markets[0]?.id
    if (markets.length === 0 || defaultMarketId === undefined) continue
    // A resumed run keeps the engines it started with; a new one takes today's choice.
    const only = request.engines ?? null
    const engines = runnableEngines(
      anchor === null
        ? (only ?? selectedEngines(db, page.id))
        : runEngines(db, anchor.id),
      withCloro
    )
    if (engines.length === 0) {
      skippedForCloro = true
      continue
    }
    const google = engines.includes('google_aio')
    plan.push({
      pageId: page.id,
      url: page.url,
      targetPage: page.kind === 'topic' ? getTopicTargetPage(db, page.id) : null,
      ...(page.kind === 'topic' ? { promptTargets: questionTargetPages(db, page.id) } : {}),
      label: page.label ?? page.title ?? page.url ?? page.id,
      samples: anchor?.samples ?? page.samples,
      defaultMarketId,
      snapshotId: anchor?.snapshotId ?? snapshot?.id ?? '',
      contentHash: anchor?.contentHash ?? snapshot?.contentHash ?? '',
      promptSetId: anchor?.promptSetId ?? selected.promptSetId,
      markets,
      prompts: selected.prompts,
      // FR-16.1 brand prompts are Google AI Overview searches: none when Google is off.
      brandPrompts: google ? brandPromptsForCheck(db, page.id, request.promptIds) : [],
      engines
    })
  }
  if (plan.length === 0 && skippedForCloro) {
    return fail('Add a cloro key to check these engines.', 'Open Connections and add a cloro key.')
  }
  if (plan.length === 0) return fail('Add a market before checking this page.', null)
  if (plan.some((page) => page.promptSetId.length === 0)) {
    return fail('Save buyer prompts before checking this page.', null)
  }
  const total = plan.reduce((sum, page) => sum + page.prompts.length * page.markets.length, 0)
  // FR-16.1: brand prompts are shown in the run plan and count toward the cap check.
  const brandMax = plan.reduce(
    (sum, page) => sum + brandSearchesMax(page.brandPrompts, page.markets),
    0
  )
  // Each Google sample is at most two searches; each answer engine at most two cloro attempts.
  const searchesMax =
    brandMax +
    plan.reduce((sum, page) => {
      const perSample =
        (page.engines.includes('google_aio') ? SEARCHES_PER_PROMPT_MAX : 0) +
        answerEnginesOf(page.engines).length * CLORO_ATTEMPTS
      return sum + page.prompts.length * page.markets.length * page.samples * perSample
    }, 0)
  const needsGoogle = plan.some((page) => page.engines.includes('google_aio'))
  if (needsGoogle && keys.length === 0) {
    return fail(
      provider === 'cloro'
        ? 'Add a cloro key before checking.'
        : 'Add a SerpApi key before checking.',
      provider === 'cloro'
        ? 'Open Connections and add a cloro key.'
        : 'Open Connections and add a SerpApi key.',
      total,
      searchesMax
    )
  }
  if (
    request.resume !== true &&
    cap.cap !== null &&
    projectUsed + searchesMax > capAllowance(cap.cap, cap.capRule)
  ) {
    return {
      ...fail(
        "This check would pass the project's search cap.",
        capNextStep(cap.capRule, month),
        total,
        searchesMax
      ),
      capBlocked: true
    }
  }
  const job: CheckJob = {
    ...liveJob(request, id, startedAt, projectUsed, cap.cap, total, searchesMax, plan, brandMax),
    engines: jobEngines(plan),
    provider: needsGoogle ? provider : null,
    creditsUsed: 0,
    costMicros: 0
  }
  if (request.resume === true) job.searchesUsed = sumStoredJobSearches(db, id)
  else {
    insertStoredCheckJob(db, {
      id,
      startedAt,
      status: 'running',
      pageIds: request.pageIds,
      marketIds: request.marketIds,
      promptIds: request.promptIds,
      reason,
      message: null,
      nextStep: null
    })
  }
  jobs.set(id, job)
  slots.set(id, [])
  return {
    job,
    db,
    plan,
    keys,
    queueProject,
    domain: project.domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    brands: profile?.brandNames ?? [],
    competitorsByPage: new Map(pages.map((page) => [page.id, checkCompetitors(db, page)])),
    month,
    projectUsed,
    reason,
    resume: request.resume === true,
    provider,
    withCloro,
    pricing
  }
}

/** Every engine some page of the job checks, in display order. */
function jobEngines(plan: readonly PagePlan[]): EngineId[] {
  const all = new Set(plan.flatMap((page) => page.engines))
  return ENGINE_IDS.filter((engine) => all.has(engine))
}

/** The competitors one page's citations are classified against, direct then partial. */
export function competitorsOf(prepared: Prepared, pageId: string): readonly NamedCompetitor[] {
  const lists = prepared.competitorsByPage.get(pageId)
  return lists === undefined ? [] : [...lists.direct, ...lists.partial]
}
