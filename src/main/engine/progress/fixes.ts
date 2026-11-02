import {
  fixVerdictLabel,
  type FixList,
  type FixPlanPreview,
  type FixRecheckRule,
  type LoggedFix
} from '@shared/domain'
import { resolveTargetPage } from '@shared/target-page'
import type {
  CheckJob,
  CreateFixRequest,
  FixIdRequest,
  FixListRequest,
  FixPreviewRequest,
  ProjectIdRequest,
  ProjectFixList,
  RunFollowUpResult,
  UpdateFixRequest
} from '@shared/ipc'
import { checkCatalogCache } from '../../headless/catalog-cache'
import { readStoredCheckCatalog } from '../../headless/storage-pass'
import { IpcRequestError } from '../../ipc-request'
import { followUpRawAt } from '../../scheduler/follow-up'
import { FIX_FOLLOW_UP_DAY_OPTIONS, MS_PER_DAY } from '../../scheduler/intervals'
import type { AppStorage } from '../../storage/app-storage'
import type { SqliteDatabase } from '../../storage/database'
import {
  createFixFollowUp,
  deleteFixFollowUp,
  getFixFollowUp,
  listFixFollowUps,
  nextFixNumber,
  setFixFollowUpJob,
  setFixFollowUpRun,
  updateFixFollowUp,
  type FixFollowUpRecord
} from '../../storage/fix-follow-ups'
import { getPage, listPageMarkets, listPages } from '../../storage/pages'
import type { CheckEngine } from '../checks/engine'
import type { CheckRequest } from '../checks/prepare'
import type { EngineHost } from '../host'
import { fixMeasureReader } from '../fix-loop/measure'
import { withProject } from '../project-db'
import { outcomeReader } from './fix-outcomes'
import { projectFixList } from './project-fixes'

/**
 * FR-14.5 to FR-14.7, SCH-10. Logging a fix plans its follow-up through the
 * scheduler's catalog (a planned row in `fixes`); "Run follow-up now" starts the
 * same partial check at once. Verdicts are read from stored runs only.
 */
export interface FixesDeps {
  host: Pick<EngineHost, 'storage' | 'now' | 'createId' | 'logger'>
  checks: Pick<CheckEngine, 'start' | 'get' | 'listActive'>
  /** The computer's zone for "next scheduled check". Defaults to the system zone. */
  timeZone?: () => string
}

export interface FixesService {
  list(request: FixListRequest): Promise<FixList>
  /** Every fix on every open page and topic, with the open content-gap suggestions. */
  listProject(request: ProjectIdRequest): Promise<ProjectFixList>
  preview(request: FixPreviewRequest): Promise<FixPlanPreview>
  create(request: CreateFixRequest): Promise<LoggedFix>
  runFollowUp(request: FixIdRequest): Promise<RunFollowUpResult>
  remove(request: FixIdRequest): Promise<FixList>
  /** Edits a fix; date, rule, prompts or markets re-plan its follow-up. */
  update(request: UpdateFixRequest): Promise<LoggedFix>
  /** Puts back a fix `remove` deleted in this session (Undo). */
  restore(request: FixIdRequest): Promise<LoggedFix>
  /** Resolves when every follow-up started here has finished and been linked. Tests and shutdown. */
  idle(): Promise<void>
}

