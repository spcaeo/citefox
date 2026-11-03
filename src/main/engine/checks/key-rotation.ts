import { DEFAULT_SERPAPI_ROTATION } from '@shared/domain'
import type {
  AnswerEngineId,
  CheckErrorCode,
  SearchProvider,
  SerpApiRotationMode
} from '@shared/domain'
import { effectiveMonthlyLimit } from '../../keys/present'
import type { Logger } from '../../logging/logger'
import type { HttpTransport } from '../../providers/http'
import { eligibleKeys, nextKeyAfter } from '../../queue/usage'
import type { QueueKeyInput, QueueProjectInput } from '../../queue/types'
import type { SecretStore } from '../../secrets/secret-store'
import type { AppStorage } from '../../storage/app-storage'
import { recordActivity } from '../../storage/activity-events'
import { getKeyUsageForMonth } from '../../storage/key-usage'
import { addKeyUsage, insertConnectionEvent, listApiKeys } from '../../storage/records'
import { captureSerpApi, logSerpApiFailure, type CaptureQuery, type SerpCapture } from './capture'
import {
  captureCloroAnswer,
  captureCloroGoogle,
  emptyAnswer,
  type AnswerCapture,
  type CloroCaptureOptions
} from './cloro-capture'
import { providerPacer } from './provider-pacer'

/** FR-11.3. These move the search to the next key. A timeout or a bad body does not. */
const FAILOVER = new Set(['rejected', 'rate_limited', 'out_of_searches'])

/** These never recover within a job, so the key is skipped until the job ends. */
const SPENT = new Set(['rejected', 'out_of_searches'])

export interface KeyRotationDeps {
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  now: () => Date
  createId: () => string
  knownSecrets?: () => readonly string[]
  sleep?: (ms: number) => Promise<void>
}

export interface KeyRotationContext {
  /** Project for rotation and caps. A playground run with no project passes `projectId: ''`. */
  project: QueueProjectInput
  /** `key_usage.project_id`. Null when no project is active. */
  usageProjectId: string | null
  month: string
  /**
   * Write each search to `key_usage` per key as it is sent (SERP-6).
   * Manual and queued checks both pass true, so a crash cannot lose a search.
   */
  chargeUsage: boolean
  /** Called once per SerpApi HTTP attempt, with the key that sent it. */
  onSearch?: (keyId: string) => void
  /** FR-11.2. Defaults to the mode saved in Settings. */
  rotation?: SerpApiRotationMode
  /** Whose keys to rotate. Defaults to SerpApi. */
  provider?: SearchProvider
}

/** Admits each SerpApi attempt (cancel and project cap) before it is sent. */
export interface ProviderGate {
  allow: () => Promise<boolean>
  stopRequested: () => boolean
  /** `searches` admitted attempts are now stored in `key_usage`, so a live total includes them. */
  settle?: (searches: number) => void
}

export interface CapGate extends ProviderGate {
  /** True once an attempt was refused because the project allowance is used up. */
  capHit: () => boolean
}

/**
 * FR-11.4 project allowance for every SerpApi attempt, retries and follow-ups
 * included. `allowance` is null when the project has no cap.
 * `beforeRequest` runs first so a cancel can win the race with the next attempt.
 * `used` is a fixed month-to-date count, or a live read of `key_usage` so a
 * manual check and a queued check of the same project share one cap. With a
 * live read, `settle` moves attempts this gate admitted out of its own count
 * once they are stored, so they are not counted twice.
 */
export function createCapGate(input: {
  allowance: number | null
  used: number | (() => number)
  cancelled?: () => boolean
  beforeRequest?: () => Promise<void>
}): CapGate {
  let admitted = 0
  let capHit = false
  const cancelled = input.cancelled ?? ((): boolean => false)
  const live = typeof input.used === 'function' ? input.used : null
  const fixed = typeof input.used === 'number' ? input.used : 0
  return {
    allow: async () => {
      if (input.beforeRequest !== undefined) await input.beforeRequest()
      if (cancelled()) return false
      const used = live === null ? fixed : live()
      if (input.allowance !== null && used + admitted >= input.allowance) {
        capHit = true
        return false
      }
      admitted += 1
      return true
    },
    stopRequested: () => cancelled() || capHit,
    capHit: () => capHit,
    settle: (searches) => {
      if (live === null) return
      admitted = Math.max(0, admitted - searches)
    }
  }
}

