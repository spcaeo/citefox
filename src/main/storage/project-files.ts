import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { ensureProjectSchema } from './project-profile'
import { isSafeProjectSlug, projectDatabasePath } from './slug'

/** Create `projects/<slug>.sqlite`. Throws when that file already exists. */
export function createProjectDatabase(projectsDirectory: string, slug: string): SqliteDatabase {
  mkdirSync(projectsDirectory, { recursive: true, mode: 0o700 })
  const filePath = projectDatabasePath(projectsDirectory, slug)
  if (existsSync(filePath)) throw new StorageError('Project database already exists')
  const db = openSqliteDatabase(filePath)
  ensureProjectSchema(db)
  return db
}

/** Open an existing `projects/<slug>.sqlite`. Does not apply the app schema. */
export function openProjectDatabase(projectsDirectory: string, slug: string): SqliteDatabase {
  const filePath = projectDatabasePath(projectsDirectory, slug)
  if (!existsSync(filePath)) throw new StorageError('Project database does not exist')
  assertStaysInside(projectsDirectory, filePath)
  const db = openSqliteDatabase(filePath, { fileMustExist: true })
  try {
    ensureProjectSchema(db)
  } catch (error) {
    // Close a file that cannot be read, so Windows does not keep it locked.
    closeDatabase(db)
    throw error
  }
  return db
}

export function closeProjectDatabase(db: SqliteDatabase): void {
  closeDatabase(db)
}

/**
 * Slugs of `*.sqlite` files in the projects directory. Entries that are not a
 * safe slug are skipped. A missing directory is an empty list.
 */
export function listProjectSlugs(projectsDirectory: string): string[] {
  if (!existsSync(projectsDirectory)) return []
  const slugs: string[] = []
  for (const entry of readdirSync(projectsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sqlite')) continue
    const slug = entry.name.slice(0, -'.sqlite'.length)
    if (!isSafeProjectSlug(slug)) continue
    slugs.push(slug)
  }
  slugs.sort()
  return slugs
}

function assertStaysInside(projectsDirectory: string, filePath: string): void {
  const root = realpathSync(resolve(projectsDirectory))
  const file = realpathSync(filePath)
  const fromRoot = relative(root, file)
  if (fromRoot.length === 0 || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new StorageError('Invalid project path')
  }
}
