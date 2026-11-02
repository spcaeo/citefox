import { randomUUID } from 'node:crypto'
import { DEFAULT_SERPAPI_ROTATION } from '@shared/domain'
import type { SearchProvider, SerpApiRotationMode } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'
import { getKeyUsageForMonth } from '../storage/key-usage'
import { addKeyUsage } from '../storage/records'
import { QueueError } from './errors'
import type {
  CapRule,
  CommittedSearchWrite,
  FailoverReason,
  KeyEvent,
  MonthUsageSeed,
  QueueKeyInput,
  QueueProjectInput,
  UsageSeedStore
} from './types'

export interface Allocation {
  keyId: string
  count: number
}

export type AllocateResult =
  | { ok: true }
  | {
      ok: false
      reason: 'project_cap' | 'keys_exhausted' | 'dedicated_key_unavailable'
      capRule?: CapRule
    }

/**
 * FR-11.4 `allow_10`. Integer searches cannot spend a fraction.
 * 10% over is `floor(cap / 10)` extra searches. A cap of 9 stays 9.
 * A cap of 10 becomes 11. Key caps do not get this extra room.
 */
export function capAllowance(cap: number, rule: CapRule): number {
  if (!Number.isInteger(cap) || cap < 0) throw new QueueError('Cap must be a non-negative integer')
  if (rule !== 'allow_10') return cap
  return cap + Math.floor(cap / 10)
}

interface Reservation {
  jobId: string
  projectId: string
  keyId: string
  month: string
  open: number
  held: number
}

/**
 * In-memory searches for the current and previous months (SERP-6).
 * `used` on the status is the month of the injected clock, in the computer's zone.
 * The ledger does not call `Date.now`.
 * A month-to-date seed is applied at construction (decision 26). The default is empty.
 */
export class UsageLedger {
  private readonly keyMonth = new Map<string, number>()
  private readonly projectMonth = new Map<string, number>()
  /** Commits made without `persistSearch`. They exist only in memory. */
  private readonly keyUnstored = new Map<string, number>()
  private readonly projectUnstored = new Map<string, number>()
  private readonly reservations: Reservation[] = []
  private readonly events: KeyEvent[] = []
  private cursor = 0
  private readonly persistSearch?: (search: CommittedSearchWrite) => void

  constructor(
    seed: readonly MonthUsageSeed[] = [],
    persistSearch?: (search: CommittedSearchWrite) => void
  ) {
    this.persistSearch = persistSearch
    this.syncCommitted(seed)
  }

  /**
   * Replace committed counts with the stored month-to-date rows, plus any
   * commits this ledger made without a writer (they are not in storage).
   * Stored rows are the truth: a search the runner charged and a sync that
   * already saw it are not counted twice. Reservations are not changed.
   */
  syncCommitted(seed: readonly MonthUsageSeed[]): void {
    const keys = new Map<string, number>()
    const projects = new Map<string, number>()
    for (const row of seed) {
      if (!Number.isInteger(row.searches) || row.searches < 0) {
        throw new QueueError('Usage seed must be a non-negative integer')
      }
      const key = usageKey(row.keyId, row.month)
      keys.set(key, (keys.get(key) ?? 0) + row.searches)
      if (row.projectId === null) continue
      const project = usageKey(row.projectId, row.month)
      projects.set(project, (projects.get(project) ?? 0) + row.searches)
    }
    replaceCounts(this.keyMonth, keys, this.keyUnstored)
    replaceCounts(this.projectMonth, projects, this.projectUnstored)
  }

  keyUsed(keyId: string, month: string): number {
    return this.keyMonth.get(usageKey(keyId, month)) ?? 0
  }

  projectUsed(projectId: string, month: string): number {
    return this.projectMonth.get(usageKey(projectId, month)) ?? 0
  }

  drainEvents(): KeyEvent[] {
    return this.events.splice(0, this.events.length)
  }

  /**
   * Reserve `searches` for a job that has not started.
   * SERP-2: the whole estimate must fit, or the job does not start.
   * `pause` and `notify` both refuse once the allowance is exhausted.
   * `allow_10` uses {@link capAllowance}.
   */
  allocate(input: {
    jobId: string
    project: QueueProjectInput
    keys: readonly QueueKeyInput[]
    searches: number
    month: string
    rotation: SerpApiRotationMode
  }): AllocateResult {
    if (!Number.isInteger(input.searches) || input.searches < 0) {
      throw new QueueError('Search estimate must be a non-negative integer')
    }
    if (input.searches === 0) return { ok: true }
    const projectRoom = this.projectRoom(input.project, input.month)
    if (projectRoom < input.searches)
      return { ok: false, reason: 'project_cap', capRule: input.project.capRule }
    const eligible = eligibleKeys(input.keys, input.project, input.rotation)
    if (input.project.dedicatedKeyId !== null && eligible.length === 0) {
      return { ok: false, reason: 'dedicated_key_unavailable' }
    }
    const planned =
      input.rotation === 'spread_evenly' && input.project.dedicatedKeyId === null
        ? this.planSpread(eligible, input.searches, input.month)
        : this.planInOrder(eligible, input.searches, input.month)
    if (planned === null) return { ok: false, reason: 'keys_exhausted' }
    for (const part of planned.parts) {
      this.reservations.push({
        jobId: input.jobId,
        projectId: input.project.projectId,
        keyId: part.keyId,
        month: input.month,
        open: part.count,
        held: 0
      })
    }
    if (planned.cursor !== null) this.cursor = planned.cursor
    return { ok: true }
  }

