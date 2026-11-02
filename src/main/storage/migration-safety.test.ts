import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { APP_MIGRATIONS } from './app-schema'
import { openSqliteDatabase } from './database'
import { MIGRATION_BACKUP_SUFFIX, migrate } from './migrate'
import { applied, closeTracked, directories, foreignKeys, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import {
  addKeyUsage,
  deleteApiKey,
  deleteProject,
  insertApiKey,
  insertProject,
  type ApiKeyRecord
} from './records'
import { projectDatabaseRelativePath } from './slug'
import { appendTrayCheck, listRecentTrayChecks } from './tray-history'

afterEach(() => {
  closeTracked()
})

describe('a copy is kept before a table-rebuilding migration', () => {
  test('upgrading an existing file keeps one copy of the old database', () => {
    const file = join(tempDir(), 'app.sqlite')
    const old = track(openSqliteDatabase(file))
    migrate(old, APP_MIGRATIONS.slice(0, 16))
    insertProject(old, project('proj-1', 'textbolt'))
    old.close()

    const upgraded = track(openAppDatabase(file))
    expect(applied(upgraded).at(-1)?.version).toBe(APP_MIGRATIONS.length)
    const backup = `${file}${MIGRATION_BACKUP_SUFFIX}`
    expect(existsSync(backup)).toBe(true)
    if (process.platform !== 'win32') expect(statSync(backup).mode & 0o777).toBe(0o600)
    const copy = track(openSqliteDatabase(backup, { fileMustExist: true }))
    expect(applied(copy).at(-1)?.version).toBe(16)
    expect(copy.prepare('SELECT id FROM projects').all()).toEqual([{ id: 'proj-1' }])
  })

  test('a fresh database and an up-to-date one make no copy', () => {
    const file = join(tempDir(), 'app.sqlite')
    track(openAppDatabase(file)).close()
    expect(existsSync(`${file}${MIGRATION_BACKUP_SUFFIX}`)).toBe(false)
    track(openAppDatabase(file))
    expect(existsSync(`${file}${MIGRATION_BACKUP_SUFFIX}`)).toBe(false)
  })
})

describe('removing a key or a project', () => {
  test('removing a key keeps the searches it spent, so project caps do not reset', () => {
    const db = track(openAppDatabase(':memory:'))
    insertProject(db, project('proj-1', 'textbolt'))
    insertApiKey(db, key('key-1'))
    addKeyUsage(db, usage('u-1', 'key-1', 'proj-1', 7))
    deleteApiKey(db, 'key-1')
    expect(db.prepare('SELECT key_id, project_id, searches FROM key_usage').all()).toEqual([
      { key_id: 'key-1', project_id: 'proj-1', searches: 7 }
    ])
    expect(foreignKeys(db, 'key_usage').map((row) => row.table)).toEqual(['projects'])
  })

  test('a project with tray history and key usage can be deleted', () => {
    const db = track(openAppDatabase(':memory:'))
    insertProject(db, project('proj-1', 'textbolt'))
    insertProject(db, project('proj-2', 'other'))
    insertApiKey(db, key('key-1'))
    addKeyUsage(db, usage('u-1', 'key-1', 'proj-1', 4))
    addKeyUsage(db, usage('u-2', 'key-1', null, 2))
    addKeyUsage(db, usage('u-3', 'key-1', 'proj-2', 5))
    appendTrayCheck(db, {
      id: 'check-1',
      projectId: 'proj-1',
      pageId: 'page-1',
      label: 'Alerts',
      score: 40,
      change: null,
      finishedAt: '2026-04-20T12:00:00.000Z'
    })
    deleteProject(db, 'proj-1')
    expect(listRecentTrayChecks(db)).toEqual([])
    // The key's month total is unchanged. The deleted project's searches move to no project.
    expect(
      db.prepare('SELECT project_id, searches FROM key_usage ORDER BY project_id ASC').all()
    ).toEqual([
      { project_id: null, searches: 6 },
      { project_id: 'proj-2', searches: 5 }
    ])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    // With no no-project row yet, one is made.
    deleteProject(db, 'proj-2')
    expect(db.prepare('SELECT project_id, searches FROM key_usage').all()).toEqual([
      { project_id: null, searches: 11 }
    ])
    insertProject(db, project('proj-3', 'third'))
    addKeyUsage(db, { ...usage('u-4', 'key-1', 'proj-3', 1), month: '2026-05' })
    deleteProject(db, 'proj-3')
    expect(
      db.prepare(`SELECT project_id, searches FROM key_usage WHERE month = '2026-05'`).all()
    ).toEqual([{ project_id: null, searches: 1 }])
  })
})

describe('check reads use indexes', () => {
  test.each([
    [
      'runs for pages in a market',
      `SELECT id FROM runs WHERE page_id IN (?, ?) AND market_id = ? AND status != 'cancelled'
       ORDER BY started_at ASC, rowid ASC`
    ],
    ['runs for a job', 'SELECT id FROM runs WHERE job_id = ? ORDER BY started_at ASC'],
    [
      'references for a page',
      `SELECT aio_references.id FROM aio_references
       JOIN serp_results ON serp_results.id = aio_references.serp_result_id
       JOIN runs ON runs.id = serp_results.run_id
       WHERE runs.page_id IN (?) AND runs.market_id = ?`
    ],
    [
      'searches for a job',
      `SELECT COALESCE(SUM(serp_results.searches), 0) FROM serp_results
       JOIN runs ON runs.id = serp_results.run_id WHERE runs.job_id = ?`
    ],
    ['running jobs', `SELECT id FROM check_jobs WHERE status = 'running' ORDER BY started_at ASC`],
    ['coverage rows for a run', 'SELECT id FROM coverage_rows WHERE run_id = ?']
  ])('%s', (_label, sql) => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS)
    const plan = db
      .prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...Array.from(sql.matchAll(/\?/g), (_match, index) => `v${index}`))
      .map((row) => row.detail)
    const fullScans = plan.filter((detail) => /^SCAN \w+$/.test(detail))
    expect(fullScans).toEqual([])
  })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-migration-safety-'))
  directories.push(dir)
  return dir
}

function project(id: string, slug: string): Parameters<typeof insertProject>[1] {
  return {
    id,
    name: slug,
    slug,
    domain: `${slug}.example`,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  }
}

function key(id: string): ApiKeyRecord {
  return {
    id,
    provider: 'serpapi',
    name: id,
    keychainRef: `citefox.serpapi.${id}`,
    hint: 'ab12',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null
  }
}

function usage(
  id: string,
  keyId: string,
  projectId: string | null,
  searches: number
): Parameters<typeof addKeyUsage>[1] {
  return { id, keyId, projectId, month: '2026-04', searches, calls: searches, tokens: 0 }
}
