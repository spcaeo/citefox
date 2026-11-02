import { afterEach, describe, expect, test } from 'vitest'
import { APP_MIGRATIONS } from './app-schema'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, columns, tableSql, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { ANSWER_SHAPES_VERSION } from './project-schema-reports'

/** The answer-shape project migration (cache table); the template kind needs no app migration. */

const HASH = 'a'.repeat(64)

afterEach(() => {
  closeTracked()
})

describe('answer shape template kind', () => {
  test('needs no app migration: templates already accepts answer_shape after 019/020', () => {
    expect(APP_MIGRATIONS.map((item) => item.name)).not.toContain(
      expect.stringContaining('answer_shape')
    )
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, APP_MIGRATIONS)
    insertTemplate(db, {
      ...userRow('tpl-shape'),
      kind: 'answer_shape',
      isShipped: 0,
      isDefault: 1
    })
    expect(() =>
      insertTemplate(db, { ...userRow('tpl-shape-2'), kind: 'answer_shape', isDefault: 1 })
    ).toThrow(/UNIQUE/)
    expect(() => insertTemplate(db, { ...userRow('tpl-notes'), notes: '' })).toThrow(/CHECK/)
  })
})

describe('answer shapes project migration', () => {
  test('adds answer_shapes to an existing project database with its checks', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, ANSWER_SHAPES_VERSION - 1))
    expect(() => tableSql(db, 'answer_shapes')).toThrow('missing table answer_shapes')

    migrate(db, PROJECT_MIGRATIONS)

    expect(ANSWER_SHAPES_VERSION).toBe(23)
    expect(applied(db)).toContainEqual({ version: 23, name: '023_answer_shapes' })
    expect(columns(db, 'answer_shapes').map((column) => [column.name, column.notnull])).toEqual([
      ['overview_hash', 0],
      ['template_hash', 1],
      ['blocks_json', 1],
      ['classified_at', 1]
    ])
    const insert = db.prepare(
      `INSERT INTO answer_shapes (overview_hash, template_hash, blocks_json, classified_at)
       VALUES (?, ?, ?, ?)`
    )
    insert.run(HASH, HASH, '[{"code":"A1","excerpt":"Hi"}]', '2026-10-20T09:00:00.000Z')
    expect(() => insert.run(HASH, HASH, '[]', 'now')).toThrow(/UNIQUE|PRIMARY/)
    expect(() => insert.run('b'.repeat(63), HASH, '[]', 'now')).toThrow(/CHECK/)
    expect(() => insert.run('c'.repeat(64), 'short', '[]', 'now')).toThrow(/CHECK/)
    expect(() => insert.run('d'.repeat(64), HASH, '{"code":"A1"}', 'now')).toThrow(/CHECK/)
    expect(() => insert.run('e'.repeat(64), HASH, 'not json', 'now')).toThrow(/CHECK/)
    expect(() => insert.run('f'.repeat(64), HASH, '[]', '')).toThrow(/CHECK/)
  })
})

interface TemplateRow {
  id: string
  kind: string
  isDefault: number
  isShipped: number
  notes: string | null
  deletedAt: string | null
  settingsJson: string | null
  updatedAt: string | null
}

function userRow(id: string): TemplateRow {
  return {
    id,
    kind: 'coverage',
    isDefault: 0,
    isShipped: 0,
    notes: null,
    deletedAt: null,
    settingsJson: null,
    updatedAt: null
  }
}

function insertTemplate(db: SqliteDatabase, row: TemplateRow): void {
  db.prepare(
    `INSERT INTO templates (
       id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
       is_default, is_shipped, created_at, updated_at
     ) VALUES (?, ?, 2, ?, 'Body {{ url }}', '{"type":"object"}', ?, ?, ?, ?, ?, ?,
       '2026-10-01T00:00:00.000Z', ?)`
  ).run(
    row.id,
    `Name ${row.id}`,
    HASH,
    row.settingsJson,
    row.kind,
    row.notes,
    row.deletedAt,
    row.isDefault,
    row.isShipped,
    row.updatedAt
  )
}