  /** Move one open reservation to held. Returns the key, or null when none is open. */
  hold(jobId: string): string | null {
    const reservation = this.reservations.find((item) => item.jobId === jobId && item.open > 0)
    if (reservation === undefined) return null
    reservation.open -= 1
    reservation.held += 1
    return reservation.keyId
  }

  /** Put a held search back into the open pool. */
  unhold(jobId: string, keyId: string): void {
    const reservation = this.reservations.find(
      (item) => item.jobId === jobId && item.keyId === keyId && item.held > 0
    )
    if (reservation === undefined) throw new QueueError(`No held search for ${keyId}`)
    reservation.held -= 1
    reservation.open += 1
  }

  /**
   * Count one held search. `overCap` is true when the key's hard cap or the
   * project's allowance is now exceeded. Follow-ups can do that on purpose:
   * FR-11.3 keeps the follow-up on the key that made the search.
   */
  commitHeld(input: {
    jobId: string
    keyId: string
    cap: number | null
    planLimit: number | null
    project: QueueProjectInput
    month: string
  }): { overCap: boolean } {
    const reservation = this.reservations.find(
      (item) => item.jobId === input.jobId && item.keyId === input.keyId && item.held > 0
    )
    if (reservation === undefined) throw new QueueError(`No held search for ${input.keyId}`)
    const stored = this.writeCommitted(input.keyId, input.project.projectId, input.month)
    reservation.held -= 1
    this.add(input.keyId, input.project.projectId, input.month, 1, stored)
    return {
      overCap: this.exceeds(input.keyId, input.cap, input.planLimit, input.project, input.month)
    }
  }

  /** Count a search that was not reserved. The follow-up stays on the search's key (FR-11.3). */
  commitExtra(input: {
    keyId: string
    cap: number | null
    planLimit: number | null
    project: QueueProjectInput
    month: string
  }): { overCap: boolean } {
    const stored = this.writeCommitted(input.keyId, input.project.projectId, input.month)
    this.add(input.keyId, input.project.projectId, input.month, 1, stored)
    return {
      overCap: this.exceeds(input.keyId, input.cap, input.planLimit, input.project, input.month)
    }
  }

  /**
   * Count a search the runner already wrote to `key_usage`, on the key that
   * actually made it (SERP-6). One of the job's reserved searches is released.
   * Nothing is written here, so the row is not stored twice.
   */
  commitCharged(input: {
    jobId: string
    keyId: string
    cap: number | null
    planLimit: number | null
    project: QueueProjectInput
    month: string
  }): { overCap: boolean } {
    const reservation =
      this.reservations.find(
        (item) => item.jobId === input.jobId && item.keyId === input.keyId && item.open > 0
      ) ?? this.reservations.find((item) => item.jobId === input.jobId && item.open > 0)
    if (reservation !== undefined) reservation.open -= 1
    this.add(input.keyId, input.project.projectId, input.month, 1)
    return {
      overCap: this.exceeds(input.keyId, input.cap, input.planLimit, input.project, input.month)
    }
  }

  /**
   * Hold one more search on `keyId` for a failover retry.
   * The key's hard cap still applies. The one retry may pass the project allowance.
   */
  holdKey(
    jobId: string,
    projectId: string,
    keyId: string,
    month: string,
    cap: number | null,
    planLimit: number | null
  ): boolean {
    let reservation = this.reservations.find((item) => item.jobId === jobId && item.keyId === keyId)
    if (
      (reservation === undefined || reservation.open === 0) &&
      this.keyRoom(keyId, month, cap, planLimit) <= 0
    ) {
      return false
    }
    if (reservation === undefined) {
      reservation = { jobId, projectId, keyId, month, open: 0, held: 0 }
      this.reservations.push(reservation)
    }
    if (reservation.open === 0) reservation.open += 1
    reservation.open -= 1
    reservation.held += 1
    return true
  }

  release(jobId: string): void {
    for (let index = this.reservations.length - 1; index >= 0; index -= 1) {
      if (this.reservations[index]?.jobId === jobId) this.reservations.splice(index, 1)
    }
  }

