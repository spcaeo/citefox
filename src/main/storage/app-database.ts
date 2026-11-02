import { APP_MIGRATIONS } from './app-schema'
import { openSqliteDatabase, restrictDatabaseFiles, type SqliteDatabase } from './database'
import { migrate } from './migrate'

/** Open `app.sqlite` (or `:memory:`) and apply the forward migrations. */
export function openAppDatabase(filename: string): SqliteDatabase {
  const db = openSqliteDatabase(filename)
  migrate(db, APP_MIGRATIONS)
  if (filename !== ':memory:' && filename.length > 0) restrictDatabaseFiles(filename)
  return db
}
