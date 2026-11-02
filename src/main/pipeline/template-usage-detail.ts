import type {
  TemplateUsageDetail,
  TemplateUsageItem,
  TemplateUsageItemKind,
  TemplateUsageRequest
} from '@shared/ipc'
import type { SqliteDatabase } from '../storage/database'
import { StorageError } from '../storage/errors'
import { projectDatabasePool } from '../storage/project-db-pool'
import { getProject, listProjects } from '../storage/records'
import { TemplateContractError, getGenerationTemplate } from './templates'

interface UsageSql {
  id: string
  page_id: string
  at: string
  template_hash: string | null
  url: string | null
  title: string | null
  label: string | null
}

/** Same tables and filters as `templates:usage`, so each kind's length equals its count. */
const QUERIES: readonly { kind: TemplateUsageItemKind; sql: string }[] = [
  {
    kind: 'buyer_profile',
    sql: `SELECT b.id, b.page_id, b.created_at AS at, b.template_hash, p.url, p.title, p.label
          FROM buyer_profiles b LEFT JOIN pages p ON p.id = b.page_id WHERE b.template_id = ?`
  },
  {
    kind: 'prompt_set',
    sql: `SELECT s.id, s.page_id, s.saved_at AS at, s.template_hash, p.url, p.title, p.label
          FROM prompt_sets s LEFT JOIN pages p ON p.id = s.page_id WHERE s.template_id = ?`
  },
  {
    kind: 'coverage',
    sql: `SELECT c.id, c.page_id, c.recorded_at AS at, c.template_hash, p.url, p.title, p.label
          FROM coverage_runs c LEFT JOIN pages p ON p.id = c.page_id WHERE c.template_id = ?`
  }
]

/**
 * `templates:usageDetail`: every saved buyer profile, prompt set and coverage
 * matrix that recorded this template, newest first, across the requested
 * projects. The Templates usage line opens these as its drill-down.
 */
export function readTemplateUsageDetail(
  storage: { db: SqliteDatabase; paths: { projectsDirectory: string } },
  request: TemplateUsageRequest
): TemplateUsageDetail {
  if (getGenerationTemplate(storage.db, request.id) === null) {
    throw new TemplateContractError('templates:usageDetail', 'not_found')
  }
  const projects =
    request.projectId === undefined
      ? listProjects(storage.db)
      : [getProject(storage.db, request.projectId)].filter((item) => item !== null)
  const pool = projectDatabasePool(storage)
  const items: TemplateUsageItem[] = []
  for (const project of projects) {
    let db: SqliteDatabase
    try {
      db = pool.get(project.slug)
    } catch (error) {
      if (error instanceof StorageError) continue
      throw error
    }
    for (const query of QUERIES) {
      const rows = db.prepare<unknown[], UsageSql>(query.sql).all(request.id)
      for (const row of rows) {
        items.push({
          id: row.id,
          kind: query.kind,
          projectId: project.id,
          projectName: project.name,
          pageId: row.page_id,
          pageLabel: row.label ?? row.title ?? row.url ?? row.page_id,
          pageUrl: row.url ?? '',
          savedAt: row.at,
          templateHash: row.template_hash ?? ''
        })
      }
    }
  }
  items.sort(
    (left, right) => right.savedAt.localeCompare(left.savedAt) || left.id.localeCompare(right.id)
  )
  return { templateId: request.id, items }
}
