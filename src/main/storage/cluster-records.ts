import {
  isClusterMaker,
  isClusterMethod,
  isClusterRole,
  type ClusterMaker,
  type ClusterMethod,
  type ClusterRole
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { assertId, readJson, requireUtcTimestamp } from './values'

/**
 * `clusters`, `cluster_pages`, `cluster_snapshots`, and `structure_state`
 * (migration 18). A page is in at most one cluster. Saving a new set of
 * clusters first stores the previous set as a snapshot for undo (FR-19.4).
 */

/** Snapshots kept for undo. */
export const KEPT_CLUSTER_SNAPSHOTS = 5

export interface StoredClusterPage {
  pageId: string
  role: ClusterRole
  movedByUser: boolean
}

export interface StoredCluster {
  id: string
  name: string
  pillarPageId: string | null
  madeBy: ClusterMaker
  version: number
  renamedByUser: boolean
  editedByUser: boolean
  trackWhole: boolean
  topicKey: string | null
  themes: string[]
  createdAt: string
  pages: StoredClusterPage[]
}

export function listClusters(db: SqliteDatabase): StoredCluster[] {
  const clusters = db
    .prepare<unknown[], ClusterSql>(
      `SELECT id, name, pillar_page_id, made_by, version, renamed_by_user, edited_by_user,
         track_whole, topic_key, themes_json, created_at
       FROM clusters ORDER BY created_at ASC, rowid ASC`
    )
    .all()
  const members = db
    .prepare<unknown[], MemberSql>(
      `SELECT cluster_id, page_id, role, moved_by_user FROM cluster_pages ORDER BY rowid ASC`
    )
    .all()
  const byCluster = new Map<string, StoredClusterPage[]>()
  for (const row of members) {
    if (!isClusterRole(row.role)) throw new StorageError('Invalid cluster role')
    const list = byCluster.get(row.cluster_id) ?? []
    list.push({ pageId: row.page_id, role: row.role, movedByUser: row.moved_by_user === 1 })
    byCluster.set(row.cluster_id, list)
  }
  return clusters.map((row) => clusterFromSql(row, byCluster.get(row.id) ?? []))
}

export function getCluster(db: SqliteDatabase, id: string): StoredCluster | null {
  return listClusters(db).find((cluster) => cluster.id === assertId(id)) ?? null
}

/**
 * Replaces every cluster with `next` in one transaction. With `snapshotReason`
 * set, the current clusters are saved first so `restoreClusterSnapshot` can
 * bring them back.
 */
export function replaceClusters(
  db: SqliteDatabase,
  next: readonly StoredCluster[],
  options: { at: string; snapshotReason: string | null }
): void {
  const at = requireUtcTimestamp(options.at)
  const write = db.transaction(() => {
    if (options.snapshotReason !== null) saveSnapshot(db, at, options.snapshotReason)
    writeAll(db, next)
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save the clusters')
  }
}

export function hasClusterSnapshot(db: SqliteDatabase): boolean {
  return db.prepare(`SELECT 1 AS ok FROM cluster_snapshots LIMIT 1`).get() !== undefined
}

/** Restores the newest snapshot and deletes it. False when there is none. */
export function restoreClusterSnapshot(db: SqliteDatabase): boolean {
  const row = db
    .prepare<unknown[], { id: number; body_json: string }>(
      `SELECT id, body_json FROM cluster_snapshots ORDER BY id DESC LIMIT 1`
    )
    .get()
  if (row === undefined) return false
  const body = readJson(row.body_json, 'cluster snapshot')
  const clusters = snapshotClusters(body)
  db.transaction(() => {
    writeAll(db, clusters)
    db.prepare(`DELETE FROM cluster_snapshots WHERE id = ?`).run(row.id)
  })()
  return true
}

export interface StructureState {
  lastClusteredAt: string | null
  lastClusterMethod: ClusterMethod | null
}

export function readStructureState(db: SqliteDatabase): StructureState {
  const row = db
    .prepare<unknown[], { last_clustered_at: string | null; last_cluster_method: string | null }>(
      `SELECT last_clustered_at, last_cluster_method FROM structure_state WHERE id = 1`
    )
    .get()
  if (row === undefined) return { lastClusteredAt: null, lastClusterMethod: null }
  const method = row.last_cluster_method
  return {
    lastClusteredAt: row.last_clustered_at,
    lastClusterMethod: method !== null && isClusterMethod(method) ? method : null
  }
}

export function writeStructureState(db: SqliteDatabase, state: StructureState): void {
  db.prepare(
    `INSERT INTO structure_state (id, last_clustered_at, last_cluster_method) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_clustered_at = excluded.last_clustered_at,
       last_cluster_method = excluded.last_cluster_method`
  ).run(state.lastClusteredAt, state.lastClusterMethod)
}

/** Adds one page to a cluster (sync). A page already in a cluster is left where it is. */
export function addPageToCluster(
  db: SqliteDatabase,
  clusterId: string,
  pageId: string,
  role: ClusterRole
): boolean {
  const result = db
    .prepare(
      `INSERT INTO cluster_pages (cluster_id, page_id, role, moved_by_user) VALUES (?, ?, ?, 0)
       ON CONFLICT DO NOTHING`
    )
    .run(assertId(clusterId), assertId(pageId), role)
  return result.changes === 1
}

export function removePagesFromClusters(db: SqliteDatabase, pageIds: readonly string[]): void {
  const statement = db.prepare(`DELETE FROM cluster_pages WHERE page_id = ?`)
  for (const pageId of pageIds) statement.run(pageId)
}

// ---------- internals ----------

function saveSnapshot(db: SqliteDatabase, at: string, reason: string): void {
  const current = listClusters(db)
  db.prepare(`INSERT INTO cluster_snapshots (taken_at, reason, body_json) VALUES (?, ?, ?)`).run(
    at,
    reason.slice(0, 80),
    JSON.stringify({ clusters: current })
  )
  db.prepare(
    `DELETE FROM cluster_snapshots WHERE id NOT IN (
       SELECT id FROM cluster_snapshots ORDER BY id DESC LIMIT ?
     )`
  ).run(KEPT_CLUSTER_SNAPSHOTS)
}

function writeAll(db: SqliteDatabase, clusters: readonly StoredCluster[]): void {
  db.prepare(`DELETE FROM cluster_pages`).run()
  db.prepare(`DELETE FROM clusters`).run()
  const insertCluster = db.prepare(
    `INSERT INTO clusters (id, name, pillar_page_id, made_by, version, renamed_by_user,
       edited_by_user, track_whole, topic_key, themes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertMember = db.prepare(
    `INSERT INTO cluster_pages (cluster_id, page_id, role, moved_by_user) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  )
  for (const cluster of clusters) {
    const name = requireName(cluster.name)
    insertCluster.run(
      assertId(cluster.id),
      name,
      cluster.pillarPageId,
      cluster.madeBy,
      Math.max(1, Math.trunc(cluster.version)),
      cluster.renamedByUser ? 1 : 0,
      cluster.editedByUser ? 1 : 0,
      cluster.trackWhole ? 1 : 0,
      cluster.topicKey === null ? null : cluster.topicKey.slice(0, 200),
      JSON.stringify(cluster.themes.slice(0, 5).map((theme) => theme.slice(0, 120))),
      requireUtcTimestamp(cluster.createdAt)
    )
    for (const page of cluster.pages) {
      insertMember.run(cluster.id, page.pageId, page.role, page.movedByUser ? 1 : 0)
    }
  }
}

function requireName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length === 0 || name.length > 120) throw new StorageError('Invalid cluster name')
  return name
}

