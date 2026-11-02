import type { GridMembership } from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'
import { changeGroupPages } from '../../storage/group-records'

/**
 * Site structure (FR-19.5, FR-19.7) is built in its own work stream. All pages
 * reads cluster and group memberships by data, from the section 10 tables
 * (`clusters`, `cluster_pages`, `groups`, `group_pages`), only when they exist.
 * A project without them gets null and the grid shows "—".
 */
export interface Memberships {
  clusters: ReadonlyMap<string, GridMembership[]> | null
  groups: ReadonlyMap<string, GridMembership[]> | null
  /** Every group, for "Add to group". Null when there is no groups table. */
  groupList: GridMembership[] | null
}

export function readMemberships(db: SqliteDatabase): Memberships {
  const tables = existingTables(db)
  const hasClusters = tables.has('clusters') && tables.has('cluster_pages')
  const hasGroups = tables.has('groups') && tables.has('group_pages')
  return {
    clusters: hasClusters
      ? byPage(
          db,
          `SELECT cluster_pages.page_id AS page_id, clusters.id AS id, clusters.name AS name
             FROM cluster_pages JOIN clusters ON clusters.id = cluster_pages.cluster_id
             ORDER BY clusters.name COLLATE NOCASE ASC`
        )
      : null,
    groups: hasGroups
      ? byPage(
          db,
          `SELECT group_pages.page_id AS page_id, groups.id AS id, groups.name AS name
             FROM group_pages JOIN groups ON groups.id = group_pages.group_id
             ORDER BY groups.name COLLATE NOCASE ASC`
        )
      : null,
    groupList: hasGroups
      ? db
          .prepare<unknown[], GridMembership>(
            `SELECT id, name FROM groups ORDER BY name COLLATE NOCASE ASC`
          )
          .all()
      : null
  }
}

/**
 * FR-19.7. Adds pages to a user group through Site structure's own storage, so
 * `added_at` is set the same way as `structure:setGroupPages`. Pages already in
 * the group stay once. Returns how many were new.
 */
export function addPagesToGroup(
  db: SqliteDatabase,
  groupId: string,
  pageIds: readonly string[],
  at: string
): number {
  const tables = existingTables(db)
  if (!tables.has('groups') || !tables.has('group_pages')) return 0
  const existing = new Set(
    db
      .prepare<[string], { page_id: string }>(`SELECT page_id FROM group_pages WHERE group_id = ?`)
      .all(groupId)
      .map((row) => row.page_id)
  )
  const fresh = [...new Set(pageIds)].filter((id) => !existing.has(id))
  changeGroupPages(db, groupId, fresh, [], at)
  return fresh.length
}

export function groupExists(db: SqliteDatabase, groupId: string): boolean {
  const tables = existingTables(db)
  if (!tables.has('groups')) return false
  return db.prepare(`SELECT 1 FROM groups WHERE id = ?`).get(groupId) !== undefined
}

function existingTables(db: SqliteDatabase): Set<string> {
  return new Set(
    db
      .prepare<unknown[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('clusters', 'cluster_pages', 'groups', 'group_pages')`
      )
      .all()
      .map((row) => row.name)
  )
}

function byPage(db: SqliteDatabase, sql: string): Map<string, GridMembership[]> {
  const map = new Map<string, GridMembership[]>()
  for (const row of db
    .prepare<unknown[], { page_id: string; id: string; name: string }>(sql)
    .all()) {
    const list = map.get(row.page_id)
    const item = { id: row.id, name: row.name }
    if (list) list.push(item)
    else map.set(row.page_id, [item])
  }
  return map
}
