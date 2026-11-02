import { cleanBranding, NO_BRANDING, type ReportBranding } from '@shared/report/review/extras'
import type { SqliteDatabase } from './database'
import { requireUtcTimestamp } from './values'

/**
 * The "Prepared for" line of downloaded reports (Project settings › Reports), kept in
 * `saved_views` (migration 019) like the screens' last views, so no new table is needed.
 * One row: id and grid `report-branding`, state `{"preparedFor":"…","logo":"data:…"}`.
 * Saved grid views never list it: its grid id differs.
 */
const ROW_ID = 'report-branding'

export function getReportBranding(db: SqliteDatabase): ReportBranding {
  const row = db
    .prepare<unknown[], { state_json: string }>(`SELECT state_json FROM saved_views WHERE id = ?`)
    .get(ROW_ID)
  if (row === undefined) return NO_BRANDING
  try {
    return cleanBranding(JSON.parse(row.state_json))
  } catch {
    return NO_BRANDING
  }
}

/** Saves the branding as cleaned; an empty name and no logo removes the row. */
export function setReportBranding(db: SqliteDatabase, value: unknown, at: string): ReportBranding {
  const clean = cleanBranding(value)
  const when = requireUtcTimestamp(at)
  if (clean.preparedFor === '' && clean.logo === null && clean.preparedBy === undefined) {
    db.prepare(`DELETE FROM saved_views WHERE id = ?`).run(ROW_ID)
    return clean
  }
  db.prepare(
    `INSERT INTO saved_views (id, grid, name, state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(ROW_ID, ROW_ID, 'Prepared for', JSON.stringify(clean), when, when)
  return clean
}
