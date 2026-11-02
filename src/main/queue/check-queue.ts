import { createHash } from 'node:crypto'
import { DEFAULT_CLAUDE_CONCURRENCY, DEFAULT_SERPAPI_ROTATION } from '@shared/domain'
import { RETRY_DELAY_CAP_MS, parseRetryAfter, retryDelayMs } from '../providers/retry'
import type { SerpApiRotationMode } from '@shared/domain'
import { formatInstant, parseInstant } from '../scheduler/clock-time'
import type { Clock } from '../scheduler/clock'
import { assertTimeZone, localDateKey, monthKey } from '../scheduler/local-time'
import type { DueList, DuePage } from '../scheduler/types'
import { QueueError } from './errors'
import { memoryQueuePauseStore, type StoredQueuePause } from './pause-store'
import type {
  CapRule,
  CheckDueResult,
  FailoverReason,
  CapAlert,
  KeyEvent,
  MonthUsageSeed,
  QueueKeyInput,
  QueueOptions,
  QueuePauseScope,
  QueueProjectInput,
  QueueState,
  QueueStatus,
  QueueWork,
  RunningJob
} from './types'
import { UsageLedger, capAllowance, nextKeyAfter } from './usage'

export { capAllowance }

interface WaitingItem extends QueueWork {
  enqueuedAt: number
  partial: boolean
}

interface SlotState {
  pendingKeyId: string | null
  anchorKeyId: string | null
  failoverUsed: boolean
}

interface ActiveJob {
  work: WaitingItem
  startedAt: number
  cancelRequested: boolean
  slots: Map<string, SlotState>
}

export interface DequeueBlock {
  ok: false
  reason:
    | 'paused_all'
    | 'paused_today'
    | 'paused_project'
    | 'empty'
    | 'not_before'
    | 'claude_concurrency'
    | 'project_cap'
    | 'keys_exhausted'
    | 'dedicated_key_unavailable'
  capRule?: CapRule
}

export type DequeueResult = { ok: true; job: RunningJob } | DequeueBlock

/** Why one waiting item could not start on the last `dequeue`. */
export interface DequeueSkip {
  projectId: string
  pageId: string
  reason: Exclude<DequeueBlock['reason'], 'paused_all' | 'paused_today' | 'empty' | 'not_before'>
  capRule?: CapRule
}

/**
 * What the last `dequeue` saw in the waiting list.
 * `nextRunAt` is the earliest `notBefore` still in the future (epoch ms), or null.
 * `skipped` lists items that were due but held for their own project or page,
 * so a caller can keep going for the other projects.
 * `busy` counts items left waiting because their page is already being checked.
 */
export interface DequeueScan {
  nextRunAt: number | null
  skipped: readonly DequeueSkip[]
  busy: number
}

export interface SearchCommit {
  ok: true
  keyId: string
  overCap: boolean
  keyUsed: number
  projectUsed: number
  month: string
}

export type SearchResult =
  | SearchCommit
  | {
      ok: false
      reason:
        | 'not_running'
        | 'missing_slot'
        | 'project_cap'
        | 'keys_exhausted'
        | 'dedicated_key_unavailable'
      capRule?: CapRule
    }

export type FailoverResult =
  | { ok: true; keyId: string }
  | {
      ok: false
      reason:
        | 'not_running'
        | 'missing_slot'
        | 'failover_exhausted'
        | 'already_committed'
        | 'dedicated_key'
        | 'keys_exhausted'
    }

export type RateLimitResult =
  | { ok: true; notBefore: string; attempt: number; delayMs: number }
  | { ok: false; reason: 'not_running' }