export function createFixesService(deps: FixesDeps): FixesService {
  const { host } = deps
  const zone = deps.timeZone ?? systemTimeZone
  const pending = new Set<Promise<void>>()
  /** Fixes deleted in this session, by `projectId:fixId`, for Undo. */
  const deleted = new Map<string, FixFollowUpRecord>()

  function project<T>(
    projectId: string,
    channel: string,
    run: (db: SqliteDatabase, domain: string) => T
  ): Promise<T> {
    return withProject(host as EngineHost, projectId, channel, ({ db, project: record }) =>
      run(db, record.domain)
    )
  }

  function loggedFixes(
    db: SqliteDatabase,
    projectId: string,
    domain: string,
    records: readonly FixFollowUpRecord[]
  ): LoggedFix[] {
    const reader = outcomeReader(db, projectId, domain, host.now().toISOString())
    const measures = fixMeasureReader(db, projectId)
    const active = new Set(deps.checks.listActive(projectId).map((job) => job.id))
    return records.map((stored) => {
      const record = reconcile(db, stored, reader, active)
      const markets = reader.outcomes(record)
      const status =
        record.followUpRunId !== null
          ? 'completed'
          : record.followUpJobId !== null
            ? 'started'
            : 'planned'
      return {
        id: record.id,
        pageId: record.pageId,
        number: record.number,
        kind: record.kind,
        description: record.description,
        goLiveAt: record.goLiveAt,
        rule: record.rule,
        promptIds: record.promptIds,
        marketIds: record.marketIds,
        status,
        followUpAt:
          status === 'planned' ? followUpAt(host.storage, projectId, record, zone()) : null,
        followUpJobId: record.followUpJobId,
        followUpRunId: record.followUpRunId,
        createdAt: record.createdAt,
        verdict: record.verdict,
        markets,
        url: record.url,
        pageFixId: record.pageFixId,
        measure: measures.measure(record)
      }
    })
  }

  /**
   * Links a "Run follow-up now" job whose runs finished while nobody listened
   * (the app quit, or the window was closed), or frees a job that ended with
   * no finished run so the scheduler plans the follow-up again.
   */
  function reconcile(
    db: SqliteDatabase,
    record: FixFollowUpRecord,
    reader: ReturnType<typeof outcomeReader>,
    active: ReadonlySet<string>
  ): FixFollowUpRecord {
    if (record.followUpRunId !== null || record.followUpJobId === null) return record
    if (active.has(record.followUpJobId)) return record
    const runs = reader.followUpRuns(record)
    const first = runs[0]
    if (first === undefined) {
      const status = jobStatus(db, record.followUpJobId)
      if (status === 'running') return record
      return setFixFollowUpJob(db, record.id, null)
    }
    const linked = setFixFollowUpRun(db, record.id, first.id)
    const outcome = reader.outcomes(linked)[0]
    const verdict =
      outcome === undefined || outcome.verdict === 'waiting'
        ? null
        : fixVerdictLabel(outcome.verdict, outcome.worked, outcome.compared)
    checkCatalogCache(host.storage).invalidate()
    return setFixFollowUpRun(db, record.id, first.id, verdict)
  }

  async function list(request: FixListRequest): Promise<FixList> {
    return project(request.projectId, 'fixes:list', (db, domain) => {
      requireOpenPage(db, request.projectId, request.pageId, 'fixes:list')
      return {
        pageId: request.pageId,
        fixes: loggedFixes(db, request.projectId, domain, listFixFollowUps(db, request.pageId)),
        nextFixNumber: nextFixNumber(db, request.pageId)
      }
    })
  }

  async function listProject(request: ProjectIdRequest): Promise<ProjectFixList> {
    return project(request.projectId, 'fixes:listProject', (db, domain) => {
      const pages = listPages(db, request.projectId).filter((page) => page.status !== 'removed')
      const open = new Set(pages.map((page) => page.id))
      const records = listFixFollowUps(db).filter((record) => open.has(record.pageId))
      return projectFixList(db, request.projectId, pages, {
        fixes: loggedFixes(db, request.projectId, domain, records),
        cost: (fix, samples) =>
          followUpSearches(db, fix.pageId, fix.promptIds, fix.marketIds, samples)
      })
    })
  }

  async function preview(request: FixPreviewRequest): Promise<FixPlanPreview> {
    return project(request.projectId, 'fixes:preview', (db) => {
      const page = requireOpenPage(db, request.projectId, request.pageId, 'fixes:preview')
      const onPage = new Set(listPageMarkets(db, request.pageId).map((link) => link.marketId))
      const { searchesMin } = followUpSearches(
        db,
        request.pageId,
        request.promptIds,
        request.marketIds,
        page.samples
      )
      const draft = {
        id: 'preview',
        pageId: request.pageId,
        goLiveAt: request.goLiveAt,
        marketIds: request.marketIds.filter((id) => onPage.has(id))
      }
      const at = (rule: FixRecheckRule): string | null =>
        followUpAt(host.storage, request.projectId, { ...draft, rule }, zone())
      return {
        nextFixNumber: nextFixNumber(db, request.pageId),
        followUpAt: {
          after_3_days: dayOffset(request.goLiveAt, FIX_FOLLOW_UP_DAY_OPTIONS[0]),
          after_7_days: dayOffset(request.goLiveAt, FIX_FOLLOW_UP_DAY_OPTIONS[1]),
          next_scheduled: at('next_scheduled')
        },
        samples: page.samples,
        searchesMin,
        searchesMax: searchesMin * 2
      }
    })
  }

  async function create(request: CreateFixRequest): Promise<LoggedFix> {
    return project(request.projectId, 'fixes:create', (db, domain) => {
      requireOpenPage(db, request.projectId, request.pageId, 'fixes:create')
      requireActivePrompts(db, request.promptIds)
      const url = request.url === undefined ? undefined : resolveTargetPage(request.url, domain)
      if (url === null) {
        throw new IpcRequestError('fixes:create', 'Use the address of a page on your own site')
      }
      const record = createFixFollowUp(db, {
        id: host.createId(),
        pageId: request.pageId,
        description: request.description,
        goLiveAt: request.goLiveAt,
        rule: request.rule,
        promptIds: request.promptIds,
        marketIds: request.marketIds,
        createdAt: host.now().toISOString(),
        kind: request.kind ?? 'fix',
        ...(url !== undefined ? { url } : {}),
        ...(request.pageFixId !== undefined ? { pageFixId: request.pageFixId } : {})
      })
      checkCatalogCache(host.storage).invalidate()
      const [logged] = loggedFixes(db, request.projectId, domain, [record])
      if (logged === undefined) throw new IpcRequestError('fixes:create', 'Could not save the fix')
      return logged
    })
  }

  async function runFollowUp(request: FixIdRequest): Promise<RunFollowUpResult> {
    const channel = 'fixes:runFollowUp'
    const planned = await project(request.projectId, channel, (db) => {
      const fix = getFixFollowUp(db, request.fixId)
      if (fix === null) throw new IpcRequestError(channel, 'That fix was not found')
      requireOpenPage(db, request.projectId, fix.pageId, channel)
      const running = deps.checks
        .listActive(request.projectId)
        .some((job) => job.id === fix.followUpJobId)
      if (running)
        throw new IpcRequestError(channel, 'The follow-up for this fix is already running')
      const onPage = new Set(listPageMarkets(db, fix.pageId).map((link) => link.marketId))
      const marketIds = fix.marketIds.filter((id) => onPage.has(id))
      if (marketIds.length === 0) {
        throw new IpcRequestError(channel, 'None of this fix’s markets are on the page any more')
      }
      const jobId = host.createId()
      setFixFollowUpJob(db, fix.id, jobId)
      checkCatalogCache(host.storage).invalidate()
      return { fix, jobId, marketIds, pageIds: promptPages(db, fix) }
    })
    // Each page or topic asks its own of the fix's searches (a check skips the rest).
    const checkRequest: CheckRequest = {
      projectId: request.projectId,
      pageIds: planned.pageIds,
      marketIds: planned.marketIds,
      promptIds: planned.fix.promptIds,
      reason: 'follow_up',
      jobId: planned.jobId
    }
    const started = deps.checks.start(checkRequest)
    const immediate = jobOrNull(deps.checks, planned.jobId)
    if (immediate === null || immediate.status !== 'running') {
      // The check could not start (no key, cap reached, …). Free the fix so the
      // scheduler plans it again, and say why.
      const job = await started.catch((error: unknown) => {
        throw error instanceof Error ? error : new Error('The follow-up could not start.')
      })
      await project(request.projectId, channel, (db) => {
        setFixFollowUpJob(db, planned.fix.id, null)
        checkCatalogCache(host.storage).invalidate()
      })
      if (job.status !== 'finished') {
        throw new IpcRequestError(
          channel,
          job.message ?? 'The follow-up could not start.',
          job.nextStep
        )
      }
    }
    const settle = started
      .then(() => link(request.projectId, planned.fix.id))
      .catch((error: unknown) => {
        host.logger.error('fix follow-up failed', {
          message: error instanceof Error ? error.message : 'unknown'
        })
      })
      .finally(() => {
        pending.delete(settle)
      })
    pending.add(settle)
    const fix = await project(request.projectId, channel, (db, domain) => {
      const stored = getFixFollowUp(db, planned.fix.id)
      if (stored === null) throw new IpcRequestError(channel, 'That fix was not found')
      const [logged] = loggedFixes(db, request.projectId, domain, [stored])
      if (logged === undefined) throw new IpcRequestError(channel, 'That fix was not found')
      return logged
    })
    return { fix, jobId: planned.jobId }
  }

  /** After the follow-up job settles: link its run and store the verdict. */
  async function link(projectId: string, fixId: string): Promise<void> {
    await project(projectId, 'fixes:runFollowUp', (db, domain) => {
      const stored = getFixFollowUp(db, fixId)
      if (stored === null) return
      loggedFixes(db, projectId, domain, [stored])
    })
  }

  async function remove(request: FixIdRequest): Promise<FixList> {
    const channel = 'fixes:delete'
    return project(request.projectId, channel, (db, domain) => {
      const fix = getFixFollowUp(db, request.fixId)
      if (fix === null) throw new IpcRequestError(channel, 'That fix was not found')
      const running = deps.checks
        .listActive(request.projectId)
        .some((job) => job.id === fix.followUpJobId)
      if (running) {
        throw new IpcRequestError(channel, 'Wait for the follow-up to finish before deleting')
      }
      deleteFixFollowUp(db, fix.id)
      deleted.set(`${request.projectId}:${fix.id}`, fix)
      checkCatalogCache(host.storage).invalidate()
      return {
        pageId: fix.pageId,
        fixes: loggedFixes(db, request.projectId, domain, listFixFollowUps(db, fix.pageId)),
        nextFixNumber: nextFixNumber(db, fix.pageId)
      }
    })
  }

  async function update(request: UpdateFixRequest): Promise<LoggedFix> {
    const channel = 'fixes:update'
    return project(request.projectId, channel, (db, domain) => {
      const fix = getFixFollowUp(db, request.fixId)
      if (fix === null) throw new IpcRequestError(channel, 'That fix was not found')
      requireOpenPage(db, request.projectId, fix.pageId, channel)
      const plan =
        (request.goLiveAt !== undefined && request.goLiveAt !== fix.goLiveAt) ||
        (request.rule !== undefined && request.rule !== fix.rule) ||
        (request.promptIds !== undefined && !sameIds(request.promptIds, fix.promptIds)) ||
        (request.marketIds !== undefined && !sameIds(request.marketIds, fix.marketIds))
      if (plan && (fix.followUpJobId !== null || fix.followUpRunId !== null)) {
        throw new IpcRequestError(
          channel,
          'The follow-up already started, so only the description can change. Log a new fix to check other questions or dates.'
        )
      }
      if (request.promptIds !== undefined) {
        const added = request.promptIds.filter((id) => !fix.promptIds.includes(id))
        requireActivePrompts(db, added, channel)
      }
      const record = updateFixFollowUp(db, fix.id, {
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.kind !== undefined ? { kind: request.kind } : {}),
        ...(request.goLiveAt !== undefined ? { goLiveAt: request.goLiveAt } : {}),
        ...(request.rule !== undefined ? { rule: request.rule } : {}),
        ...(request.promptIds !== undefined ? { promptIds: request.promptIds } : {}),
        ...(request.marketIds !== undefined ? { marketIds: request.marketIds } : {})
      })
      checkCatalogCache(host.storage).invalidate()
      const [logged] = loggedFixes(db, request.projectId, domain, [record])
      if (logged === undefined) throw new IpcRequestError(channel, 'Could not save the fix')
      return logged
    })
  }

  async function restore(request: FixIdRequest): Promise<LoggedFix> {
    const channel = 'fixes:restore'
    const key = `${request.projectId}:${request.fixId}`
    const gone = deleted.get(key)
    if (gone === undefined) {
      throw new IpcRequestError(channel, 'That fix can no longer be put back')
    }
    return project(request.projectId, channel, (db, domain) => {
      if (getFixFollowUp(db, gone.id) !== null) {
        throw new IpcRequestError(channel, 'That fix is already back')
      }
      requireOpenPage(db, request.projectId, gone.pageId, channel)
      const taken = listFixFollowUps(db, gone.pageId).some((fix) => fix.number === gone.number)
      createFixFollowUp(db, {
        id: gone.id,
        pageId: gone.pageId,
        description: gone.description,
        kind: gone.kind,
        goLiveAt: gone.goLiveAt,
        rule: gone.rule,
        promptIds: gone.promptIds,
        marketIds: gone.marketIds,
        ...(taken ? {} : { number: gone.number }),
        ...(gone.createdAt !== null ? { createdAt: gone.createdAt } : {})
      })
      const record =
        gone.followUpRunId !== null
          ? setFixFollowUpRun(db, gone.id, gone.followUpRunId, gone.verdict)
          : getFixFollowUp(db, gone.id)
      deleted.delete(key)
      checkCatalogCache(host.storage).invalidate()
      const [logged] = record ? loggedFixes(db, request.projectId, domain, [record]) : []
      if (logged === undefined) throw new IpcRequestError(channel, 'Could not put the fix back')
      return logged
    })
  }

  return {
    list,
    listProject,
    preview,
    create,
    runFollowUp,
    remove,
    update,
    restore,
    async idle(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending])
    }
  }
}

