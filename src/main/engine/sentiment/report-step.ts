import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import type { GenerationCallCaps } from '../../pipeline/llm'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import { listStoredCheckRuns } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { emitMainEvent } from '../../ipc-events'
import type { Limiter } from '../checks/check-pace'
import { filterFor } from '../checks/results'
import { startReading } from './activity'
import { readRunSentiment } from './read'

/**
 * The check report runner's sentiment step (FR-16.2): after a job's searches
 * and its gap and summary reports, Claude reads each finished run's overviews.
 * It never holds a check or its queue slot, stops with the job's report, and
 * pushes `sentiment:updated` per page when that page's runs are read.
 */
export async function readJobSentiment(
  deps: {
    db: SqliteDatabase
    appDb: SqliteDatabase
    claude: ClaudeProvider
    logger: Logger
    secrets: readonly string[]
    caps: GenerationCallCaps
    now: () => Date
    createId: () => string
    shouldStop: () => boolean
    /** The job's Claude limiter: overviews are read side by side up to its size. */
    limiter?: Limiter
  },
  projectId: string,
  runIds: readonly string[]
): Promise<void> {
  const byPage = new Map<string, string[]>()
  for (const runId of runIds) {
    const run = listStoredCheckRuns(deps.db, filterFor(projectId, null, null, runId)).find(
      (item) => item.id === runId
    )
    if (run === undefined) continue
    byPage.set(run.pageId, [...(byPage.get(run.pageId) ?? []), run.id])
  }
  for (const [pageId, pageRuns] of byPage) {
    if (deps.shouldStop()) return
    const done = startReading(projectId, pageId)
    try {
      for (const runId of pageRuns) {
        if (deps.shouldStop()) break
        await readRunSentiment(
          {
            db: deps.db,
            appDb: deps.appDb,
            claude: deps.claude,
            logger: deps.logger,
            secrets: deps.secrets,
            caps: deps.caps,
            now: () => deps.now().toISOString(),
            createId: deps.createId,
            shouldStop: deps.shouldStop,
            ...(deps.limiter !== undefined ? { limiter: deps.limiter } : {})
          },
          { projectId, runId }
        )
      }
    } catch (error) {
      deps.logger.error('sentiment read failed', {
        message: redactString(error instanceof Error ? error.message : 'Sentiment read failed', {
          secrets: deps.secrets,
          hexKeys: true
        })
      })
    } finally {
      done()
      emitMainEvent('sentiment:updated', { projectId, pageId })
    }
  }
}
