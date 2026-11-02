import { afterEach, describe, expect, test } from 'vitest'
import { page, snapshot } from '../engine/checks/checks.test-helper'
import { contentHash } from '../pipeline/hash'
import { APP_MIGRATIONS } from './app-schema'
import { insertSnapshot } from './content-records'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { insertGeneration, listGenerations } from './generation-records'
import { insertLlmCall, listLlmCalls, type LlmCallRow } from './llm-calls'
import { migrate } from './migrate'
import { applied, checkClauses, closeTracked, tableSql, track } from './migrate.test-helper'
import { insertPage } from './pages'
import { PROJECT_MIGRATIONS } from './project-schema'
import {
  CODEX_CONNECTION_APP_VERSION,
  CODEX_CONNECTION_PROJECT_VERSION
} from './schema-codex-connection'

/** App upgrade 024 and project upgrade 046: `codex` as a logged connection. */

afterEach(() => {
  closeTracked()
})

const HASH = contentHash('x')
const NOW = '2026-10-29T12:00:00.000Z'

function call(id: string, connection: LlmCallRow['connection']): LlmCallRow {
  return {
    id,
    connection,
    model: connection === 'codex' ? 'gpt-5.6-terra' : 'claude-sonnet-5-5',
    source: 'pipeline',
    templateKind: null,
    templateId: null,
    templateHash: null,
    assistId: null,
    startedAt: NOW,
    durationMs: 10,
    tokensIn: 5,
    tokensOut: 2,
    ok: true,
    error: null
  }
}

function generation(
  id: string,
  connection: 'claude-code' | 'codex'
): Parameters<typeof insertGeneration>[1] {
  return {
    id,
    pageId: 'page-1',
    kind: 'aio_gap',
    templateId: 'tpl',
    templateHash: HASH,
    startedAt: NOW,
    durationMs: 1,
    model: null,
    connection,
    ok: true,
    error: null,
    inputHash: HASH,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      serpapiSearches: 0
    }
  }
}

function indexNames(db: SqliteDatabase, table: string): string[] {
  return db
    .prepare<unknown[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name"
    )
    .all(table)
    .map((row) => row.name)
}

function before(migrations: typeof APP_MIGRATIONS, version: number): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    migrations.slice(
      0,
      migrations.findIndex((item) => item.version === version)
    )
  )
  return db
}

describe('app migration 024_codex_connection', () => {
  test('keeps every call and index, and accepts codex afterwards', () => {
    const db = before(APP_MIGRATIONS, CODEX_CONNECTION_APP_VERSION)
    insertLlmCall(db, call('call-old', 'claude-code'), { table: 'app', projectId: null })
    expect(() =>
      insertLlmCall(db, call('call-early', 'codex'), { table: 'app', projectId: null })
    ).toThrow()
    const indexes = indexNames(db, 'llm_calls')
    const checks = checkClauses(tableSql(db, 'llm_calls')).length

    migrate(db, APP_MIGRATIONS)

    expect(applied(db)).toContainEqual({ version: 24, name: '024_codex_connection' })
    expect(indexNames(db, 'llm_calls')).toEqual(indexes)
    expect(checkClauses(tableSql(db, 'llm_calls'))).toHaveLength(checks)
    insertLlmCall(db, call('call-codex', 'codex'), { table: 'app', projectId: null })
    const rows = listLlmCalls(db, { since: null, projectId: null, appTable: true })
    expect(rows.map((row) => [row.id, row.connection]).sort()).toEqual([
      ['call-codex', 'codex'],
      ['call-old', 'claude-code']
    ])
    expect(() =>
      insertLlmCall(
        db,
        { ...call('call-bad', 'codex'), connection: 'other' as 'codex' },
        {
          table: 'app',
          projectId: null
        }
      )
    ).toThrow()
  })
})

describe('project migration 046_codex_connection', () => {
  test('keeps calls, generations and the analyses that point at them', () => {
    const db = before(PROJECT_MIGRATIONS, CODEX_CONNECTION_PROJECT_VERSION)
    insertPage(db, { ...page(), defaultMarketId: null })
    insertSnapshot(db, snapshot())
    insertLlmCall(db, call('call-old', 'anthropic-api'), { table: 'project' })
    insertGeneration(db, generation('gen-old', 'claude-code'), { facts: [] })
    db.prepare(
      `INSERT INTO analyses (id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash,
         done, market_id, generation_id)
       VALUES ('an-1', NULL, 'snap-1', 'gap_matrix', NULL, '{}', ?, 1, NULL, 'gen-old')`
    ).run(HASH)
    const indexes = indexNames(db, 'generations')

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db)).toContainEqual({ version: 46, name: '046_codex_connection' })
    expect(indexNames(db, 'generations')).toEqual(indexes)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.prepare('SELECT generation_id FROM analyses').all()).toEqual([
      { generation_id: 'gen-old' }
    ])
    insertLlmCall(db, call('call-codex', 'codex'), { table: 'project' })
    insertGeneration(db, generation('gen-codex', 'codex'), { facts: [] })
    expect(
      listLlmCalls(db, { since: null, projectId: 'p', appTable: false })
        .map((row) => row.connection)
        .sort()
    ).toEqual(['anthropic-api', 'codex'])
    expect(
      listGenerations(db, 'page-1')
        .map((row) => row.connection)
        .sort()
    ).toEqual(['claude-code', 'codex'])
  })
})
