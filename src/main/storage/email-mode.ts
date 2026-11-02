import { isEmailMode, type EmailMode } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'

/**
 * FR-23.1. One value in app.sqlite: `'smtp'` or `'mail_app'`.
 * SMTP is the default until the user picks the mail app.
 */
export function getEmailMode(db: SqliteDatabase): EmailMode {
  const row = db
    .prepare<unknown[], { mode: string }>(`SELECT mode FROM email_mode WHERE id = 1`)
    .get()
  if (row === undefined) return 'smtp'
  if (!isEmailMode(row.mode)) throw new StorageError('Invalid email mode')
  return row.mode
}

export function setEmailMode(db: SqliteDatabase, mode: EmailMode): void {
  if (!isEmailMode(mode)) throw new StorageError('Invalid email mode')
  try {
    db.prepare(
      `INSERT INTO email_mode (id, mode) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET mode = excluded.mode`
    ).run(mode)
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not save email mode')
    throw error
  }
}
