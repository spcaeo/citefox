import type { SearchProvider } from '@shared/domain'
import type { Limiter } from './check-pace'

/**
 * One shared, adaptive pace per search provider (cloro, SerpApi) across the whole app.
 *
 * Why: a free cloro plan refuses bursts (HTTP 429), and a check used to send 13 calls in
 * one second, so most questions ended as "Check failed". The pacer slows every worker
 * down together and lets the run finish:
 *
 * - it starts careful (cloro: 1 call at once, at most one call start per second) and
 *   opens up step by step while calls keep succeeding, up to `maxLimit`;
 * - any 429 halves the number of calls at once (never below 1) and opens a shared
 *   COOLDOWN: no call to that provider starts until the Retry-After (seconds or an HTTP
 *   date) has passed, or without one an exponential backoff with jitter (2 s, 4 s, 8 s,
 *   ... capped at 60 s). Every worker waits, so 13 questions cannot all retry together;
 * - the many 429s of one burst count as one wave (one halving, one backoff step).
 *
 * The clock, the sleep and the random source are injected, so tests run in no time.
 */

/** Calls in flight per provider across the app, once the key has proven itself. */
export const PROVIDER_CALLS_AT_ONCE = 4

/** HTTP attempts per call when the provider answers 429: the first and five retries. */
export const RATE_LIMIT_ATTEMPTS = 6

/** First cooldown without a Retry-After. It doubles with every wave in a row. */
export const BACKOFF_BASE_MS = 2_000

/** The longest backoff without a Retry-After. */
export const BACKOFF_CAP_MS = 60_000

/**
 * A Retry-After up to this is waited for. A longer one (minutes or hours) means a quota
 * that waiting inside a check will not fix, so the call stops trying.
 */
export const MAX_RETRY_AFTER_MS = 120_000

/** A wait is slept in slices this long, so Stop is noticed within a second. */
export const WAIT_SLICE_MS = 1_000

export interface PacingConfig {
  /** Calls at once before the key has proven itself. */
  initialLimit: number
  /** Calls at once at the most. */
  maxLimit: number
  /** Least time between two call starts, in milliseconds. 0 for none. */
  minGapMs: number
  /** Successes in a row that open the limit by one. */
  widenAfter: number
}

export const PACING: Readonly<Record<SearchProvider, PacingConfig>> = {
  cloro: { initialLimit: 1, maxLimit: PROVIDER_CALLS_AT_ONCE, minGapMs: 1_000, widenAfter: 2 },
  serpapi: {
    initialLimit: PROVIDER_CALLS_AT_ONCE,
    maxLimit: PROVIDER_CALLS_AT_ONCE,
    minGapMs: 0,
    widenAfter: 3
  }
}

/** The most successes in a row asked before the limit opens again. */
const MAX_WIDEN_AFTER = 24

/** The gap between call starts grows after a 429, up to this many times its base. */
const GAP_GROWTH_CAP = 4

export interface CallTicket {
  /** When the call may start, on the pacer's clock. */
  startedAt: number
}

export interface RateLimitVerdict {
  /** How long the shared cooldown still runs from now. */
  waitMs: number
  /** True when Retry-After is too long to wait for inside a check: stop trying. */
  giveUp: boolean
}

export interface SlowedEvent {
  provider: SearchProvider
  /** The cooldown's length from now, in milliseconds. */
  waitMs: number
  /** Calls at once after the 429. */
  limit: number
}

export interface PacerState {
  limit: number
  strikes: number
  cooldownUntil: number
  gapMs: number
}

export interface CallPacer {
  readonly provider: SearchProvider
  /** The provider's shared concurrency limit. It follows the pacer's current limit. */
  readonly limiter: Limiter
  /**
   * Waits until a call to the provider may start: the shared cooldown and the gap since
   * the last start. Starts are handed out one by one, in order. Null when `stop` turned
   * true during a wait (the call must not start); with no wait it is not asked.
   */
  begin(stop?: () => boolean): Promise<CallTicket | null>
  /** A call came back without a rate limit. A streak of these opens the limit. */
  succeeded(): void
  /** A call came back 429. Opens or extends the shared cooldown and shrinks the limit. */
  rateLimited(ticket: CallTicket, retryAfterMs: number | null): RateLimitVerdict
  state(): PacerState
  /** Called when a 429 opens a new cooldown. Returns the way to stop listening. */
  onSlowed(listener: (event: SlowedEvent) => void): () => void
}

export interface PacerEnv {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** 0 up to 1. Tests pass a fixed one so the jitter is known. */
  random?: () => number
}

