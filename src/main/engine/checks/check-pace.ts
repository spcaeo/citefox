import type { SearchProvider } from '@shared/domain'
import type { EngineRotation } from './key-rotation'
import { PROVIDER_CALLS_AT_ONCE, providerPacer } from './provider-pacer'

export { PROVIDER_CALLS_AT_ONCE }

/**
 * How many things a check does at once (owner, 2026-10-29: a 12-question check took over
 * ten minutes, one search after another). Questions of one market run in a small pool;
 * every call to a provider (Google and the answer engines, from every running job) shares
 * one limit, so three questions on six engines cannot flood cloro and come back rate
 * limited. A job's first call to each provider goes alone, so a bad key is found once.
 */

/** Questions of one market checked at the same time. */
export const CHECK_QUESTIONS_AT_ONCE = 3

export interface Limiter {
  run<T>(work: () => Promise<T>): Promise<T>
  /** Calls running now, for tests. */
  active(): number
}

/**
 * At most `limit` calls run at once; the rest wait in order. With `firstAlone`, the very
 * first call runs on its own and the rest start once it is back, so a key that is empty,
 * rate limited or switched off is found by one call rather than by every call at once.
 */
export function createLimiter(limit: number, firstAlone = false): Limiter {
  const max = Math.max(1, Math.floor(limit))
  const waiting: Array<() => void> = []
  let running = 0
  let opened = !firstAlone
  const room = (): number => (opened ? max : 1)
  const release = (): void => {
    running -= 1
    opened = true
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
        release()
      }
    },
    active: () => running
  }
}

/**
 * The provider's shared limit on calls at once. It is adaptive (provider-pacer.ts): it
 * starts careful for a new key, opens while calls succeed and halves on a 429.
 */
export function providerLimiter(app: object, provider: SearchProvider): Limiter {
  return providerPacer(app, provider).limiter
}

/**
 * The same rotation, with every Google capture and engine answer through the provider's
 * shared `limiter`, after the job's own first call (`createLimiter(Infinity, true)`).
 */
export function limitRotation(
  rotation: EngineRotation,
  limiter: Limiter,
  firstCall: Limiter = createLimiter(Number.POSITIVE_INFINITY, true)
): EngineRotation {
  const run = <T>(work: () => Promise<T>): Promise<T> => firstCall.run(() => limiter.run(work))
  return {
    provider: rotation.provider,
    keys: () => rotation.keys(),
    exhausted: () => rotation.exhausted(),
    capture: (query, gate) => run(() => rotation.capture(query, gate)),
    answer: (engine, query, gate) => run(() => rotation.answer(engine, query, gate))
  }
}

/**
 * Runs `work` over `items` with at most `limit` at once, started in item order. Once
 * `stopped()` is true no new item starts; the ones already running finish. Resolves when
 * all have. A throw stops new items too and is thrown again once the others are done, so
 * nothing still writes after the caller closes the database.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  stopped: () => boolean,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  let failure: { error: unknown } | null = null
  const worker = async (): Promise<void> => {
    while (failure === null && next < items.length && !stopped()) {
      const item = items[next] as T
      next += 1
      try {
        await work(item)
      } catch (error) {
        failure ??= { error }
      }
    }
  }
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  if (failure !== null) throw (failure as { error: unknown }).error
}