export interface KeyAttempt {
  keyId: string
  searches: number
}

/**
 * One prompt sample after rotation. `searches` adds every key's searches, so a
 * failover's first search is counted with the sample (SERP-6). `keyId` is the
 * key whose outcome this is. `exhausted` means no key had room, and nothing was sent.
 */
export interface RotatedCapture extends SerpCapture {
  keyId: string | null
  attempts: readonly KeyAttempt[]
  exhausted: boolean
}

/** One answer engine's reply after rotation over the cloro keys. */
export interface RotatedAnswer extends AnswerCapture {
  keyId: string | null
  exhausted: boolean
}

export interface RotationKey extends QueueKeyInput {
  /** SERP-7 plan searches SerpApi reported at the last key test. Null when not reported. */
  planUsed: number | null
}

export interface KeyRotation {
  /** On keys this project may use, re-read from storage so a key switched off stops at once. */
  keys(): readonly RotationKey[]
  /** True when no usable key has room this month. */
  exhausted(): boolean
  capture(query: CaptureQuery, gate: ProviderGate): Promise<RotatedCapture>
}

/** A rotation that knows its provider. cloro also answers the other engines. */
export interface EngineRotation extends KeyRotation {
  provider: SearchProvider
  /** One answer engine (ChatGPT, Perplexity, ...). SerpApi has none: `exhausted` comes back. */
  answer(engine: AnswerEngineId, query: CaptureQuery, gate: ProviderGate): Promise<RotatedAnswer>
}

/** FR-11.2. The rotation mode saved in Settings. */
export function rotationMode(storage: AppStorage): SerpApiRotationMode {
  try {
    return storage.readSettings().serpapiRotation ?? DEFAULT_SERPAPI_ROTATION
  } catch {
    return DEFAULT_SERPAPI_ROTATION
  }
}

/**
 * Spread evenly keeps one cursor per app database and provider, so consecutive searches
 * of every job and project move round the keys (FR-11.2).
 */
const spreadCursors = new WeakMap<
  AppStorage['db'],
  Map<SearchProvider, { lastKeyId: string | null }>
>()

function spreadCursor(storage: AppStorage, provider: SearchProvider): { lastKeyId: string | null } {
  const byProvider = spreadCursors.get(storage.db) ?? new Map()
  spreadCursors.set(storage.db, byProvider)
  const existing = byProvider.get(provider)
  if (existing !== undefined) return existing
  const created = { lastKeyId: null }
  byProvider.set(provider, created)
  return created
}

/**
 * FR-11.2 eligible keys of one provider (SerpApi unless named) for a project, read from
 * storage now. `project_keys` keeps only keys assigned to the project; the other modes
 * also use keys assigned to no project. A dedicated key is the whole pool (FR-11.4); a
 * dedicated key of the other provider leaves this provider's pool as it is.
 */
export function loadRotationKeys(
  storage: AppStorage,
  project: QueueProjectInput,
  rotation: SerpApiRotationMode = rotationMode(storage),
  provider: SearchProvider = 'serpapi'
): RotationKey[] {
  // Every key goes in (a switched-off key as `off`), so a dedicated key's provider is known.
  const records = listApiKeys(storage.db)
  const planUsed = new Map(records.map((key) => [key.id, key.serpapiUsage?.used ?? null]))
  return eligibleKeys(
    records.map((key) => ({
      keyId: key.id,
      name: key.name,
      provider: key.provider,
      cap: key.cap,
      planLimit: key.serpapiUsage?.planLimit ?? null,
      state: key.on ? key.state : 'off',
      rotationOrder: key.rotationOrder,
      projectIds: key.projectIds
    })),
    project,
    rotation,
    provider
  ).map((key) => ({ ...key, planUsed: planUsed.get(key.keyId) ?? null }))
}

