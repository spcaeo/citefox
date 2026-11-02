import { ENGINE_IDS, ENGINE_LABEL, normaliseEngines, type EngineId } from '@shared/domain'
import type { CheckSpend, EngineSpendView } from '@shared/ipc'
import { monthKey } from '../../scheduler/local-time'
import type { SqliteDatabase } from '../../storage/database'
import { listJobSpend, sumEngineSpend } from '../../storage/engine-reads'
import { sumProviderUsageForMonth } from '../../storage/key-usage'

/** Checks a spend view lists. */
const CHECKS_SHOWN = 50

const DAY_MS = 86_400_000

/**
 * What a project's checks spent in one month (`YYYY-MM` in `zone`): each check's
 * searches, credits and money, per engine, and every project's use of each provider.
 */
export function engineSpendView(input: {
  db: SqliteDatabase
  appDb: SqliteDatabase
  projectId: string
  month: string
  zone: string
}): EngineSpendView {
  const [year, month] = input.month.split('-').map(Number) as [number, number]
  // A day either side covers every time zone; the month key then picks the exact jobs.
  const from = new Date(Date.UTC(year, month - 1, 1) - DAY_MS).toISOString()
  const to = new Date(Date.UTC(year, month, 1) + DAY_MS).toISOString()
  const jobs = listJobSpend(input.db, from, to).filter(
    (job) => monthKey(Date.parse(job.startedAt), input.zone) === input.month
  )
  const total = { searches: 0, credits: 0, costMicros: 0, checks: jobs.length }
  for (const job of jobs) {
    total.searches += job.searches
    total.credits += job.credits
    total.costMicros += job.costMicros
  }
  const byEngine = new Map(
    sumEngineSpend(
      input.db,
      jobs.map((job) => job.jobId)
    ).map((row) => [row.engine, row])
  )
  const checks: CheckSpend[] = jobs.slice(0, CHECKS_SHOWN).map((job) => ({
    jobId: job.jobId,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    status: job.status,
    provider: job.provider,
    searches: job.searches,
    credits: job.credits,
    costMicros: job.costMicros,
    engines: enginesOf(job.enginesJson)
  }))
  return {
    projectId: input.projectId,
    month: input.month,
    total,
    byEngine: ENGINE_IDS.flatMap((engine) => {
      const row = byEngine.get(engine)
      return row === undefined
        ? []
        : [
            {
              engine,
              label: ENGINE_LABEL[engine],
              searches: row.searches,
              credits: row.credits,
              costMicros: row.costMicros
            }
          ]
    }),
    checks,
    account: sumProviderUsageForMonth(input.appDb, input.month)
  }
}

/** The engines of the job's first run. Empty for a job refused before any run. */
function enginesOf(encoded: string | null): EngineId[] {
  if (encoded === null) return []
  try {
    const parsed = JSON.parse(encoded) as unknown
    return Array.isArray(parsed) ? normaliseEngines(parsed) : []
  } catch {
    return []
  }
}
