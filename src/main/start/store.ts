import type { SiteStartPlan } from '@shared/ipc'
import type { SqliteDatabase } from '../storage/database'
import type { StartPageRow } from './candidates'

/** The saved homework (project migration 030). One row per project file. */

export function saveStartPlan(db: SqliteDatabase, plan: SiteStartPlan): void {
  db.prepare(
    `INSERT INTO site_start (id, plan_json, built_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET plan_json = excluded.plan_json, built_at = excluded.built_at`
  ).run(JSON.stringify(plan), plan.builtAt)
}

export function loadStartPlan(db: SqliteDatabase): SiteStartPlan | null {
  const row = db
    .prepare<unknown[], { plan_json: string }>(`SELECT plan_json FROM site_start WHERE id = 1`)
    .get()
  if (row === undefined) return null
  try {
    return JSON.parse(row.plan_json) as SiteStartPlan
  } catch {
    return null
  }
}

/** Sitemap and tracked pages (never topics), oldest first. */
export function listStartPages(db: SqliteDatabase): StartPageRow[] {
  return db
    .prepare<unknown[], { id: string; url: string; title: string | null; status: string }>(
      `SELECT id, url, title, status FROM pages
       WHERE status != 'removed' AND kind = 'page' AND url IS NOT NULL
       ORDER BY rowid ASC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      url: row.url,
      title: row.title,
      tracked: row.status === 'tracked' || row.status === 'setting_up' || row.status === 'paused'
    }))
}

export function countSitemaps(db: SqliteDatabase): number {
  return (
    db
      .prepare<unknown[], { n: number }>(
        `SELECT COUNT(*) AS n FROM sitemaps WHERE included = 1 AND kind = 'urlset'`
      )
      .get()?.n ?? 0
  )
}