/**
 * Searches left on a key this month. The limit is the same one Connections shows
 * (`effectiveMonthlyLimit`: the lower of the CiteFox cap and the plan allowance).
 * When SerpApi reported plan usage that is higher than CiteFox's own count,
 * the plan room uses SerpApi's number.
 */
export function keyRoom(key: RotationKey, used: number): number {
  const limit = effectiveMonthlyLimit(key.cap, key.planLimit)
  let room = limit === null ? Number.MAX_SAFE_INTEGER : limit - used
  if (key.planLimit !== null && key.planUsed !== null) {
    room = Math.min(room, key.planLimit - Math.max(key.planUsed, used))
  }
  return Math.max(0, room)
}

/** Month-to-date searches per key from `key_usage` (SERP-6). */
export function keyUsageForMonth(storage: AppStorage, month: string): Map<string, number> {
  const usage = getKeyUsageForMonth(storage.db, month)
  const used = new Map<string, number>()
  for (const key of usage.keys) {
    used.set(
      key.keyId,
      key.projects.reduce((sum, project) => sum + project.searches, 0)
    )
  }
  return used
}

/** Month-to-date searches one project has used across every key (FR-11.4). */
export function projectUsedForMonth(storage: AppStorage, projectId: string, month: string): number {
  let searches = 0
  for (const key of getKeyUsageForMonth(storage.db, month).keys) {
    for (const project of key.projects) {
      if (project.projectId === projectId) searches += project.searches
    }
  }
  return searches
}

/** What the rotation needs from any provider call to charge it and pick the next key. */
interface KeyedOutcome {
  searches: number
  halted: boolean
  errorCode: CheckErrorCode | null
  message: string | null
  retryAfterMs: number | null
  credits?: number
}

const PROVIDER_NAME: Readonly<Record<SearchProvider, string>> = {
  serpapi: 'SerpApi',
  cloro: 'cloro'
}

/**
 * FR-11.2 and FR-11.3 for one job. In order (the default), keys are tried in rotation
 * order, each up to its room; spread evenly moves to the next key with room on every
 * search; project keys uses only the keys assigned to the project. A rejected key or one
 * out of searches is skipped for the rest of the job; a rate-limited key rests for its
 * Retry-After. A failover retries the search once on the next key. The `page_token`
 * follow-up stays inside one key's capture, so it always uses the key that searched.
 * The same rules rotate cloro keys (`context.provider`), whose calls also answer the
 * other engines; every cloro call counts as one search toward the caps.
 */