export interface CheckQueue {
  status(): QueueStatus
  setKeys(keys: readonly QueueKeyInput[]): void
  setProjects(projects: readonly QueueProjectInput[]): void
  /** Raise committed usage to stored month-to-date rows. Does not add them twice. */
  syncUsage(seed: readonly MonthUsageSeed[]): void
  setClaudeConcurrency(value: number): void
  /** The computer's zone changed (travel, DST rules). "Today" and the month follow it. */
  setTimeZone(zone: string): void
  setTrayRunning(value: boolean): void
  setHeadlessJob(value: boolean): void
  setPagesDue(count: number): void
  enqueue(
    work: QueueWork
  ): { ok: true; id: string } | { ok: false; reason: 'duplicate_id' | 'already_queued' }
  checkDue(list: DueList, estimateSearches?: (page: DuePage) => number): CheckDueResult
  pause(scope: QueuePauseScope): QueueStatus
  resume(): QueueStatus
  dequeue(): DequeueResult
  /** The waiting-list facts the last `dequeue` saw. Read-only. */
  lastScan(): DequeueScan
  /**
   * Drops waiting items made by `checkDue` (ids from {@link dueJobId}) that `keep`
   * rejects, for example a page a manual check has since covered. Returns their ids.
   */
  pruneDue(keep: (work: QueueWork) => boolean): readonly string[]
  takeKey(jobId: string, slotId: string): SearchResult
  commitSearch(jobId: string, slotId: string): SearchResult
  failSearch(
    jobId: string,
    slotId: string,
    input: { reason: FailoverReason; countFailedSearch: boolean }
  ): FailoverResult
  /**
   * A provider reported `rate_limited`. The job goes back to waiting.
   * `retryAfter` is the Retry-After header (seconds or an HTTP-date).
   * When it is missing or unusable, the wait is exponential and capped
   * at the engine retry cap. No requests-per-second setting is stored.
   */
  rateLimit(jobId: string, input?: { retryAfter?: string }): RateLimitResult
  commitFollowUp(jobId: string, slotId: string): SearchResult
  /**
   * Count a search the runner already wrote to `key_usage` with `keyId`, the key
   * that made it. Used for engine searches, which are stored as they happen.
   */
  commitCharged(jobId: string, keyId: string): SearchResult
  complete(
    jobId: string
  ): { ok: true; status: 'completed' | 'cancelled' } | { ok: false; reason: 'not_running' }
  cancel(
    jobId: string
  ): { ok: true; state: 'removed' | 'cancel_requested' } | { ok: false; reason: 'missing' }
  cancelWaiting(): readonly string[]
  drainEvents(): readonly KeyEvent[]
}

/**
 * Shared check queue (SCH-11). One instance serves every project.
 * Pause lets a running job finish and starts nothing further (decision 4, decision 10).
 * `paused_today` clears at the next local midnight. `paused_all` stays until resume.
 * AIO follow-up calls are not queued (section 2.3, FR-5.2). `commitFollowUp` only counts
 * the search on the key that already ran, in the same job.
 */