/**
 * FR-14.5, FR-14.6. Searches a follow-up of these prompts uses: prompts × the markets
 * still on the page × samples, up to twice that when an overview needs its second call.
 */
function followUpSearches(
  db: SqliteDatabase,
  pageId: string,
  promptIds: readonly string[],
  marketIds: readonly string[],
  samples: number
): { searchesMin: number; searchesMax: number } {
  const onPage = new Set(listPageMarkets(db, pageId).map((link) => link.marketId))
  const markets = marketIds.filter((id) => onPage.has(id)).length
  const searchesMin = promptIds.length * markets * samples
  return { searchesMin, searchesMax: searchesMin * 2 }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function requireOpenPage(
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  channel: string
): { samples: number } {
  const page = getPage(db, pageId, projectId)
  if (page === null || page.status === 'removed') {
    throw new IpcRequestError(channel, 'That page is not in this project')
  }
  return { samples: page.samples }
}

/**
 * Targeted prompts must be enabled prompts of an active set (SCH-5) of an open page or
 * topic in the project: a page fix's searches often come from its topics.
 */
function requireActivePrompts(
  db: SqliteDatabase,
  promptIds: readonly string[],
  channel = 'fixes:create'
): void {
  if (promptIds.length === 0) return
  const rows = db
    .prepare<unknown[], { id: string }>(
      `SELECT prompts.id FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
       JOIN pages ON pages.id = prompt_sets.page_id
       WHERE prompt_sets.is_active = 1 AND prompts.enabled = 1 AND pages.status != 'removed'
         AND prompts.id IN (${promptIds.map(() => '?').join(', ')})`
    )
    .all(...promptIds)
  const allowed = new Set(rows.map((row) => row.id))
  if (!promptIds.every((id) => allowed.has(id))) {
    throw new IpcRequestError(channel, 'Pick prompts from the current prompt set')
  }
}

/** The pages and topics that ask a fix's searches, the fix's own page first. */
function promptPages(db: SqliteDatabase, fix: FixFollowUpRecord): string[] {
  const rows = db
    .prepare<unknown[], { page_id: string }>(
      `SELECT DISTINCT prompt_sets.page_id FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
       JOIN pages ON pages.id = prompt_sets.page_id
       WHERE pages.status != 'removed'
         AND prompts.id IN (${fix.promptIds.map(() => '?').join(', ')})`
    )
    .all(...fix.promptIds)
  const owners = rows.map((row) => row.page_id).filter((id) => id !== fix.pageId)
  return rows.some((row) => row.page_id === fix.pageId) || owners.length === 0
    ? [fix.pageId, ...owners]
    : owners
}

/**
 * SCH-10. When the follow-up is planned: the earliest market's instant from the
 * scheduler's own rule. A page the scheduler does not plan (paused, not tracked)
 * still gets the day offsets; "next scheduled" is null for it.
 */
function followUpAt(
  storage: AppStorage,
  projectId: string,
  fix: {
    id: string
    pageId: string
    goLiveAt: string
    rule: FixRecheckRule
    marketIds: readonly string[]
  },
  timeZone: string
): string | null {
  const catalog = readStoredCheckCatalog(storage).catalog
  const page = catalog.pages.find(
    (item) => item.projectId === projectId && item.pageId === fix.pageId
  )
  const schedule = catalog.projects.find((item) => item.projectId === projectId)
  if (page === undefined || schedule === undefined || page.status !== 'tracked') {
    if (fix.rule === 'after_3_days') return dayOffset(fix.goLiveAt, FIX_FOLLOW_UP_DAY_OPTIONS[0])
    if (fix.rule === 'after_7_days') return dayOffset(fix.goLiveAt, FIX_FOLLOW_UP_DAY_OPTIONS[1])
    return null
  }
  const input = {
    id: fix.id,
    projectId,
    pageId: fix.pageId,
    description: 'preview',
    goLiveAt: fix.goLiveAt,
    rule: fix.rule,
    promptIds: ['preview'],
    marketIds: fix.marketIds
  }
  let earliest: number | null = null
  for (const market of page.markets) {
    if (!fix.marketIds.includes(market.marketId)) continue
    try {
      const at = followUpRawAt(input, page, market, schedule, timeZone)
      if (earliest === null || at < earliest) earliest = at
    } catch {
      // A market the scheduler cannot plan is left out of the date.
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString()
}

function dayOffset(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * MS_PER_DAY).toISOString()
}

function jobOrNull(checks: Pick<CheckEngine, 'get'>, jobId: string): CheckJob | null {
  try {
    return checks.get(jobId)
  } catch {
    return null
  }
}

function jobStatus(db: SqliteDatabase, jobId: string): string | null {
  const row = db
    .prepare<unknown[], { status: string }>(`SELECT status FROM check_jobs WHERE id = ?`)
    .get(jobId)
  return row?.status ?? null
}

function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length > 0 ? zone : 'UTC'
}
