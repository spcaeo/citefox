import { containsSecret } from '../logging/redact'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { requireUtcTimestamp } from './values'

/**
 * Opaque send throttle in app.sqlite. The caller builds `key`
 * (`slack:project:check`, `pdf:project:date`, and the other schedule-less keys).
 * `marked_at` is ISO-8601 UTC (NFR-15). A second mark keeps the first time.
 */
const KEY_MAX = 500

export function hasEmailThrottle(db: SqliteDatabase, key: string): boolean {
  const throttleKey = requireKey(key)
  const row = db
    .prepare<unknown[], { key: string }>(`SELECT key FROM email_throttle WHERE key = ?`)
    .get(throttleKey)
  return row !== undefined
}

export function markEmailThrottle(db: SqliteDatabase, key: string, at: string): void {
  const throttleKey = requireKey(key)
  const markedAt = requireUtcTimestamp(at)
  try {
    db.prepare(`INSERT OR IGNORE INTO email_throttle (key, marked_at) VALUES (?, ?)`).run(
      throttleKey,
      markedAt
    )
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error)) throw new StorageError('Could not mark email throttle')
    throw error
  }
}

function requireKey(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > KEY_MAX ||
    value.trim() !== value ||
    value.includes('\0')
  ) {
    throw new StorageError('Invalid throttle key')
  }
  if (containsSecret(value)) throw new StorageError('throttle key cannot contain a secret')
  return value
}
