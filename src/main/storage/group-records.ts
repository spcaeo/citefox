import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, readJson, requireUtcTimestamp } from './values'

/**
 * `groups`, `group_pages` (FR-19.7) and `silos` (FR-19.6), migration 18.
 * Groups are only changed by the user's own requests; no clustering or Claude
 * path writes here.
 */

export interface StoredGroup {
  id: string
  name: string
  note: string | null
  createdAt: string
  pageIds: string[]
}

export function listGroups(db: SqliteDatabase): StoredGroup[] {
  const groups = db
    .prepare<unknown[], { id: string; name: string; note: string | null; created_at: string }>(
      `SELECT id, name, note, created_at FROM groups ORDER BY created_at ASC, rowid ASC`
    )
    .all()
  const members = db
    .prepare<unknown[], { group_id: string; page_id: string }>(
      `SELECT group_id, page_id FROM group_pages ORDER BY added_at ASC, rowid ASC`
    )
    .all()
  const byGroup = new Map<string, string[]>()
  for (const row of members) {
    const list = byGroup.get(row.group_id) ?? []
    list.push(row.page_id)
    byGroup.set(row.group_id, list)
  }
  return groups.map((row) => ({
    id: row.id,
    name: row.name,
    note: row.note,
    createdAt: row.created_at,
    pageIds: byGroup.get(row.id) ?? []
  }))
}

export function getGroup(db: SqliteDatabase, id: string): StoredGroup | null {
  const target = assertId(id)
  return listGroups(db).find((group) => group.id === target) ?? null
}

export function insertGroup(
  db: SqliteDatabase,
  group: { id: string; name: string; note: string | null; createdAt: string }
): void {
  db.prepare(`INSERT INTO groups (id, name, note, created_at) VALUES (?, ?, ?, ?)`).run(
    assertId(group.id),
    requireGroupName(group.name),
    requireNote(group.note),
    requireUtcTimestamp(group.createdAt)
  )
}

export function updateGroup(
  db: SqliteDatabase,
  id: string,
  patch: { name: string; note: string | null }
): void {
  const result = db
    .prepare(`UPDATE groups SET name = ?, note = ? WHERE id = ?`)
    .run(requireGroupName(patch.name), requireNote(patch.note), assertId(id))
  if (result.changes !== 1) throw new StorageError('That group was not found')
}

export function deleteGroup(db: SqliteDatabase, id: string): void {
  const result = db.prepare(`DELETE FROM groups WHERE id = ?`).run(assertId(id))
  if (result.changes !== 1) throw new StorageError('That group was not found')
}

export function changeGroupPages(
  db: SqliteDatabase,
  id: string,
  add: readonly string[],
  remove: readonly string[],
  at: string
): void {
  const group = assertId(id)
  const added = requireUtcTimestamp(at)
  db.transaction(() => {
    const insert = db.prepare(
      `INSERT INTO group_pages (group_id, page_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`
    )
    const drop = db.prepare(`DELETE FROM group_pages WHERE group_id = ? AND page_id = ?`)
    for (const pageId of add) insert.run(group, assertId(pageId), added)
    for (const pageId of remove) drop.run(group, assertId(pageId))
  })()
}

export function requireGroupName(value: string): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (name.length === 0 || name.length > 80) {
    throw new StorageError('A group name is 1 to 80 characters.')
  }
  return name
}

function requireNote(value: string | null): string | null {
  if (value === null) return null
  const note = value.trim()
  if (note.length === 0) return null
  if (note.length > 300) throw new StorageError('A group note is at most 300 characters.')
  return note
}

// ---------- silos ----------

export interface StoredSilo {
  path: string
  trackAll: boolean
  /** Null is "Same as parent folder". */
  marketIds: readonly string[] | null
}

export function listSiloSettings(db: SqliteDatabase): Map<string, StoredSilo> {
  const rows = db
    .prepare<unknown[], { path: string; track_all: number; market_ids_json: string | null }>(
      `SELECT path, track_all, market_ids_json FROM silos`
    )
    .all()
  const map = new Map<string, StoredSilo>()
  for (const row of rows) {
    const parsed = row.market_ids_json === null ? null : readJson(row.market_ids_json, 'silo')
    map.set(row.path, {
      path: row.path,
      trackAll: row.track_all === 1,
      marketIds: Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : null
    })
  }
  return map
}

export function writeSiloSetting(db: SqliteDatabase, silo: StoredSilo): void {
  if (!silo.path.startsWith('/') || silo.path.length > 500) throw new StorageError('Invalid folder')
  const markets = silo.marketIds === null ? null : JSON.stringify(silo.marketIds.map(assertId))
  db.prepare(
    `INSERT INTO silos (path, track_all, market_ids_json) VALUES (?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET track_all = excluded.track_all,
       market_ids_json = excluded.market_ids_json`
  ).run(silo.path, silo.trackAll ? 1 : 0, markets)
}