interface ClusterSql {
  id: string
  name: string
  pillar_page_id: string | null
  made_by: string
  version: number
  renamed_by_user: number
  edited_by_user: number
  track_whole: number
  topic_key: string | null
  themes_json: string
  created_at: string
}

interface MemberSql {
  cluster_id: string
  page_id: string
  role: string
  moved_by_user: number
}

function clusterFromSql(row: ClusterSql, pages: StoredClusterPage[]): StoredCluster {
  if (!isClusterMaker(row.made_by)) throw new StorageError('Invalid cluster maker')
  const themes = readJson(row.themes_json, 'cluster themes')
  return {
    id: row.id,
    name: row.name,
    pillarPageId: row.pillar_page_id,
    madeBy: row.made_by,
    version: row.version,
    renamedByUser: row.renamed_by_user === 1,
    editedByUser: row.edited_by_user === 1,
    trackWhole: row.track_whole === 1,
    topicKey: row.topic_key,
    themes: Array.isArray(themes)
      ? themes.filter((theme): theme is string => typeof theme === 'string')
      : [],
    createdAt: row.created_at,
    pages
  }
}

function snapshotClusters(body: unknown): StoredCluster[] {
  if (typeof body !== 'object' || body === null) throw new StorageError('Invalid cluster snapshot')
  const list = (body as { clusters?: unknown }).clusters
  if (!Array.isArray(list)) throw new StorageError('Invalid cluster snapshot')
  return list.map((item): StoredCluster => {
    if (typeof item !== 'object' || item === null)
      throw new StorageError('Invalid cluster snapshot')
    const record = item as Record<string, unknown>
    const madeBy = String(record.madeBy)
    if (!isClusterMaker(madeBy)) throw new StorageError('Invalid cluster snapshot')
    const pages = Array.isArray(record.pages) ? record.pages : []
    return {
      id: String(record.id),
      name: String(record.name),
      pillarPageId: typeof record.pillarPageId === 'string' ? record.pillarPageId : null,
      madeBy,
      version: typeof record.version === 'number' ? record.version : 1,
      renamedByUser: record.renamedByUser === true,
      editedByUser: record.editedByUser === true,
      trackWhole: record.trackWhole === true,
      topicKey: typeof record.topicKey === 'string' ? record.topicKey : null,
      themes: Array.isArray(record.themes)
        ? record.themes.filter((theme): theme is string => typeof theme === 'string')
        : [],
      createdAt: String(record.createdAt),
      pages: pages.flatMap((page): StoredClusterPage[] => {
        if (typeof page !== 'object' || page === null) return []
        const member = page as Record<string, unknown>
        const role = String(member.role)
        if (typeof member.pageId !== 'string' || !isClusterRole(role)) return []
        return [{ pageId: member.pageId, role, movedByUser: member.movedByUser === true }]
      })
    }
  })
}