/** The cooldown without a Retry-After for the `strike`-th wave in a row (1, 2, 3...). */
export function backoffMs(strike: number, random: () => number = Math.random): number {
  const base = BACKOFF_BASE_MS * 2 ** Math.max(0, strike - 1)
  const jittered = base * (0.8 + 0.4 * random())
  return Math.min(BACKOFF_CAP_MS, Math.round(jittered))
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A concurrency limit that can change while calls wait and run. */
function adaptiveLimiter(limit: () => number): Limiter & { wake(): void } {
  const waiting: Array<() => void> = []
  let running = 0
  const room = (): number => Math.max(1, Math.floor(limit()))
  const wake = (): void => {
    while (running < room() && waiting.length > 0) {
      running += 1
      waiting.shift()?.()
    }
  }
  return {
    async run(work) {
      if (running >= room() || waiting.length > 0) {
        await new Promise<void>((resolve) => waiting.push(resolve))
      } else {
        running += 1
      }
      try {
        return await work()
      } finally {
        running -= 1
        wake()
      }
    },
    active: () => running,
    wake
  }
}

export function createCallPacer(
  provider: SearchProvider,
  env: PacerEnv = {},
  config: PacingConfig = PACING[provider]
): CallPacer {
  const now = env.now ?? Date.now
  const sleep = env.sleep ?? realSleep
  const random = env.random ?? Math.random
  const baseGap = config.minGapMs
  let limit = Math.max(1, config.initialLimit)
  let gapMs = baseGap
  let strikes = 0
  let streak = 0
  // Successes in a row that open the limit. A 429 doubles it, so a plan that really
  // allows 1 at a time is probed less and less often.
  let widenNeeded = config.widenAfter
  let cooldownUntil = Number.NEGATIVE_INFINITY
  let lastStart = Number.NEGATIVE_INFINITY
  let tail: Promise<unknown> = Promise.resolve()
  const listeners = new Set<(event: SlowedEvent) => void>()
  const limiter = adaptiveLimiter(() => limit)

  const wait = async (stop?: () => boolean): Promise<CallTicket | null> => {
    let at = now()
    let target = Math.max(at, lastStart + gapMs, cooldownUntil)
    while (target > at) {
      if (stop?.() === true) return null
      const slice = Math.min(WAIT_SLICE_MS, target - at)
      await sleep(slice)
      at += slice
      // Another worker's 429 may have pushed the cooldown while this one slept.
      if (cooldownUntil > target) target = cooldownUntil
    }
    const startedAt = Math.max(at, now())
    lastStart = startedAt
    return { startedAt }
  }

  return {
    provider,
    limiter,
    begin(stop) {
      const mine = tail.then(() => wait(stop))
      tail = mine.catch(() => null)
      return mine
    },
    succeeded() {
      strikes = 0
      streak += 1
      if (streak >= widenNeeded && limit < config.maxLimit) {
        streak = 0
        limit += 1
        gapMs = Math.max(baseGap, Math.floor(gapMs / 2))
        limiter.wake()
      }
    },
    rateLimited(ticket, retryAfterMs) {
      // A Retry-After of minutes is a quota on the key, not a burst: no shared cooldown.
      // The key rotation rests that key and moves on.
      if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_AFTER_MS) {
        return { waitMs: 0, giveUp: true }
      }
      const at = Math.max(now(), ticket.startedAt)
      // A call that started before the cooldown ended is part of the wave that opened it.
      const newWave = ticket.startedAt >= cooldownUntil
      if (newWave) {
        strikes += 1
        streak = 0
        widenNeeded = Math.min(widenNeeded * 2, MAX_WIDEN_AFTER)
        limit = Math.max(1, Math.floor(limit / 2))
        if (baseGap > 0) gapMs = Math.min(gapMs * 2, baseGap * GAP_GROWTH_CAP)
      }
      const hinted = retryAfterMs !== null && retryAfterMs > 0
      if (newWave || hinted) {
        const wanted = hinted ? retryAfterMs : backoffMs(strikes, random)
        const before = cooldownUntil
        cooldownUntil = Math.max(cooldownUntil, at + wanted)
        if (cooldownUntil > before) {
          for (const listener of listeners) {
            listener({ provider, waitMs: cooldownUntil - at, limit })
          }
        }
      }
      return { waitMs: Math.max(0, cooldownUntil - at), giveUp: false }
    },
    state: () => ({ limit, strikes, cooldownUntil, gapMs }),
    onSlowed(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/** One pacer per provider for each app database, shared by every job. */
const shared = new WeakMap<object, Map<SearchProvider, CallPacer>>()

export function providerPacer(
  app: object,
  provider: SearchProvider,
  env: PacerEnv = {}
): CallPacer {
  const byProvider = shared.get(app) ?? new Map<SearchProvider, CallPacer>()
  shared.set(app, byProvider)
  const found = byProvider.get(provider)
  if (found !== undefined) return found
  const created = createCallPacer(provider, env)
  byProvider.set(provider, created)
  return created
}

/** Tests: installs `pacer` as the provider's shared pace, or forgets it with null. */
export function setProviderPacer(
  app: object,
  provider: SearchProvider,
  pacer: CallPacer | null
): void {
  const byProvider = shared.get(app) ?? new Map<SearchProvider, CallPacer>()
  shared.set(app, byProvider)
  if (pacer === null) byProvider.delete(provider)
  else byProvider.set(provider, pacer)
}