export function createCheckQueue(options: QueueOptions): CheckQueue {
  const clock: Clock = options.clock
  let timeZone = options.timeZone
  assertTimeZone(timeZone)
  let claudeConcurrency = options.claudeConcurrency ?? DEFAULT_CLAUDE_CONCURRENCY
  if (!Number.isInteger(claudeConcurrency) || claudeConcurrency < 1) {
    throw new QueueError('Claude concurrency must be a positive integer')
  }
  let trayRunning = options.trayRunning ?? false
  let headlessJob = options.headlessJob ?? false
  const rotationOption = options.rotation ?? DEFAULT_SERPAPI_ROTATION
  const currentRotation = (): SerpApiRotationMode =>
    typeof rotationOption === 'function' ? rotationOption() : rotationOption
  let keys = [...options.keys]
  let projects = [...options.projects]
  let pagesDue = 0
  let state: QueueState = 'running'
  const pauseStore = options.pauseStore ?? memoryQueuePauseStore()
  let passDay: string | null = null
  let passJobIds: readonly string[] | null = null
  let passPages = 0
  let sequence = 0
  const waiting: WaitingItem[] = []
  const running = new Map<string, ActiveJob>()
  const rateLimitAttempts = new Map<string, number>()
  const capAlerts = new Set<string>()
  const ledger = new UsageLedger(options.usageSeed, options.persistSearch)
  let scan: DequeueScan = { nextRunAt: null, skipped: [], busy: 0 }

  function alertCap(project: QueueProjectInput, month: string, at: number): void {
    if (project.capRule !== 'notify' || project.cap === null) return
    const id = `${project.projectId}\0${month}`
    if (capAlerts.has(id)) return
    capAlerts.add(id)
    const alert: CapAlert = {
      at: formatInstant(at),
      projectId: project.projectId,
      name: project.name,
      used: ledger.projectUsed(project.projectId, month),
      cap: project.cap,
      month
    }
    options.onCapAlert?.(alert)
  }

  function nowMs(): number {
    const value = clock.now()
    if (!Number.isFinite(value)) throw new QueueError('Clock time must be a finite number')
    return value
  }

  /**
   * Reads the shared pause row, so a pause or resume made by the tray, the
   * renderer, or another process is seen here. A today-pause from an earlier
   * local date has expired and is cleared.
   */
  function expireTodayPause(at: number): void {
    const stored = pauseStore.read()
    if (stored === null) {
      state = 'running'
      return
    }
    if (stored.state === 'paused_all') {
      state = 'paused_all'
      return
    }
    if (localDateKey(at, timeZone) > stored.day) {
      pauseStore.write(null)
      state = 'running'
      return
    }
    state = 'paused_today'
  }

  function storePause(next: StoredQueuePause | null): void {
    pauseStore.write(next)
  }

  function projectOf(projectId: string): QueueProjectInput {
    const project = projects.find((item) => item.projectId === projectId)
    if (project === undefined) throw new QueueError(`No cap record for project ${projectId}`)
    return project
  }

  function keyOf(keyId: string): QueueKeyInput {
    const key = keys.find((item) => item.keyId === keyId)
    if (key === undefined) throw new QueueError(`Unknown key ${keyId}`)
    return key
  }

  function status(): QueueStatus {
    const at = nowMs()
    expireTodayPause(at)
    const month = monthKey(at, timeZone)
    const claudeInFlight = [...running.values()].filter((job) => job.work.needsClaude).length
    const next = waiting
      .map((item) => parseInstant(item.notBefore, 'notBefore'))
      .sort((a, b) => a - b)[0]
    return {
      state,
      running: running.size,
      waiting: waiting.length,
      claudeConcurrency,
      claudeInFlight,
      trayRunning,
      headlessJob,
      nextRunAt: state === 'running' && next !== undefined ? formatInstant(next) : null,
      pagesDue,
      keys: [...keys]
        .sort((a, b) => a.rotationOrder - b.rotationOrder || (a.keyId < b.keyId ? -1 : 1))
        .map((key) => ({
          keyId: key.keyId,
          name: key.name,
          provider: key.provider,
          used: ledger.keyUsed(key.keyId, month),
          cap: key.cap,
          planLimit: key.planLimit,
          state: key.state
        })),
      projects: [...projects]
        .sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0))
        .map((project) => ({
          projectId: project.projectId,
          name: project.name,
          used: ledger.projectUsed(project.projectId, month),
          cap: project.cap,
          capRule: project.capRule,
          dedicatedKeyId: project.dedicatedKeyId,
          paused: project.paused
        }))
    }
  }

  function enqueue(
    work: QueueWork
  ): { ok: true; id: string } | { ok: false; reason: 'duplicate_id' | 'already_queued' } {
    validateWork(work)
    projectOf(work.projectId)
    if (waiting.some((item) => item.id === work.id) || running.has(work.id)) {
      return { ok: false, reason: 'duplicate_id' }
    }
    if (work.reason !== 'manual' && sameQueued(work)) return { ok: false, reason: 'already_queued' }
    sequence += 1
    waiting.push({
      ...work,
      marketIds: [...work.marketIds],
      promptIds: work.promptIds === null ? null : [...work.promptIds],
      enqueuedAt: sequence,
      partial: work.reason === 'follow_up' || work.topicBatchId !== undefined
    })
    return { ok: true, id: work.id }
  }

  function sameQueued(work: QueueWork): boolean {
    const markets = [...work.marketIds].sort().join('\0')
    return [...waiting, ...[...running.values()].map((job) => job.work)].some((item) => {
      if (item.reason === 'manual' || item.reason !== work.reason) return false
      if (item.projectId !== work.projectId || item.pageId !== work.pageId) return false
      if ([...item.marketIds].sort().join('\0') !== markets) return false
      if (work.reason === 'follow_up') return item.fixId === work.fixId
      if (item.topicBatchId !== undefined || work.topicBatchId !== undefined) {
        return item.topicBatchId === work.topicBatchId
      }
      return true
    })
  }

  function checkDue(list: DueList, estimateSearches?: (page: DuePage) => number): CheckDueResult {
    const at = nowMs()
    const today = localDateKey(at, timeZone)
    if (list.day !== today) throw new QueueError('Due list day does not match the local date')
    const estimate = estimateSearches ?? ((): number => 0)
    // An empty pass did not check anything. A page set up later the same day
    // still has to run. A pass that enqueued work stays idempotent (SCH-2).
    const prior =
      passDay === today && passJobIds !== null && (passJobIds.length > 0 || passPages > 0)
        ? passJobIds
        : null
    const covered = prior === null ? null : new Set(prior)
    const fresh =
      covered === null
        ? list.pages
        : list.pages.filter((page) => !covered.has(dueJobId(today, page)))
    if (prior !== null && fresh.length === 0) {
      return { started: false, jobIds: prior, pages: passPages }
    }
    const ids: string[] = []
    for (const page of fresh) {
      if (options.pageRunning?.(page.projectId, page.pageId) === true) continue
      const id = dueJobId(today, page)
      const result = enqueue({
        id,
        projectId: page.projectId,
        pageId: page.pageId,
        marketIds: page.marketIds,
        reason: page.reason,
        promptIds: page.promptIds,
        fixId: page.reason === 'follow_up' ? page.fixId : undefined,
        ...(page.topicBatchId !== undefined ? { topicBatchId: page.topicBatchId } : {}),
        needsClaude: false,
        maxSearches: estimate(page),
        notBefore: page.dueAt
      })
      if (!result.ok) {
        ids.push(id)
        continue
      }
      ids.push(result.id)
    }
    passDay = today
    passJobIds = prior === null ? ids : [...prior, ...ids]
    passPages = prior === null ? fresh.length : passPages + fresh.length
    pagesDue = passPages
    return { started: true, jobIds: ids, pages: fresh.length }
  }

  function pause(scope: QueuePauseScope): QueueStatus {
    const at = nowMs()
    if (scope === 'all') {
      storePause({ state: 'paused_all' })
    } else {
      storePause({ state: 'paused_today', day: localDateKey(at, timeZone) })
    }
    return status()
  }

  function resume(): QueueStatus {
    storePause(null)
    return status()
  }

  function dequeue(): DequeueResult {
    const at = nowMs()
    expireTodayPause(at)
    scan = { nextRunAt: null, skipped: [], busy: 0 }
    if (state === 'paused_all') return { ok: false, reason: 'paused_all' }
    if (state === 'paused_today') return { ok: false, reason: 'paused_today' }
    if (waiting.length === 0) return { ok: false, reason: 'empty' }
    let sawFuture = false
    let nextRunAt: number | null = null
    let busy = 0
    const skipped: DequeueSkip[] = []
    let block: DequeueBlock = { ok: false, reason: 'not_before' }
    const skip = (item: WaitingItem, reason: DequeueSkip['reason'], capRule?: CapRule): void => {
      skipped.push({
        projectId: item.projectId,
        pageId: item.pageId,
        reason,
        ...(capRule === undefined ? {} : { capRule })
      })
      block = capRule === undefined ? { ok: false, reason } : { ok: false, reason, capRule }
    }
    for (let index = 0; index < waiting.length; index += 1) {
      const item = waiting[index]
      if (item === undefined) continue
      const notBefore = parseInstant(item.notBefore, 'notBefore')
      if (notBefore > at) {
        sawFuture = true
        if (nextRunAt === null || notBefore < nextRunAt) nextRunAt = notBefore
        continue
      }
      if (options.pageRunning?.(item.projectId, item.pageId) === true) {
        busy += 1
        continue
      }
      const claudeInFlight = [...running.values()].filter((job) => job.work.needsClaude).length
      if (item.needsClaude && claudeInFlight >= claudeConcurrency) {
        skip(item, 'claude_concurrency')
        continue
      }
      const project = projectOf(item.projectId)
      if (project.paused && item.reason !== 'manual') {
        skip(item, 'paused_project')
        continue
      }
      const month = monthKey(at, timeZone)
      const reserved = ledger.allocate({
        jobId: item.id,
        project,
        keys,
        searches: item.maxSearches,
        month,
        rotation: currentRotation()
      })
      if (!reserved.ok) {
        if (reserved.reason === 'project_cap') alertCap(project, month, at)
        skip(item, reserved.reason, reserved.capRule)
        continue
      }
      waiting.splice(index, 1)
      running.set(item.id, { work: item, startedAt: at, cancelRequested: false, slots: new Map() })
      scan = { nextRunAt, skipped, busy }
      return { ok: true, job: runningView(item.id) }
    }
    scan = { nextRunAt, skipped, busy }
    if (!sawFuture && block.reason === 'not_before') return { ok: false, reason: 'empty' }
    return block
  }

  function pruneDue(keep: (work: QueueWork) => boolean): readonly string[] {
    const dropped: string[] = []
    for (let index = waiting.length - 1; index >= 0; index -= 1) {
      const item = waiting[index]
      if (item === undefined || !item.id.startsWith(DUE_JOB_PREFIX) || keep(item)) continue
      waiting.splice(index, 1)
      rateLimitAttempts.delete(item.id)
      dropped.push(item.id)
    }
    return dropped.reverse()
  }

  function runningView(jobId: string): RunningJob {
    const job = running.get(jobId)
    if (job === undefined) throw new QueueError(`Job ${jobId} is not running`)
    return {
      id: job.work.id,
      projectId: job.work.projectId,
      pageId: job.work.pageId,
      marketIds: job.work.marketIds,
      reason: job.work.reason,
      promptIds: job.work.promptIds,
      fixId: job.work.fixId,
      ...(job.work.topicBatchId !== undefined ? { topicBatchId: job.work.topicBatchId } : {}),
      partial: job.work.partial,
      needsClaude: job.work.needsClaude,
      maxSearches: job.work.maxSearches,
      startedAt: formatInstant(job.startedAt),
      cancelRequested: job.cancelRequested
    }
  }

  function requireJob(jobId: string): ActiveJob | null {
    return running.get(jobId) ?? null
  }

  function slot(job: ActiveJob, slotId: string): SlotState {
    const existing = job.slots.get(slotId)
    if (existing !== undefined) return existing
    const created: SlotState = { pendingKeyId: null, anchorKeyId: null, failoverUsed: false }
    job.slots.set(slotId, created)
    return created
  }

  function takeKey(jobId: string, slotId: string): SearchResult {
    const job = requireJob(jobId)
    if (job === null) return { ok: false, reason: 'not_running' }
    const current = slot(job, slotId)
    if (current.pendingKeyId !== null)
      throw new QueueError(`Slot ${slotId} is already holding a key`)
    const at = nowMs()
    const month = monthKey(at, timeZone)
    let keyId = ledger.hold(jobId)
    if (keyId === null) {
      const project = projectOf(job.work.projectId)
      const extra = ledger.allocate({
        jobId,
        project,
        keys,
        searches: 1,
        month,
        rotation: currentRotation()
      })
      if (!extra.ok) {
        if (extra.reason === 'project_cap') alertCap(project, month, at)
        return { ok: false, reason: extra.reason, capRule: extra.capRule }
      }
      keyId = ledger.hold(jobId)
      if (keyId === null) return { ok: false, reason: 'keys_exhausted' }
    }
    current.pendingKeyId = keyId
    return commitView(job.work.projectId, keyId, month, false)
  }

  function commitSearch(jobId: string, slotId: string): SearchResult {
    const job = requireJob(jobId)
    if (job === null) return { ok: false, reason: 'not_running' }
    const current = job.slots.get(slotId)
    if (current === undefined || current.pendingKeyId === null)
      return { ok: false, reason: 'missing_slot' }
    const key = keyOf(current.pendingKeyId)
    const project = projectOf(job.work.projectId)
    const month = monthKey(nowMs(), timeZone)
    const committed = ledger.commitHeld({
      jobId,
      keyId: key.keyId,
      cap: key.cap,
      planLimit: key.planLimit,
      project,
      month
    })
    current.anchorKeyId = key.keyId
    current.pendingKeyId = null
    return commitView(project.projectId, key.keyId, month, committed.overCap)
  }

  function failSearch(
    jobId: string,
    slotId: string,
    input: { reason: FailoverReason; countFailedSearch: boolean }
  ): FailoverResult {
    const job = requireJob(jobId)
    if (job === null) return { ok: false, reason: 'not_running' }
    const current = job.slots.get(slotId)
    if (current === undefined || (current.pendingKeyId === null && current.anchorKeyId === null)) {
      return { ok: false, reason: 'missing_slot' }
    }
    if (current.pendingKeyId === null && current.anchorKeyId !== null) {
      return { ok: false, reason: 'already_committed' }
    }
    if (current.failoverUsed) return { ok: false, reason: 'failover_exhausted' }
    if (current.pendingKeyId === null) return { ok: false, reason: 'missing_slot' }
    const failedKeyId = current.pendingKeyId
    const project = projectOf(job.work.projectId)
    const at = nowMs()
    const month = monthKey(at, timeZone)
    const failedKey = keyOf(failedKeyId)
    if (input.countFailedSearch) {
      ledger.commitHeld({
        jobId,
        keyId: failedKeyId,
        cap: failedKey.cap,
        planLimit: failedKey.planLimit,
        project,
        month
      })
      current.anchorKeyId = failedKeyId
    } else {
      ledger.unhold(jobId, failedKeyId)
    }
    current.pendingKeyId = null
    current.failoverUsed = true
    const atIso = formatInstant(at)
    ledger.recordEvent({
      at: atIso,
      keyId: failedKeyId,
      projectId: project.projectId,
      kind: input.reason,
      detail: `Search was ${input.reason} on this key.`
    })
    if (project.dedicatedKeyId !== null) {
      return { ok: false, reason: 'dedicated_key' }
    }
    const next = nextKeyAfter(keys, failedKeyId, project, currentRotation(), (key) =>
      ledger.keyRoom(key.keyId, month, key.cap, key.planLimit)
    )
    if (
      next === null ||
      !ledger.holdKey(jobId, project.projectId, next.keyId, month, next.cap, next.planLimit)
    ) {
      return { ok: false, reason: 'keys_exhausted' }
    }
    current.pendingKeyId = next.keyId
    ledger.recordEvent({
      at: atIso,
      keyId: next.keyId,
      projectId: project.projectId,
      kind: 'failover',
      detail: `Retrying once on ${next.keyId} after ${failedKeyId} was ${input.reason}.`
    })
    return { ok: true, keyId: next.keyId }
  }

  function rateLimit(jobId: string, input?: { retryAfter?: string }): RateLimitResult {
    const job = running.get(jobId)
    if (job === undefined) return { ok: false, reason: 'not_running' }
    if (job.cancelRequested) {
      ledger.release(jobId)
      running.delete(jobId)
      rateLimitAttempts.delete(jobId)
      return { ok: false, reason: 'not_running' }
    }
    const at = nowMs()
    const atIso = formatInstant(at)
    for (const current of job.slots.values()) {
      if (current.pendingKeyId === null) continue
      ledger.unhold(jobId, current.pendingKeyId)
      ledger.recordEvent({
        at: atIso,
        keyId: current.pendingKeyId,
        projectId: job.work.projectId,
        kind: 'rate_limited',
        detail: 'Search was rate_limited. The job is waiting to run again.'
      })
      current.pendingKeyId = null
    }
    ledger.release(jobId)
    running.delete(jobId)
    const attempt = (rateLimitAttempts.get(jobId) ?? 0) + 1
    rateLimitAttempts.set(jobId, attempt)
    const headerDelay =
      input?.retryAfter === undefined ? null : parseRetryAfter(input.retryAfter, at)
    const raw = headerDelay === null ? retryDelayMs(attempt) : headerDelay
    const delayMs = Math.min(Math.max(0, raw), RETRY_DELAY_CAP_MS)
    const notBefore = formatInstant(at + delayMs)
    sequence += 1
    waiting.push({ ...job.work, notBefore, enqueuedAt: sequence })
    return { ok: true, notBefore, attempt, delayMs }
  }

  function commitFollowUp(jobId: string, slotId: string): SearchResult {
    const job = requireJob(jobId)
    if (job === null) return { ok: false, reason: 'not_running' }
    const current = job.slots.get(slotId)
    if (current === undefined || current.anchorKeyId === null)
      return { ok: false, reason: 'missing_slot' }
    const key = keyOf(current.anchorKeyId)
    const project = projectOf(job.work.projectId)
    const month = monthKey(nowMs(), timeZone)
    const committed = ledger.commitExtra({
      keyId: key.keyId,
      cap: key.cap,
      planLimit: key.planLimit,
      project,
      month
    })
    return commitView(project.projectId, key.keyId, month, committed.overCap)
  }

  function commitCharged(jobId: string, keyId: string): SearchResult {
    const job = requireJob(jobId)
    if (job === null) return { ok: false, reason: 'not_running' }
    const key = keys.find((item) => item.keyId === keyId)
    const project = projectOf(job.work.projectId)
    const month = monthKey(nowMs(), timeZone)
    const committed = ledger.commitCharged({
      jobId,
      keyId,
      cap: key?.cap ?? null,
      planLimit: key?.planLimit ?? null,
      project,
      month
    })
    return commitView(project.projectId, keyId, month, committed.overCap)
  }

  function commitView(
    projectId: string,
    keyId: string,
    month: string,
    overCap: boolean
  ): SearchCommit {
    return {
      ok: true,
      keyId,
      overCap,
      keyUsed: ledger.keyUsed(keyId, month),
      projectUsed: ledger.projectUsed(projectId, month),
      month
    }
  }

  function complete(
    jobId: string
  ): { ok: true; status: 'completed' | 'cancelled' } | { ok: false; reason: 'not_running' } {
    const job = running.get(jobId)
    if (job === undefined) return { ok: false, reason: 'not_running' }
    ledger.release(jobId)
    const statusName = job.cancelRequested ? 'cancelled' : 'completed'
    running.delete(jobId)
    rateLimitAttempts.delete(jobId)
    return { ok: true, status: statusName }
  }

  function cancel(
    jobId: string
  ): { ok: true; state: 'removed' | 'cancel_requested' } | { ok: false; reason: 'missing' } {
    const index = waiting.findIndex((item) => item.id === jobId)
    if (index >= 0) {
      waiting.splice(index, 1)
      rateLimitAttempts.delete(jobId)
      return { ok: true, state: 'removed' }
    }
    const job = running.get(jobId)
    if (job === undefined) return { ok: false, reason: 'missing' }
    job.cancelRequested = true
    return { ok: true, state: 'cancel_requested' }
  }

  function cancelWaiting(): readonly string[] {
    const ids = waiting.map((item) => item.id)
    waiting.splice(0, waiting.length)
    return ids
  }

  return {
    status,
    setKeys(nextKeys: readonly QueueKeyInput[]): void {
      keys = [...nextKeys]
    },
    setProjects(nextProjects: readonly QueueProjectInput[]): void {
      projects = [...nextProjects]
    },
    syncUsage(seed: readonly MonthUsageSeed[]): void {
      ledger.syncCommitted(seed)
    },
    setClaudeConcurrency(value: number): void {
      if (!Number.isInteger(value) || value < 1) {
        throw new QueueError('Claude concurrency must be a positive integer')
      }
      claudeConcurrency = value
    },
    setTimeZone(zone: string): void {
      assertTimeZone(zone)
      timeZone = zone
    },
    setTrayRunning(value: boolean): void {
      trayRunning = value
    },
    setHeadlessJob(value: boolean): void {
      headlessJob = value
    },
    setPagesDue(count: number): void {
      if (!Number.isInteger(count) || count < 0)
        throw new QueueError('pagesDue must be a non-negative integer')
      pagesDue = count
    },
    enqueue,
    checkDue,
    pause,
    resume,
    dequeue,
    lastScan: () => scan,
    pruneDue,
    takeKey,
    commitSearch,
    failSearch,
    rateLimit,
    commitFollowUp,
    commitCharged,
    complete,
    cancel,
    cancelWaiting,
    drainEvents(): readonly KeyEvent[] {
      return ledger.drainEvents()
    }
  }
}

