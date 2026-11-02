import { randomUUID } from 'node:crypto'
import { classifyRunAnswerShapes } from '../../analytics/answer-shape/classify'
import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import { generationCallCaps, type GenerationCallCaps } from '../../pipeline/llm'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import type { AppStorage } from '../../storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { getProject } from '../../storage/records'
import { isProjectClaudeProvider, type ClaudeHalt } from '../claude-fallback'
import { aiLimiter } from '../parallel'
import { ALL_PAGES, startReading } from '../sentiment/activity'
import { readJobSentiment } from '../sentiment/report-step'
import type { Limiter } from './check-pace'
import { checkReportsRoot } from './report-files'
import { resolveCheckTemplates } from './report-template-choice'
import { writeCheckReports } from './reports'

export interface ReportRunnerDeps {
  storage: AppStorage
  logger: Logger
  knownSecrets?: () => readonly string[]
  claude?: ClaudeProvider
  /**
   * FR-11.7. The job's project connection with its fallback. When it returns undefined
   * (or is omitted), `claude` is used.
   */
  claudeFor?: (projectId: string) => ClaudeProvider | undefined
  generationCaps?: GenerationCallCaps
  /** Test seam for the LLM-10 retry after a limit. Production uses `setTimeout`. */
  setTimer?: (run: () => void, ms: number) => void
  /**
   * FR-16.2. After the reports, Claude reads each finished full run's overviews
   * for brand sentiment. Production turns this on; tests that count report calls leave it off.
   */
  readSentiment?: boolean
  now?: () => Date
  createId?: () => string
}

/** LLM-10. A report stopped by a limit is tried again this many times at most. */
export const MAX_REPORT_RETRIES = 24

/**
 * FR-6.6 and FR-12.3 reports, written after a job's searches are done so the
 * Claude calls never hold a check (or its queue slot). Jobs are reported one at
 * a time, in the order they finished.
 */
export interface ReportRunner {
  /**
   * Queue `aio_gap.md` and `run_summary.md` for these finished runs of a job, then
   * classify each run's stored overviews into answer shapes (no new searches).
   */
  schedule(job: { id: string; projectId: string; domain: string }, runIds: readonly string[]): void
  /** Stops a job's queued or running report. Returns false when none is pending. */
  abort(jobId: string): boolean
  /** Resolves when every queued report has finished or stopped. */
  idle(): Promise<void>
}

export function createReportRunner(deps: ReportRunnerDeps): ReportRunner {
  const stopped = new Set<string>()
  const pending = new Set<string>()
  /** Jobs whose reports wait for a Claude limit to pass (LLM-10). */
  const waiting = new Set<string>()
  let chain: Promise<void> = Promise.resolve()
  return {
    schedule(job, runIds) {
      scheduleAttempt(job, runIds, 0)
    },
    abort(jobId) {
      if (!pending.has(jobId) && !waiting.has(jobId)) return false
      stopped.add(jobId)
      return true
    },
    idle: () => chain
  }

  function scheduleAttempt(
    job: { id: string; projectId: string; domain: string },
    runIds: readonly string[],
    attempt: number
  ): void {
    if (runIds.length === 0) return
    pending.add(job.id)
    // The Sentiment tab says Claude is reading from now until the sentiment step ends.
    const reading =
      attempt === 0 && deps.readSentiment === true ? startReading(job.projectId, ALL_PAGES) : null
    chain = chain
      .then(async () => {
        const left = await writeJobReports(deps, job, runIds, () => stopped.has(job.id))
        if (left === null || stopped.has(job.id)) return
        if (attempt + 1 > MAX_REPORT_RETRIES) {
          deps.logger.info('check report gave up after retries', { jobId: job.id })
          return
        }
        // LLM-10: the searches are stored; only the Claude part waits and runs again.
        waiting.add(job.id)
        const timer = deps.setTimer ?? unrefTimer
        timer(() => {
          waiting.delete(job.id)
          if (stopped.delete(job.id)) return
          scheduleAttempt(job, left.runIds, attempt + 1)
        }, left.retryAfterMs)
      })
      .catch((error: unknown) => {
        logFailure(deps, error)
      })
      .finally(() => {
        reading?.()
        pending.delete(job.id)
        if (!waiting.has(job.id)) stopped.delete(job.id)
      })
  }
}

/**
 * Writes the reports for these runs. Returns the runs still to write and when to try
 * again when the project's Claude fallback (`wait` or `retry_later`) stopped the calls,
 * otherwise null.
 */