export function createKeyRotation(
  deps: KeyRotationDeps,
  context: KeyRotationContext
): EngineRotation {
  const provider = context.provider ?? 'serpapi'
  const name = PROVIDER_NAME[provider]
  // A dedicated key of the other provider leaves this provider's keys rotating as usual.
  const dedicated = context.project.dedicatedKeyId
  const project: QueueProjectInput =
    dedicated !== null &&
    listApiKeys(deps.storage.db).some((key) => key.id === dedicated && key.provider !== provider)
      ? { ...context.project, dedicatedKeyId: null }
      : context.project
  const rotation = context.rotation ?? rotationMode(deps.storage)
  const cursor = spreadCursor(deps.storage, provider)
  const used = keyUsageForMonth(deps.storage, context.month)
  const spent = new Set<string>()
  const restingUntil = new Map<string, number>()
  // Calls in flight per key: a check runs several at once, so a key with one search of
  // room left is not handed out twice before the first call is counted.
  const inFlight = new Map<string, number>()
  const roomOf = (key: RotationKey): number => {
    if (spent.has(key.keyId)) return 0
    const resting = restingUntil.get(key.keyId)
    if (resting !== undefined && resting > deps.now().getTime()) return 0
    return keyRoom(key, (used.get(key.keyId) ?? 0) + (inFlight.get(key.keyId) ?? 0))
  }
  const keys = (): RotationKey[] =>
    loadRotationKeys(deps.storage, context.project, rotation, provider)
  const spreading = rotation === 'spread_evenly' && project.dedicatedKeyId === null
  /**
   * The key for the next search. In order: the first key with room. Spread evenly: the
   * first key with room after the one that made the last search. A dedicated key is the
   * whole pool (FR-11.4).
   */
  const first = (pool: readonly RotationKey[]): RotationKey | null => {
    if (!spreading || pool.length === 0) return pool.find((key) => roomOf(key) > 0) ?? null
    const last = pool.findIndex((key) => key.keyId === cursor.lastKeyId)
    for (let offset = 1; offset <= pool.length; offset += 1) {
      const key = pool[(last + offset + pool.length) % pool.length]
      if (key !== undefined && roomOf(key) > 0) return key
    }
    return null
  }
  /** FR-11.3 next key after a failure. A dedicated key has no next key. */
  const after = (pool: readonly RotationKey[], failedKeyId: string): RotationKey | null => {
    const roomById = (keyId: string): number => {
      const key = pool.find((item) => item.keyId === keyId)
      return key === undefined ? 0 : roomOf(key)
    }
    const next = nextKeyAfter(
      pool,
      failedKeyId,
      project,
      rotation,
      (key) => roomById(key.keyId),
      provider
    )
    return next === null ? null : (pool.find((key) => key.keyId === next.keyId) ?? null)
  }

  async function once<T extends KeyedOutcome>(
    key: RotationKey,
    gate: ProviderGate,
    run: (secret: string) => Promise<T>,
    missing: (message: string, nextStep: string) => T
  ): Promise<T> {
    const secret = deps.secrets.get(keychainRef(deps, key.keyId))
    if (secret === null) {
      return missing(
        `The ${name} key is missing from the keychain.`,
        `Open Connections and add a ${name} key.`
      )
    }
    inFlight.set(key.keyId, (inFlight.get(key.keyId) ?? 0) + 1)
    let captured: T
    try {
      captured = await run(secret)
    } finally {
      inFlight.set(key.keyId, (inFlight.get(key.keyId) ?? 1) - 1)
    }
    if (captured.searches > 0) cursor.lastKeyId = key.keyId
    for (let index = 0; index < captured.searches; index += 1) context.onSearch?.(key.keyId)
    if (context.chargeUsage && captured.searches > 0) {
      addKeyUsage(deps.storage.db, {
        id: deps.createId(),
        keyId: key.keyId,
        projectId: context.usageProjectId,
        month: context.month,
        searches: captured.searches,
        calls: 1,
        tokens: 0,
        credits: captured.credits ?? 0
      })
      gate.settle?.(captured.searches)
    }
    if (captured.searches > 0)
      recordSearches(deps, key.keyId, context.usageProjectId, captured.searches)
    used.set(key.keyId, (used.get(key.keyId) ?? 0) + captured.searches)
    remember(key.keyId, captured)
    return captured
  }

  function remember(keyId: string, captured: KeyedOutcome): void {
    const code = captured.errorCode
    if (code !== null && SPENT.has(code)) spent.add(keyId)
    if (code === 'rate_limited') {
      if (captured.retryAfterMs !== null) {
        restingUntil.set(keyId, deps.now().getTime() + captured.retryAfterMs)
      }
      recordEvent(deps, keyId, 'rate_limited', `${name} is limiting this key.`)
    } else if (code === 'rejected' || code === 'out_of_searches') {
      recordEvent(deps, keyId, 'failed', captured.message ?? `${name} did not accept this key.`)
    }
  }

  /** Runs one call on the first key with room, and once more on the next key after a failover. */
  async function rotate<T extends KeyedOutcome>(
    gate: ProviderGate,
    run: (secret: string) => Promise<T>,
    missing: (message: string, nextStep: string) => T
  ): Promise<{ value: T; keyId: string | null; attempts: KeyAttempt[]; exhausted: boolean }> {
    const primary = first(keys())
    if (primary === null) {
      return { value: missing('', ''), keyId: null, attempts: [], exhausted: true }
    }
    // Spread evenly: move the cursor now, so a call that starts while this one runs
    // takes the next key instead of the same one.
    if (spreading) cursor.lastKeyId = primary.keyId
    const initial = await once(primary, gate, run, missing)
    const attempts: KeyAttempt[] = [{ keyId: primary.keyId, searches: initial.searches }]
    const settled = { value: initial, keyId: primary.keyId, attempts, exhausted: false }
    if (initial.halted || gate.stopRequested()) return settled
    if (initial.errorCode === null || !FAILOVER.has(initial.errorCode)) return settled
    const next = after(keys(), primary.keyId)
    if (next === null) return settled
    deps.logger.info(`${provider} failover`, { from: primary.keyId, to: next.keyId })
    recordEvent(
      deps,
      primary.keyId,
      'failover',
      `CiteFox moved this search to the next ${name} key.`
    )
    const second = await once(next, gate, run, missing)
    if (second.halted && second.searches === 0) return settled
    attempts.push({ keyId: next.keyId, searches: second.searches })
    return {
      value: {
        ...second,
        searches: initial.searches + second.searches,
        credits: (initial.credits ?? 0) + (second.credits ?? 0)
      },
      keyId: next.keyId,
      attempts,
      exhausted: false
    }
  }

  const captureOptions = (
    secret: string,
    query: CaptureQuery,
    gate: ProviderGate
  ): CloroCaptureOptions => ({
    transport: deps.http,
    secret,
    query,
    secrets: [...(deps.knownSecrets?.() ?? []), secret],
    sleep: deps.sleep,
    beforeRequest: gate.allow,
    stopRequested: gate.stopRequested,
    now: () => deps.now().getTime(),
    logger: deps.logger,
    // Every call to the provider shares one pace: a 429 slows all of them down.
    pacer: providerPacer(deps.storage.db, provider, {
      sleep: deps.sleep,
      now: () => deps.now().getTime()
    })
  })

  return {
    provider,
    keys,
    exhausted: () => first(keys()) === null,
    async capture(query, gate) {
      const outcome = await rotate<SerpCapture>(
        gate,
        (secret) =>
          provider === 'cloro'
            ? captureCloroGoogle(captureOptions(secret, query, gate))
            : captureSerpApi(captureOptions(secret, query, gate)).then((capture) => {
                logSerpApiFailure(deps.logger, capture)
                return capture
              }),
        (message, nextStep) => ({
          ...emptyCapture(),
          ...(message.length === 0 ? {} : { errorCode: 'other' as const, message, nextStep })
        })
      )
      return {
        ...outcome.value,
        keyId: outcome.keyId,
        attempts: outcome.attempts,
        exhausted: outcome.exhausted
      }
    },
    async answer(engine, query, gate) {
      if (provider !== 'cloro') return { ...emptyAnswer(), keyId: null, exhausted: true }
      const outcome = await rotate<AnswerCapture>(
        gate,
        (secret) => captureCloroAnswer(engine, captureOptions(secret, query, gate)),
        (message, nextStep) => ({
          ...emptyAnswer(),
          ...(message.length === 0 ? {} : { errorCode: 'other' as const, message, nextStep })
        })
      )
      return { ...outcome.value, keyId: outcome.keyId, exhausted: outcome.exhausted }
    }
  }
}