const DUE_JOB_PREFIX = 'due-'

/**
 * Stable id for one due page on one local day.
 * Storage ids are at most 80 characters. A project id and a page id already
 * use most of that, so the descriptive key is hashed.
 */
export function dueJobId(day: string, page: DuePage): string {
  const prompts = page.promptIds === null ? '' : page.promptIds.join(',')
  const parts = [day, page.projectId, page.pageId, page.reason, page.marketIds.join(','), prompts]
  if (page.reason === 'follow_up' && page.fixId !== undefined && page.fixId.length > 0) {
    parts.push(page.fixId)
  }
  if (page.topicBatchId !== undefined) parts.push(page.topicBatchId)
  return `${DUE_JOB_PREFIX}${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 60)}`
}

function validateWork(work: QueueWork): void {
  if (work.id.length === 0 || work.projectId.length === 0 || work.pageId.length === 0) {
    throw new QueueError('Job id, project id, and page id are required')
  }
  if (work.marketIds.length === 0) throw new QueueError('A check needs at least one market')
  if (!Number.isInteger(work.maxSearches) || work.maxSearches < 0) {
    throw new QueueError('Search estimate must be a non-negative integer')
  }
  parseInstant(work.notBefore, 'notBefore')
  if (work.reason === 'follow_up' && (work.promptIds === null || work.promptIds.length === 0)) {
    throw new QueueError('A follow-up needs the targeted prompts')
  }
  if (work.reason !== 'follow_up' && work.fixId !== undefined) {
    throw new QueueError('Only a follow-up carries a fix id')
  }
}
