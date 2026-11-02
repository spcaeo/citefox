import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, requireUtcTimestamp } from './values'

/**
 * `topic_folders` and `topics.folder_id` (migration 050). Folders are only changed by
 * the user's own requests (Topics › New folder, Move to folder); nothing else writes here.
 */

export interface StoredTopicFolder {
  id: string
  name: string
  createdAt: string
}

export interface StoredTopicFolders {
  /** Oldest first, the order the user made them. */
  folders: StoredTopicFolder[]
  /** Topic id → folder id, for topics in a folder. A topic missing here is in "No folder". */
  placement: Record<string, string>
}

export function listTopicFolders(db: SqliteDatabase): StoredTopicFolders {
  const folders = db
    .prepare<unknown[], { id: string; name: string; created_at: string }>(
      `SELECT id, name, created_at FROM topic_folders ORDER BY created_at ASC, rowid ASC`
    )
    .all()
    .map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }))
  const placement: Record<string, string> = {}
  for (const row of db
    .prepare<unknown[], { page_id: string; folder_id: string }>(
      `SELECT page_id, folder_id FROM topics WHERE folder_id IS NOT NULL ORDER BY page_id`
    )
    .all()) {
    placement[row.page_id] = row.folder_id
  }
  return { folders, placement }
}

export function insertTopicFolder(db: SqliteDatabase, folder: StoredTopicFolder): void {
  const name = requireFolderName(folder.name)
  refuseTakenName(db, name, null)
  db.prepare(`INSERT INTO topic_folders (id, name, created_at) VALUES (?, ?, ?)`).run(
    assertId(folder.id),
    name,
    requireUtcTimestamp(folder.createdAt)
  )
}

export function renameTopicFolder(db: SqliteDatabase, id: string, name: string): void {
  const clean = requireFolderName(name)
  refuseTakenName(db, clean, assertId(id))
  const result = db.prepare(`UPDATE topic_folders SET name = ? WHERE id = ?`).run(clean, id)
  if (result.changes !== 1) throw new StorageError('That folder was not found.')
}

/** Deletes the folder; its topics go back to "No folder". */
export function deleteTopicFolder(db: SqliteDatabase, id: string): void {
  const target = assertId(id)
  db.transaction(() => {
    db.prepare(`UPDATE topics SET folder_id = NULL WHERE folder_id = ?`).run(target)
    const result = db.prepare(`DELETE FROM topic_folders WHERE id = ?`).run(target)
    if (result.changes !== 1) throw new StorageError('That folder was not found.')
  })()
}

/** Moves topics into a folder, or back to "No folder" with null. Unknown topics are refused. */
export function moveTopicsToFolder(
  db: SqliteDatabase,
  topicIds: readonly string[],
  folderId: string | null
): void {
  const folder = folderId === null ? null : assertId(folderId)
  db.transaction(() => {
    if (
      folder !== null &&
      db.prepare(`SELECT 1 FROM topic_folders WHERE id = ?`).get(folder) === undefined
    ) {
      throw new StorageError('That folder was not found.')
    }
    const move = db.prepare(`UPDATE topics SET folder_id = ? WHERE page_id = ?`)
    for (const topicId of topicIds) {
      if (move.run(folder, assertId(topicId)).changes !== 1)
        throw new StorageError('That topic was not found.')
    }
  })()
}

export function requireFolderName(value: string): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (name.length === 0 || name.length > 80) {
    throw new StorageError('A folder name is 1 to 80 characters.')
  }
  return name
}

function refuseTakenName(db: SqliteDatabase, name: string, except: string | null): void {
  const taken = db
    .prepare<[string], { id: string }>(`SELECT id FROM topic_folders WHERE name = ? COLLATE NOCASE`)
    .get(name)
  if (taken !== undefined && taken.id !== except) {
    throw new StorageError(`A folder called "${name}" already exists.`)
  }
}
