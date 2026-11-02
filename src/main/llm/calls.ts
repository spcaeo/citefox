import {
  LLM_CALLS_LIMIT,
  type LlmCallList,
  type LlmCallRecord,
  type LlmCallsRequest
} from '@shared/ipc'
import type { AppStorage } from '../storage/app-storage'
import { listLlmCalls } from '../storage/llm-calls'
import { projectDatabasePool } from '../storage/project-db-pool'
import { getProject, listProjects } from '../storage/records'

/** Rows read per database before filtering by kind. `llm_calls` keeps no prompts, so rows are small. */
const SCAN_LIMIT = 20_000

/**
 * `llm:calls`: every logged Claude call of one template kind, newest first
 * (Templates "last run" drill-down). Same sources as `llm:usage`: app.sqlite
 * for calls outside a project, and each project file through the shared pool.
 */
export function readLlmCalls(
  storage: Pick<AppStorage, 'db' | 'paths'>,
  request: LlmCallsRequest
): LlmCallList {
  const matches = (row: LlmCallRecord): boolean => row.templateKind === request.templateKind
  const rows: LlmCallRecord[] = listLlmCalls(storage.db, {
    since: null,
    limit: SCAN_LIMIT,
    projectId: null,
    appTable: true
  }).filter(
    (row) =>
      matches(row) && (request.projectId === undefined || row.projectId === request.projectId)
  )
  const projects =
    request.projectId === undefined
      ? listProjects(storage.db)
      : [getProject(storage.db, request.projectId)].filter((item) => item !== null)
  const pool = projectDatabasePool(storage)
  for (const project of projects) {
    try {
      rows.push(
        ...listLlmCalls(pool.get(project.slug), {
          since: null,
          limit: SCAN_LIMIT,
          projectId: project.id,
          appTable: false
        }).filter(matches)
      )
    } catch {
      // A project file that cannot be opened adds no rows, as in `llm:usage`.
    }
  }
  rows.sort(
    (left, right) =>
      right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id)
  )
  return { calls: rows.slice(0, LLM_CALLS_LIMIT), total: rows.length }
}
