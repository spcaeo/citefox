import type { LlmCallRecord, LlmUsage, LlmUsageByConnection, LlmUsageByStep } from '@shared/ipc'
import type { AppStorage } from '../storage/app-storage'
import { listLlmCalls } from '../storage/llm-calls'
import { projectDatabasePool } from '../storage/project-db-pool'
import { getProject, listProjects } from '../storage/records'

/**
 * `llm:usage` for Status and Connections: Claude calls today and tokens this
 * month (FR-25.6). "Today" and "this month" are local calendar periods of the
 * computer running CiteFox. Reads every project file through the shared pool.
 */
export function readLlmUsage(
  storage: Pick<AppStorage, 'db' | 'paths'>,
  options: { projectId?: string; now: Date }
): LlmUsage {
  const monthStart = new Date(options.now.getFullYear(), options.now.getMonth(), 1)
  const dayStart = new Date(
    options.now.getFullYear(),
    options.now.getMonth(),
    options.now.getDate()
  )
  const rows = collect(storage, options.projectId, monthStart.toISOString())
  return summarizeLlmCalls(rows, { dayStart, builtAt: options.now })
}

/** Pure summary over rows from this month, newest first. */
export function summarizeLlmCalls(
  rows: readonly LlmCallRecord[],
  options: { dayStart: Date; builtAt: Date }
): LlmUsage {
  const sorted = [...rows].sort(
    (left, right) =>
      right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id)
  )
  const dayMs = options.dayStart.getTime()
  const today = sorted.filter((row) => Date.parse(row.startedAt) >= dayMs)
  const connections = new Map<LlmUsageByConnection['connection'], LlmUsageByConnection>()
  const steps = new Map<string, { calls: number; failed: number; duration: number }>()
  let tokensIn = 0
  let tokensOut = 0
  for (const row of sorted) {
    tokensIn += row.tokensIn
    tokensOut += row.tokensOut
    const connection = connections.get(row.connection) ?? {
      connection: row.connection,
      calls: 0,
      tokensIn: 0,
      tokensOut: 0
    }
    connection.calls += 1
    connection.tokensIn += row.tokensIn
    connection.tokensOut += row.tokensOut
    connections.set(row.connection, connection)
    const key = row.assistId ?? row.templateKind ?? row.source
    const step = steps.get(key) ?? { calls: 0, failed: 0, duration: 0 }
    step.calls += 1
    if (!row.ok) step.failed += 1
    step.duration += row.durationMs
    steps.set(key, step)
  }
  const byStep: LlmUsageByStep[] = [...steps.entries()]
    .map(([step, value]) => ({
      step,
      calls: value.calls,
      failed: value.failed,
      averageDurationMs: Math.round(value.duration / value.calls)
    }))
    .sort((left, right) => right.calls - left.calls || left.step.localeCompare(right.step))
  return {
    builtAt: options.builtAt.toISOString(),
    callsToday: today.length,
    failedToday: today.filter((row) => !row.ok).length,
    callsThisMonth: sorted.length,
    tokensInThisMonth: tokensIn,
    tokensOutThisMonth: tokensOut,
    byConnection: [...connections.values()].sort((left, right) => right.calls - left.calls),
    byStep,
    recent: sorted.slice(0, 20),
    recentErrors: sorted.filter((row) => !row.ok).slice(0, 10)
  }
}

function collect(
  storage: Pick<AppStorage, 'db' | 'paths'>,
  projectId: string | undefined,
  since: string
): LlmCallRecord[] {
  const rows: LlmCallRecord[] = []
  const appRows = listLlmCalls(storage.db, { since, projectId: null, appTable: true })
  rows.push(
    ...(projectId === undefined ? appRows : appRows.filter((row) => row.projectId === projectId))
  )
  const projects =
    projectId === undefined
      ? listProjects(storage.db)
      : [getProject(storage.db, projectId)].filter((item) => item !== null)
  const pool = projectDatabasePool(storage)
  for (const project of projects) {
    try {
      rows.push(
        ...listLlmCalls(pool.get(project.slug), {
          since,
          projectId: project.id,
          appTable: false
        })
      )
    } catch {
      // A project file that cannot be opened adds no rows; Status still shows the rest.
    }
  }
  return rows
}
