import { FAVICON_BATCH_MAX, type FaviconEntry, type FaviconResult } from '@shared/ipc'
import type { FaviconCache } from './cache'
import { faviconDomain } from './fetch'

/**
 * `favicons:get`: cached icons at once, the rest fetched (a few at a time,
 * each with its own timeout) and cached, found or not. The same domain asked
 * for twice while its fetch runs shares that one fetch. When icons are switched
 * off (unpackaged test runs) nothing is fetched and the answer is empty.
 */
export interface FaviconService {
  get(domains: readonly string[]): Promise<FaviconResult>
}

export interface FaviconServiceDeps {
  /** Opened on first use, so a run that never shows an icon never creates the file. */
  cache: () => FaviconCache
  fetch: (domain: string) => Promise<string | null>
  now: () => number
  /** False: answer nothing and fetch nothing. */
  enabled: () => boolean
  /** Fetches running at once across all callers. */
  concurrency?: number
}

export function createFaviconService(deps: FaviconServiceDeps): FaviconService {
  const inFlight = new Map<string, Promise<string | null>>()
  const limit = Math.max(1, deps.concurrency ?? 4)
  let running = 0
  const waiting: Array<() => void> = []
  let cache: FaviconCache | null = null

  function openCache(): FaviconCache {
    cache ??= deps.cache()
    return cache
  }

  async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    running += 1
    try {
      return await work()
    } finally {
      running -= 1
      waiting.shift()?.()
    }
  }

  function readCache(domain: string): { dataUri: string | null } | null {
    try {
      return openCache().get(domain, deps.now())
    } catch {
      return null
    }
  }

  function fetchOnce(domain: string): Promise<string | null> {
    const existing = inFlight.get(domain)
    if (existing !== undefined) return existing
    const task = slot(async () => {
      const dataUri = await Promise.resolve()
        .then(() => deps.fetch(domain))
        .catch((): string | null => null)
      try {
        openCache().put(domain, dataUri, deps.now())
      } catch {
        // A cache that cannot be written only means the icon is fetched again next time.
      }
      return dataUri
    }).finally(() => inFlight.delete(domain))
    inFlight.set(domain, task)
    return task
  }

  return {
    async get(domains) {
      if (!deps.enabled()) return { icons: [] }
      const wanted = [
        ...new Set(
          domains.flatMap((value) => {
            const domain = typeof value === 'string' ? faviconDomain(value) : null
            return domain === null ? [] : [domain]
          })
        )
      ].slice(0, FAVICON_BATCH_MAX)
      const icons = await Promise.all(
        wanted.map(async (domain): Promise<FaviconEntry> => {
          const cached = readCache(domain)
          if (cached !== null) return { domain, dataUri: cached.dataUri }
          return { domain, dataUri: await fetchOnce(domain) }
        })
      )
      return { icons }
    }
  }
}
