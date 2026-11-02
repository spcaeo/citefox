import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import {
  insertLlmCall,
  lastCallOfKind,
  listLlmCalls,
  recentDurations,
  type LlmCallRow
} from './llm-calls'
import { createProjectDatabase } from './project-files'

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function projectDb(): SqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-llm-calls-'))
  directories.push(directory)
  const db = createProjectDatabase(directory, 'textbolt')
  databases.push(db)
  return db
}

function appDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

function row(partial: Partial<LlmCallRow> = {}): LlmCallRow {
  return {
    id: 'llm-1',
    connection: 'claude-code',
    model: 'claude-sonnet-5-5',
    source: 'pipeline',
    templateKind: 'buyer_profile',
    templateId: 'tpl-buyer-profile',
    templateHash: 'c'.repeat(64),
    assistId: null,
    startedAt: '2026-10-19T12:00:00.000Z',
    durationMs: 1000,
    tokensIn: 10,
    tokensOut: 20,
    ok: true,
    error: null,
    ...partial
  }
}

describe('llm_calls rows', () => {
  test('project rows list newest first, filtered by since, with the given project id', () => {
    const db = projectDb()
    insertLlmCall(db, row({ id: 'llm-old', startedAt: '2026-09-30T23:00:00.000Z' }), {
      table: 'project'
    })
    insertLlmCall(db, row({ id: 'llm-a', startedAt: '2026-10-19T10:00:00.000Z' }), {
      table: 'project'
    })
    insertLlmCall(db, row({ id: 'llm-b', startedAt: '2026-10-19T11:00:00.000Z' }), {
      table: 'project'
    })
    const all = listLlmCalls(db, { since: null, projectId: 'proj-1', appTable: false })
    expect(all.map((item) => item.id)).toEqual(['llm-b', 'llm-a', 'llm-old'])
    expect(all.every((item) => item.projectId === 'proj-1')).toBe(true)
    const recent = listLlmCalls(db, {
      since: '2026-10-01T00:00:00.000Z',
      projectId: 'proj-1',
      appTable: false
    })
    expect(recent.map((item) => item.id)).toEqual(['llm-b', 'llm-a'])
    expect(recent[0]).toEqual({
      ...row({ id: 'llm-b', startedAt: '2026-10-19T11:00:00.000Z' }),
      projectId: 'proj-1'
    })
    expect(
      listLlmCalls(db, { since: null, limit: 1, projectId: null, appTable: false })
    ).toHaveLength(1)
  })

  test('app rows keep their own project id', () => {
    const db = appDb()
    insertLlmCall(db, row({ id: 'llm-app', source: 'playground' }), {
      table: 'app',
      projectId: null
    })
    insertLlmCall(
      db,
      row({ id: 'llm-tagged', source: 'assist', startedAt: '2026-10-19T12:30:00.000Z' }),
      { table: 'app', projectId: 'proj-2' }
    )
    const rows = listLlmCalls(db, { since: null, projectId: 'ignored', appTable: true })
    expect(rows.map((item) => [item.id, item.projectId, item.source])).toEqual([
      ['llm-tagged', 'proj-2', 'assist'],
      ['llm-app', null, 'playground']
    ])
  })

  test('recent durations count successful calls only, newest first, by assist or kind', () => {
    const db = projectDb()
    const add = (id: string, at: string, partial: Partial<LlmCallRow>): void => {
      insertLlmCall(db, row({ id, startedAt: `2026-10-19T${at}:00.000Z`, ...partial }), {
        table: 'project'
      })
    }
    add('llm-1', '10:00', { durationMs: 1000 })
    add('llm-2', '11:00', { durationMs: 3000 })
    add('llm-3', '12:00', { durationMs: 9000, ok: false, error: 'timeout' })
    add('llm-4', '13:00', {
      durationMs: 5000,
      templateKind: null,
      templateId: null,
      templateHash: null,
      assistId: 'page.titles',
      source: 'assist'
    })
    expect(recentDurations(db, { templateKind: 'buyer_profile' })).toEqual([3000, 1000])
    expect(recentDurations(db, { templateKind: 'buyer_profile' }, 1)).toEqual([3000])
    expect(recentDurations(db, { assistId: 'page.titles' })).toEqual([5000])
    expect(recentDurations(db, { assistId: 'nope.none' })).toEqual([])
  })

  test('last call of a kind includes failed calls and is null when none', () => {
    const db = projectDb()
    expect(lastCallOfKind(db, 'coverage')).toBeNull()
    insertLlmCall(db, row({ id: 'llm-1', templateKind: 'coverage' }), { table: 'project' })
    insertLlmCall(
      db,
      row({
        id: 'llm-2',
        templateKind: 'coverage',
        startedAt: '2026-10-19T15:00:00.000Z',
        ok: false,
        error: 'failed'
      }),
      { table: 'project' }
    )
    expect(lastCallOfKind(db, 'coverage')).toBe('2026-10-19T15:00:00.000Z')
  })

  test('rejects a bad connection, a bad source, a bad id, and an error holding a key', () => {
    const db = projectDb()
    expect(() => {
      insertLlmCall(db, row({ connection: 'openai' as unknown as LlmCallRow['connection'] }), {
        table: 'project'
      })
    }).toThrow(/connection/)
    expect(() => {
      insertLlmCall(db, row({ source: 'cron' as unknown as LlmCallRow['source'] }), {
        table: 'project'
      })
    }).toThrow(/source/)
    expect(() => {
      insertLlmCall(db, row({ ok: false, error: 'bad key sk-ant-api03-abcdefghijklmnop' }), {
        table: 'project'
      })
    }).toThrow()
    expect(() => {
      insertLlmCall(db, row({ id: 'bad id with spaces' }), { table: 'project' })
    }).toThrow()
    expect(listLlmCalls(db, { since: null, projectId: null, appTable: false })).toEqual([])
  })

  test('clamps counts, trims text, caps the error, and blanks empty strings', () => {
    const db = projectDb()
    insertLlmCall(
      db,
      row({
        model: `  ${'m'.repeat(200)}  `,
        templateKind: '   ',
        durationMs: -5,
        tokensIn: -1,
        tokensOut: Number.NaN,
        ok: false,
        error: 'e'.repeat(900)
      }),
      { table: 'project' }
    )
    const [stored] = listLlmCalls(db, { since: null, projectId: null, appTable: false })
    expect(stored?.model).toBe('m'.repeat(120))
    expect(stored?.templateKind).toBeNull()
    expect(stored?.durationMs).toBe(0)
    expect(stored?.tokensIn).toBe(0)
    expect(stored?.tokensOut).toBe(0)
    expect(stored?.error).toHaveLength(500)
    expect(stored?.ok).toBe(false)
  })
})