export function emptyCapture(): SerpCapture {
  return {
    hasAio: false,
    neededFollowup: false,
    searches: 0,
    halted: false,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: null,
    references: [],
    rawSearchJson: null,
    rawAioJson: null,
    retryAfterMs: null
  }
}

/** FR-11.10. Timestamped searches for Connections' last 24 hours. Never blocks a check. */
function recordSearches(
  deps: KeyRotationDeps,
  keyId: string,
  projectId: string | null,
  count: number
): void {
  try {
    recordActivity(deps.storage.db, {
      id: deps.createId(),
      at: deps.now().toISOString(),
      kind: 'search',
      keyId,
      projectId,
      count,
      detail: null
    })
  } catch (error) {
    deps.logger.warn('could not record search activity', {
      message: error instanceof Error ? error.message : 'write failed'
    })
  }
}

function keychainRef(deps: KeyRotationDeps, keyId: string): string {
  return listApiKeys(deps.storage.db).find((key) => key.id === keyId)?.keychainRef ?? ''
}

function recordEvent(
  deps: KeyRotationDeps,
  keyId: string,
  kind: 'rate_limited' | 'failed' | 'failover',
  detail: string
): void {
  insertConnectionEvent(deps.storage.db, {
    id: deps.createId(),
    keyId,
    at: deps.now().toISOString(),
    kind,
    detail
  })
}
