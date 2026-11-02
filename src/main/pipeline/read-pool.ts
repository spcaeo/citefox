/**
 * Page reads side by side, politely (owner, 2026-10-29). Reading a site's pages one
 * after another took two minutes for thirteen pages. Every page read (Jina Reader or a
 * direct fetch, with their own retries and timeouts) takes a turn here: a few at once
 * across the app, and never more than two on one site, so a small site is not hammered.
 * Waiting reads start in the order they asked, skipping only those whose site is full.
 */

/** Page reads in flight across the app. */
export const PAGE_READS_AT_ONCE = 4
/** Page reads in flight on one site (`www.` and case ignored). */
export const PAGE_READS_PER_SITE = 2

export interface ReadPool {
  /** Runs `work` once there is room overall and on `url`'s site. */
  run<T>(url: string, work: () => Promise<T>): Promise<T>
  /** Reads running now, for tests. */
  active(): number
}

/** The site a URL belongs to: its host without `www.`, or the text itself when not a URL. */
export function siteKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return url.trim().toLowerCase()
  }
}

export function createReadPool(
  overall: number = PAGE_READS_AT_ONCE,
  perSite: number = PAGE_READS_PER_SITE
): ReadPool {
  const max = Math.max(1, Math.floor(overall))
  const maxPerSite = Math.max(1, Math.floor(perSite))
  const waiting: Array<{ site: string; start: () => void }> = []
  const bySite = new Map<string, number>()
  let running = 0
  const room = (site: string): boolean => running < max && (bySite.get(site) ?? 0) < maxPerSite
  const take = (site: string): void => {
    running += 1
    bySite.set(site, (bySite.get(site) ?? 0) + 1)
  }
  const release = (site: string): void => {
    running -= 1
    const left = (bySite.get(site) ?? 1) - 1
    if (left <= 0) bySite.delete(site)
    else bySite.set(site, left)
    for (let index = 0; index < waiting.length && running < max;) {
      const next = waiting[index]
      if (next !== undefined && room(next.site)) {
        waiting.splice(index, 1)
        take(next.site)
        next.start()
      } else {
        index += 1
      }
    }
  }
  return {
    async run(url, work) {
      const site = siteKey(url)
      if (room(site) && !waiting.some((item) => item.site === site)) {
        take(site)
      } else {
        await new Promise<void>((start) => waiting.push({ site, start }))
      }
      try {
        return await work()
      } finally {
        release(site)
      }
    },
    active: () => running
  }
}

let shared: ReadPool | null = null

/** The app's one read pool, shared by every flow that reads pages. */
export function sharedReadPool(): ReadPool {
  shared ??= createReadPool()
  return shared
}

/** Test-only. A fresh pool, so a stuck test cannot hold turns for the next one. */
export function resetSharedReadPoolForTests(): void {
  shared = null
}
