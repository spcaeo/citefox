import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { cleanSender, NO_SENDER, type ReportSender } from '@shared/report/review/sender'
import { closeDatabase, openSqliteDatabase } from './database'
import { atomicWriteFile } from './atomic-file'

/**
 * Who the reports are from (Settings › Reports): app-wide, set once and used for every
 * project. Kept beside `settings.json` in the app data folder as its own small file,
 * `report-sender.json`, because it holds a logo image and settings.json stays scalar.
 * A missing or unreadable file reads as {@link NO_SENDER} (today's look).
 */
export const REPORT_SENDER_FILE = 'report-sender.json'

export function reportSenderPath(root: string): string {
  return join(root, REPORT_SENDER_FILE)
}

export function readReportSender(root: string): ReportSender {
  const file = reportSenderPath(root)
  if (!existsSync(file)) return NO_SENDER
  try {
    return cleanSender(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return NO_SENDER
  }
}

/** Saves the sender as cleaned. Back to "Just me" with nothing typed removes the file. */
export function writeReportSender(root: string, value: unknown): ReportSender {
  const clean = cleanSender(value)
  const file = reportSenderPath(root)
  const empty =
    clean.mode === 'none' &&
    clean.name === '' &&
    clean.logo === null &&
    clean.website === '' &&
    clean.email === '' &&
    clean.preparedBy === ''
  if (empty) {
    rmSync(file, { force: true })
    return clean
  }
  atomicWriteFile(file, `${JSON.stringify(clean, null, 2)}\n`)
  return clean
}

/**
 * The project site's stored icon (the site-icon cache, `favicons.sqlite`), an in-house
 * company's logo when it has none of its own. Read-only; null when there is none.
 */
export function cachedSiteIcon(root: string, domain: string): string | null {
  const file = join(root, 'favicons.sqlite')
  if (!existsSync(file)) return null
  try {
    const db = openSqliteDatabase(file)
    try {
      const row = db
        .prepare<[string], { data_uri: string | null }>(
          'SELECT data_uri FROM favicons WHERE domain = ?'
        )
        .get(domain.toLowerCase())
      return row?.data_uri ?? null
    } finally {
      closeDatabase(db)
    }
  } catch {
    return null
  }
}
