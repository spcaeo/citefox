import { chmodSync, mkdirSync } from 'node:fs'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { appDataPaths, type AppDataPaths } from './paths'
import { closeProjectDatabasePool } from './project-db-pool'
import { readSettings, writeSettings, type AppSettings } from './settings'

/**
 * App-wide files under Electron's user data directory.
 * Pass `app.getPath('userData')` after `app.setName('CiteFox')`.
 * Tests pass a temp directory. `settings.json` is created on the first write.
 */
export interface AppStorage {
  paths: AppDataPaths
  db: SqliteDatabase
  readSettings(): AppSettings
  writeSettings(settings: AppSettings): void
  close(): void
}

export function openAppStorage(userData: string): AppStorage {
  const paths = appDataPaths(userData)
  mkdirSync(paths.root, { recursive: true, mode: 0o700 })
  mkdirSync(paths.projectsDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    chmodSync(paths.root, 0o700)
    chmodSync(paths.projectsDirectory, 0o700)
  }
  const db = openAppDatabase(paths.appDatabase)
  return {
    paths,
    db,
    readSettings: () => readSettings(paths.settingsFile),
    writeSettings: (settings) => writeSettings(paths.settingsFile, settings),
    close: () => {
      closeProjectDatabasePool(db)
      closeDatabase(db)
    }
  }
}
