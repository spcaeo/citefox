import { randomUUID } from 'node:crypto'
import { openEngineEmail } from '../email/engine-email'
import { claudeSummaryWriter } from '../email/summary-writer'
import { openCheckClaude } from '../engine/claude'
import { generateGaps } from '../engine/gaps'
import { createEngineMemory, type EngineHost } from '../engine/host'
import { startPageRead } from '../engine/page-read'
import type { Logger } from '../logging/logger'
import type { BinaryProbe } from '../providers/claude/binary'
import type { CommandTransport } from '../providers/command'
import type { HttpTransport } from '../providers/http'
import { SERPAPI_LOCATIONS } from '../providers/serpapi/locations'
import type { SecretStore } from '../secrets/secret-store'
import type { SetupRunner } from '../setup-runner/runner'
import { createSetupRunner } from '../setup-runner/runner'
import type { AppStorage } from '../storage/app-storage'
import { createStructureRuntime, type StructureRuntime } from '../structure/runtime'
import { dueSyncProjects } from '../structure/due-sync'
import { HEADLESS_MAX_WAIT_MS } from './storage-pass'

/**
 * `citefox --check-due` after the page checks: due sitemap syncs (FR-19.2), then
 * background page setup (FR-20.6), inside one budget. The budget is the
 * scheduler's headless rule (`HEADLESS_MAX_WAIT_MS`): nothing new starts after
 * it, a running step finishes, and the next OS job run picks up the rest.
 */
export const HEADLESS_BACKGROUND_BUDGET_MS = HEADLESS_MAX_WAIT_MS

export interface BackgroundPassDeps {
  host: EngineHost
  runner: SetupRunner
  structure: StructureRuntime
  now: () => number
  budgetMs?: number
  /** True hands off to the window (the user opened CiteFox). */
  shouldStop?: () => boolean
}

export interface BackgroundPassResult {
  syncedProjects: string[]
  /** Projects whose sync was not started because the budget ended. */
  skippedProjects: string[]
}

export async function runBackgroundPass(deps: BackgroundPassDeps): Promise<BackgroundPassResult> {
  const deadline = deps.now() + (deps.budgetMs ?? HEADLESS_BACKGROUND_BUDGET_MS)
  const over = (): boolean => deps.now() >= deadline || deps.shouldStop?.() === true
  const syncedProjects: string[] = []
  const skippedProjects: string[] = []
  for (const projectId of dueSyncProjects(deps.host, new Date(deps.now()))) {
    if (over()) {
      skippedProjects.push(projectId)
      continue
    }
    try {
      await deps.structure.sync(projectId, 'scheduled')
      syncedProjects.push(projectId)
    } catch (error) {
      deps.host.logger.warn('scheduled sitemap sync failed', {
        message: error instanceof Error ? error.message : 'failed'
      })
    }
    // Re-reads of changed pages run behind the sync; they finish before storage closes.
    await deps.structure.rereadsIdle(projectId)
  }
  if (!over()) await deps.runner.runFor(deadline - deps.now(), deps.shouldStop)
  return { syncedProjects, skippedProjects }
}

export interface BackgroundParts {
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  http: HttpTransport
  command: CommandTransport
  probe: BinaryProbe
  knownSecrets: () => readonly string[]
  now?: () => Date
}

/**
 * The engine host for the headless run: the same storage, keychain, transports,
 * and Claude parts as the window, with no renderer to push events to. Re-reads
 * after a sync stop once the budget is spent. `close` releases the email store.
 */
export function openBackgroundPass(
  parts: BackgroundParts,
  options: { budgetMs?: number; shouldStop?: () => boolean } = {}
): { run: () => Promise<BackgroundPassResult>; close: () => void } {
  const now = parts.now ?? ((): Date => new Date())
  const email = openEngineEmail({
    storage: parts.storage,
    secrets: parts.secrets,
    logger: parts.logger,
    knownSecrets: parts.knownSecrets,
    summaryWriter: claudeSummaryWriter(() => openCheckClaude(parts))
  })
  const host: EngineHost = {
    storage: parts.storage,
    secrets: parts.secrets,
    logger: parts.logger,
    http: parts.http,
    claudeCommand: parts.command,
    claudeProbe: parts.probe,
    knownSecrets: parts.knownSecrets,
    now,
    createId: () => randomUUID(),
    locations: SERPAPI_LOCATIONS,
    emitPageReadProgress: () => undefined,
    emitFillProgress: () => undefined,
    memory: createEngineMemory(),
    settings: () => parts.storage.readSettings(),
    email
  }
  const budgetMs = options.budgetMs ?? HEADLESS_BACKGROUND_BUDGET_MS
  // Set when the pass starts, after the page checks.
  let deadline = Number.POSITIVE_INFINITY
  const structure = createStructureRuntime(host, {
    reread: async (projectId, pageId, withGaps) => {
      if (now().getTime() >= deadline) return
      await startPageRead(host, { projectId, pageId, reader: 'auto', suppliedText: null })
      if (withGaps && now().getTime() < deadline) await generateGaps(host, { projectId, pageId })
    }
  })
  const runner = createSetupRunner({ host })
  return {
    run: () => {
      deadline = now().getTime() + budgetMs
      return runBackgroundPass({
        host,
        runner,
        structure,
        now: () => now().getTime(),
        budgetMs,
        ...(options.shouldStop !== undefined ? { shouldStop: options.shouldStop } : {})
      })
    },
    close: () => {
      runner.stop()
      email.close()
    }
  }
}