  recordEvent(event: KeyEvent): void {
    this.events.push(event)
  }

  keyRoom(keyId: string, month: string, cap: number | null, planLimit: number | null): number {
    const caps: number[] = []
    if (cap !== null) caps.push(cap)
    if (planLimit !== null) caps.push(planLimit)
    const used = this.keyUsed(keyId, month) + this.reservedOnKey(keyId, month)
    if (caps.length === 0) return Number.POSITIVE_INFINITY
    return Math.max(0, Math.min(...caps) - used)
  }

  private planInOrder(
    keys: readonly QueueKeyInput[],
    searches: number,
    month: string
  ): { parts: Allocation[]; cursor: null } | null {
    const parts: Allocation[] = []
    let left = searches
    for (const key of keys) {
      const room = this.keyRoom(key.keyId, month, key.cap, key.planLimit)
      if (room <= 0) continue
      const take = Math.min(left, room)
      parts.push({ keyId: key.keyId, count: take })
      left -= take
      if (left === 0) return { parts, cursor: null }
    }
    return null
  }

  private planSpread(
    keys: readonly QueueKeyInput[],
    searches: number,
    month: string
  ): { parts: Allocation[]; cursor: number } | null {
    if (keys.length === 0) return null
    const parts: Allocation[] = []
    let cursor = this.cursor
    let left = searches
    let idle = 0
    while (left > 0 && idle < keys.length) {
      const key = keys[cursor % keys.length]
      cursor += 1
      if (key === undefined) return null
      const already = parts
        .filter((part) => part.keyId === key.keyId)
        .reduce((sum, part) => sum + part.count, 0)
      const room = this.keyRoom(key.keyId, month, key.cap, key.planLimit) - already
      if (room <= 0) {
        idle += 1
        continue
      }
      parts.push({ keyId: key.keyId, count: 1 })
      left -= 1
      idle = 0
    }
    if (left > 0) return null
    return { parts, cursor }
  }

  private projectRoom(project: QueueProjectInput, month: string): number {
    if (project.cap === null) return Number.POSITIVE_INFINITY
    const allowance = capAllowance(project.cap, project.capRule)
    const reserved = this.reservations
      .filter((item) => item.projectId === project.projectId && item.month === month)
      .reduce((sum, item) => sum + item.open + item.held, 0)
    return Math.max(0, allowance - this.projectUsed(project.projectId, month) - reserved)
  }

  private reservedOnKey(keyId: string, month: string): number {
    return this.reservations
      .filter((item) => item.keyId === keyId && item.month === month)
      .reduce((sum, item) => sum + item.open + item.held, 0)
  }

  private exceeds(
    keyId: string,
    cap: number | null,
    planLimit: number | null,
    project: QueueProjectInput,
    month: string
  ): boolean {
    const caps: number[] = []
    if (cap !== null) caps.push(cap)
    if (planLimit !== null) caps.push(planLimit)
    if (caps.length > 0 && this.keyUsed(keyId, month) > Math.min(...caps)) return true
    if (project.cap === null) return false
    return this.projectUsed(project.projectId, month) > capAllowance(project.cap, project.capRule)
  }

  /**
   * Store the search before the in-memory count moves.
   * A later `syncCommitted` takes the larger stored total. If memory moved first,
   * another process's rows could raise that total and drop this search.
   */
  private writeCommitted(keyId: string, projectId: string, month: string): boolean {
    if (this.persistSearch === undefined) return false
    this.persistSearch({ keyId, projectId, month, searches: 1 })
    return true
  }

  private add(
    keyId: string,
    projectId: string | null,
    month: string,
    count: number,
    stored = true
  ): void {
    const key = usageKey(keyId, month)
    bump(this.keyMonth, key, count)
    if (!stored) bump(this.keyUnstored, key, count)
    if (projectId === null) return
    const project = usageKey(projectId, month)
    bump(this.projectMonth, project, count)
    if (!stored) bump(this.projectUnstored, project, count)
  }
}

function bump(map: Map<string, number>, key: string, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count)
}

/** Stored totals plus memory-only commits. Every counted key is rewritten. */
function replaceCounts(
  target: Map<string, number>,
  stored: ReadonlyMap<string, number>,
  unstored: ReadonlyMap<string, number>
): void {
  const keys = new Set([...target.keys(), ...stored.keys()])
  for (const key of keys) {
    target.set(key, (stored.get(key) ?? 0) + (unstored.get(key) ?? 0))
  }
}

/**
 * FR-11.2 keys of one search provider a project may use, in rotation order. The provider
 * is the one named, else the project's (`auto`: cloro when it has a usable cloro key,
 * else SerpApi). A dedicated key is the whole pool (FR-11.4) unless it belongs to the
 * other provider, which leaves this provider's pool as it is.
 */
