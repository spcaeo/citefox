import type { SqliteDatabase } from './database'
import { closeProjectDatabase, openProjectDatabase } from './project-files'

/**
 * Project database handles kept open for the life of the process (NFR-17).
 * The scheduler reads every project on each status refresh; opening and
 * closing each file per read was most of that cost. One pool per app
 * database. `openAppStorage().close()` closes the pool with it.
 */
export interface ProjectDatabasePool {
  get(slug: string): SqliteDatabase
  /** Closes handles for slugs that are no longer projects (a deleted project). */
  retain(slugs: ReadonlySet<string>): void
  closeAll(): void
  stats(): { opens: number; open: number }
}

const pools = new WeakMap<SqliteDatabase, ProjectDatabasePool>()

export function projectDatabasePool(storage: {
  db: SqliteDatabase
  paths: { projectsDirectory: string }
}): ProjectDatabasePool {
  const existing = pools.get(storage.db)
  if (existing !== undefined) return existing
  const created = createPool(storage.paths.projectsDirectory)
  pools.set(storage.db, created)
  return created
}

/** Called when the app database closes. Safe when no pool was made. */
export function closeProjectDatabasePool(appDb: SqliteDatabase): void {
  pools.get(appDb)?.closeAll()
  pools.delete(appDb)
}

function createPool(projectsDirectory: string): ProjectDatabasePool {
  const handles = new Map<string, SqliteDatabase>()
  let opens = 0
  return {
    get(slug: string): SqliteDatabase {
      const current = handles.get(slug)
      if (current !== undefined && current.open) return current
      const db = openProjectDatabase(projectsDirectory, slug)
      opens += 1
      handles.set(slug, db)
      return db
    },
    retain(slugs: ReadonlySet<string>): void {
      for (const [slug, db] of handles) {
        if (slugs.has(slug)) continue
        closeProjectDatabase(db)
        handles.delete(slug)
      }
    },
    closeAll(): void {
      for (const db of handles.values()) closeProjectDatabase(db)
      handles.clear()
    },
    stats: () => ({ opens, open: handles.size })
  }
}
