import type { EngineHost } from '../engine/host'
import { createDirectoryTransport, fixtureDns } from './fixture-transport'
import {
  createStructureRuntime,
  type StructureRuntime,
  type StructureRuntimeOptions
} from './runtime'
import { dueSyncProjects } from './due-sync'

export { dueSyncProjects }

/**
 * FR-19.2 daily and weekly sitemap sync. While the app runs (window or tray),
 * a wall-clock tick looks for projects whose next sync time has passed, the
 * same way the tray loop re-checks due pages (SCH-3: timers do not count
 * sleep, so a short tick compares the clock). Syncs run one project at a time.
 * `--check-due` runs the same due syncs inside its budget (`headless/background-pass`).
 */

export const SYNC_TICK_MS = 5 * 60_000
/** First look shortly after start, so a missed daily sync is caught up. */
export const FIRST_TICK_MS = 60_000

const runtimes = new WeakMap<EngineHost, StructureRuntime>()

/** One runtime per engine host, so handlers and the loop share the per-project sync lock. */
export function structureRuntimeFor(
  host: EngineHost,
  options: StructureRuntimeOptions = {}
): StructureRuntime {
  const existing = runtimes.get(host)
  if (existing !== undefined) return existing
  const created = createStructureRuntime(host, options)
  runtimes.set(host, created)
  return created
}

export interface SyncLoopTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

/** Starts the loop. Returns a stop function. */
export function startSitemapSyncLoop(
  runtime: StructureRuntime,
  timers: SyncLoopTimers = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
): () => void {
  let stopped = false
  let handle: unknown = timers.set(tick, FIRST_TICK_MS)

  async function runDue(): Promise<void> {
    const host = runtime.host
    for (const projectId of dueSyncProjects(host, host.now())) {
      if (stopped) return
      try {
        await runtime.sync(projectId, 'scheduled')
      } catch (error) {
        host.logger.warn('scheduled sitemap sync failed', {
          message: error instanceof Error ? error.message : 'failed'
        })
      }
    }
  }

  function tick(): void {
    if (stopped) return
    void runDue()
      .catch((error: unknown) => {
        // Reading which projects are due can throw outside the per-project catch above.
        runtime.host.logger.warn('scheduled sitemap sync could not start', {
          message: error instanceof Error ? error.message : 'failed'
        })
      })
      .finally(() => {
        if (!stopped) handle = timers.set(tick, SYNC_TICK_MS)
      })
  }

  return () => {
    stopped = true
    timers.clear(handle)
  }
}

/**
 * Unpackaged builds only: `CITEFOX_E2E_SITEMAP_DIR` serves recorded sitemaps
 * from a folder so Playwright can press Sync now without the network.
 */
export function e2eSitemapFetch(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv
): StructureRuntimeOptions['sitemapFetch'] {
  const dir = env.CITEFOX_E2E_SITEMAP_DIR
  if (isPackaged || dir === undefined || dir.length === 0) return undefined
  return { http: createDirectoryTransport(dir), dns: fixtureDns }
}