async function writeJobReports(
  deps: ReportRunnerDeps,
  job: { id: string; projectId: string; domain: string },
  runIds: readonly string[],
  shouldStop: () => boolean
): Promise<{ runIds: readonly string[]; retryAfterMs: number } | null> {
  const secrets = deps.knownSecrets?.() ?? []
  const claude = deps.claudeFor?.(job.projectId) ?? deps.claude
  if (claude === undefined) {
    deps.logger.info('check report skipped', {
      message: redactString('Claude is unavailable, so the check report was not written.', {
        secrets,
        hexKeys: true
      })
    })
    return null
  }
  const project = getProject(deps.storage.db, job.projectId)
  if (project === null) return null
  const halted = (): ClaudeHalt | null => (isProjectClaudeProvider(claude) ? claude.halt() : null)
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
  // Every Claude task of this job waits its turn here, Settings' "Calls at once" at a
  // time, so the shared gate stays full without a queue that holds up the user's actions.
  const limiter = aiLimiter(deps.storage.readSettings().claudeConcurrency)
  try {
    // FR-26.8: the project's own aio_gap / run_summary version, else the app default.
    const templates = resolveCheckTemplates(deps.storage.db, db, deps.logger)
    for (let index = 0; index < runIds.length; index += 1) {
      const runId = runIds[index]
      if (runId === undefined) continue
      if (shouldStop()) return null
      try {
        await writeCheckReports({
          db,
          projectId: job.projectId,
          runId,
          domain: job.domain,
          reportsRoot: checkReportsRoot(deps.storage.paths.root),
          claude,
          secrets,
          logger: deps.logger,
          caps: deps.generationCaps ?? generationCallCaps(),
          shouldStop: () => shouldStop() || halted() !== null,
          templates,
          limiter
        })
      } catch (error) {
        logFailure(deps, error)
      }
      const halt = halted()
      if (halt !== null) {
        deps.logger.info('check report waiting on Claude', { rule: halt.rule })
        return halt.retryAfterMs === null
          ? null
          : { runIds: runIds.slice(index), retryAfterMs: halt.retryAfterMs }
      }
    }
    // The sentiment read and the answer shapes use different stored text and tables:
    // they run side by side, sharing the job's limiter.
    const sentiment =
      deps.readSentiment === true && !shouldStop() && halted() === null
        ? readJobSentiment(
            {
              db,
              appDb: deps.storage.db,
              claude,
              logger: deps.logger,
              secrets,
              caps: deps.generationCaps ?? generationCallCaps(),
              now: deps.now ?? (() => new Date()),
              createId: deps.createId ?? (() => randomUUID()),
              shouldStop: () => shouldStop() || halted() !== null,
              limiter
            },
            job.projectId,
            runIds
          )
        : Promise.resolve()
    // REPORT-SPEC section 9: classify the stored overviews into answer shapes. Stored
    // text only (never a search); each classification is cached by overview hash.
    const shapes = classifyJobAnswerShapes(deps, {
      db,
      projectId: job.projectId,
      runIds,
      claude,
      secrets,
      shouldStop: () => shouldStop() || halted() !== null,
      limiter
    })
    // Both settle before the database closes; neither one's failure stops the other.
    for (const step of await Promise.allSettled([sentiment, shapes])) {
      if (step.status === 'rejected') throw step.reason
    }
    return null
  } finally {
    closeProjectDatabase(db)
  }
}

/**
 * The answer-shape step: after the reports, beside the sentiment read, off the search
 * path. It stops when the job is aborted or the project's Claude fallback halts.
 */
async function classifyJobAnswerShapes(
  deps: ReportRunnerDeps,
  input: {
    db: Parameters<typeof classifyRunAnswerShapes>[0]['db']
    projectId: string
    runIds: readonly string[]
    claude: ClaudeProvider
    secrets: readonly string[]
    shouldStop: () => boolean
    limiter: Limiter
  }
): Promise<void> {
  for (const runId of input.runIds) {
    if (input.shouldStop()) return
    try {
      const result = await classifyRunAnswerShapes({
        db: input.db,
        appDb: deps.storage.db,
        projectId: input.projectId,
        runId,
        claude: input.claude,
        logger: deps.logger,
        secrets: input.secrets,
        caps: deps.generationCaps ?? generationCallCaps(),
        shouldStop: input.shouldStop,
        limiter: input.limiter
      })
      if (result.stopped) return
    } catch (error) {
      logAnswerShapeFailure(deps, error)
    }
  }
}

/** A retry timer that does not keep a headless `--check-due` run alive. */
function unrefTimer(run: () => void, ms: number): void {
  const handle = setTimeout(run, ms)
  handle.unref()
}

function logAnswerShapeFailure(deps: ReportRunnerDeps, error: unknown): void {
  deps.logger.error('answer shape failed', {
    message: redactString(
      error instanceof Error ? error.message : 'Could not classify the answer shapes.',
      { secrets: deps.knownSecrets?.() ?? [], hexKeys: true }
    )
  })
}

function logFailure(deps: ReportRunnerDeps, error: unknown): void {
  deps.logger.error('check report failed', {
    message: redactString(
      error instanceof Error ? error.message : 'Could not write the check report.',
      { secrets: deps.knownSecrets?.() ?? [], hexKeys: true }
    )
  })
}