export function eligibleKeys(
  keys: readonly QueueKeyInput[],
  project: QueueProjectInput,
  rotation: SerpApiRotationMode = DEFAULT_SERPAPI_ROTATION,
  provider: SearchProvider = queueProvider(keys, project, rotation)
): QueueKeyInput[] {
  return poolOf(keys, project, rotation, provider)
}

/** The provider a project's searches are reserved on (see {@link eligibleKeys}). */
export function queueProvider(
  keys: readonly QueueKeyInput[],
  project: QueueProjectInput,
  rotation: SerpApiRotationMode
): SearchProvider {
  const choice = project.provider ?? 'auto'
  if (choice !== 'auto') return choice
  return poolOf(keys, project, rotation, 'cloro').length > 0 ? 'cloro' : 'serpapi'
}

function poolOf(
  keys: readonly QueueKeyInput[],
  project: QueueProjectInput,
  rotation: SerpApiRotationMode,
  provider: SearchProvider
): QueueKeyInput[] {
  const usable = keys.filter((key) => key.provider === provider && key.state !== 'off')
  const dedicated = dedicatedFor(keys, project, provider)
  const pool =
    dedicated !== null
      ? usable.filter((key) => key.keyId === dedicated)
      : usable.filter((key) => serves(key, project.projectId, rotation))
  return [...pool].sort((a, b) => a.rotationOrder - b.rotationOrder || (a.keyId < b.keyId ? -1 : 1))
}

/** The project's dedicated key for this provider. A dedicated key of the other provider: none. */
function dedicatedFor(
  keys: readonly QueueKeyInput[],
  project: QueueProjectInput,
  provider: SearchProvider
): string | null {
  const dedicated = project.dedicatedKeyId
  if (dedicated === null) return null
  const elsewhere = keys.some((key) => key.keyId === dedicated && key.provider !== provider)
  return elsewhere ? null : dedicated
}

export function nextKeyAfter(
  keys: readonly QueueKeyInput[],
  failedKeyId: string,
  project: QueueProjectInput,
  rotation: SerpApiRotationMode,
  room: (key: QueueKeyInput) => number,
  provider: SearchProvider = queueProvider(keys, project, rotation)
): QueueKeyInput | null {
  if (dedicatedFor(keys, project, provider) !== null) return null
  const pool = eligibleKeys(keys, project, rotation, provider)
  const index = pool.findIndex((key) => key.keyId === failedKeyId)
  const start = index === -1 ? 0 : index + 1
  for (let offset = 0; offset < pool.length; offset += 1) {
    const key = pool[(start + offset) % pool.length]
    if (key === undefined || key.keyId === failedKeyId) continue
    if (room(key) > 0) return key
  }
  return null
}

function serves(key: QueueKeyInput, projectId: string, rotation: SerpApiRotationMode): boolean {
  if (rotation === 'project_keys') return key.projectIds.includes(projectId)
  if (key.projectIds.length === 0) return true
  return key.projectIds.includes(projectId)
}

/**
 * Month-to-date `key_usage` for the caps ledger (decision 26).
 * `month` is `YYYY-MM` in the computer's timezone, or a function read on every
 * call so a long-running process moves to the new month. Each stored row becomes
 * one seed row, including rows whose `project_id` is null. Calls and tokens
 * stay on the storage read. A null project counts toward the key only.
 */
export function usageSeedFromStorage(
  db: SqliteDatabase,
  month: string | (() => string)
): UsageSeedStore {
  return {
    monthToDate(): readonly MonthUsageSeed[] {
      const usage = getKeyUsageForMonth(db, typeof month === 'string' ? month : month())
      const rows: MonthUsageSeed[] = []
      for (const key of usage.keys) {
        for (const project of key.projects) {
          rows.push({
            keyId: key.keyId,
            projectId: project.projectId,
            month: usage.month,
            searches: project.searches
          })
        }
      }
      return rows
    }
  }
}

/** No month-to-date rows. Tests and callers without storage inject this. */
export function emptyUsageSeed(): UsageSeedStore {
  return {
    monthToDate(): readonly MonthUsageSeed[] {
      return []
    }
  }
}

/**
 * `key_usage` write for a ledger commit. One search, one call.
 * The id is only the insert key. A repeat in the same month adds onto the row.
 */
export function persistCommittedSearch(db: SqliteDatabase): (search: CommittedSearchWrite) => void {
  return (search) => {
    addKeyUsage(db, {
      id: randomUUID(),
      keyId: search.keyId,
      projectId: search.projectId,
      month: search.month,
      searches: search.searches,
      calls: 1,
      tokens: 0
    })
  }
}

function usageKey(id: string, month: string): string {
  return `${id}\0${month}`
}

export type { FailoverReason }
