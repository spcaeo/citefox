import { afterEach, describe, expect, test } from 'vitest'
import { listGenerationTemplates } from '../pipeline/templates'
import { APP_MIGRATIONS } from './app-schema'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { migrate } from './migrate'
import { applied, closeTracked, column, columns, tableNames, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { getTemplate, listTemplates } from './records'

/** App 020 (templates without a kind CHECK, template_versions, llm_calls) and project 022. */

afterEach(() => {
  closeTracked()
})

interface TemplateRow {
  id: string
  name: string
  version: number
  hash: string
  body: string
  schema: string | null
  settings_json: string | null
  kind: string
  notes: string | null
  deleted_at: string | null
  is_default: number
  is_shipped: number
  created_at: string
  updated_at: string | null
}

const ROWS: TemplateRow[] = [
  {
    id: 'tpl-buyer-profile',
    name: 'CiteFox default',
    version: 1,
    hash: 'a'.repeat(64),
    body: 'Shipped body {{ url }}',
    schema: null,
    settings_json: null,
    kind: 'buyer_profile',
    notes: null,
    deleted_at: null,
    is_default: 0,
    is_shipped: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: null
  },
  {
    id: 'tpl-mine',
    name: 'My profile',
    version: 3,
    hash: 'b'.repeat(64),
    body: 'My body {{ title }}',
    schema: '{"type":"object"}',
    settings_json: '{"model":"claude-opus-5-5","language":"es","promptCount":null,"tone":"plain"}',
    kind: 'buyer_profile',
    notes: 'Shorter wording',
    deleted_at: null,
    is_default: 1,
    is_shipped: 0,
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-05T00:00:00.000Z'
  },
  {
    id: 'tpl-gone',
    name: 'Old prompts',
    version: 2,
    hash: 'c'.repeat(64),
    body: 'Old body',
    schema: null,
    settings_json: '{}',
    kind: 'buyer_prompts',
    notes: null,
    deleted_at: '2026-10-06T00:00:00.000Z',
    is_default: 0,
    is_shipped: 0,
    created_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-04T00:00:00.000Z'
  }
]

const COLUMNS = `id, name, version, hash, body, "schema", settings_json, kind, notes, deleted_at,
  is_default, is_shipped, created_at, updated_at`

function insertRow(db: SqliteDatabase, row: TemplateRow): void {
  db.prepare(
    `INSERT INTO templates (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.name,
    row.version,
    row.hash,
    row.body,
    row.schema,
    row.settings_json,
    row.kind,
    row.notes,
    row.deleted_at,
    row.is_default,
    row.is_shipped,
    row.created_at,
    row.updated_at
  )
}

function templateRows(db: SqliteDatabase): TemplateRow[] {
  return db.prepare<unknown[], TemplateRow>(`SELECT ${COLUMNS} FROM templates ORDER BY id`).all()
}

function appAt19(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    APP_MIGRATIONS.filter((migration) => migration.version < 20)
  )
  for (const row of ROWS) insertRow(db, row)
  return db
}

describe('app 020_template_versions_and_llm_calls', () => {
  test('a version 19 file already takes any kind (019 opened it) and has no 020 tables', () => {
    const db = appAt19()
    insertRow(db, { ...ROWS[0], id: 'tpl-answer', kind: 'answer_shape' } as TemplateRow)
    expect(templateRows(db).map((row) => row.kind)).toContain('answer_shape')
    expect(tableNames(db)).not.toContain('template_versions')
    expect(tableNames(db)).not.toContain('llm_calls')
  })

  test('keeps every templates row, drops the kind CHECK, and keeps the indexes', () => {
    const db = appAt19()
    const before = templateRows(db)
    migrate(db, APP_MIGRATIONS)
    expect(applied(db).map((item) => item.version)).toContain(20)
    expect(templateRows(db)).toEqual(before)
    insertRow(db, {
      ...(ROWS[0] as TemplateRow),
      id: 'tpl-brand-prompts',
      kind: 'brand_prompts',
      is_shipped: 1,
      is_default: 1
    })
    expect(templateRows(db).map((row) => row.kind)).toContain('brand_prompts')
    // One live default per kind is still enforced.
    expect(() => {
      insertRow(db, {
        ...(ROWS[1] as TemplateRow),
        id: 'tpl-second-default',
        name: 'Another'
      })
    }).toThrow(/UNIQUE/)
    // One shipped row per kind too.
    expect(() => {
      insertRow(db, {
        ...(ROWS[0] as TemplateRow),
        id: 'tpl-second-shipped'
      })
    }).toThrow(/UNIQUE/)
  })

  test('backfills one template_versions row per template', () => {
    const db = appAt19()
    migrate(db, APP_MIGRATIONS)
    const versions = db
      .prepare<
        unknown[],
        {
          template_id: string
          version: number
          hash: string
          body: string
          settings_json: string | null
          saved_at: string
        }
      >(
        `SELECT template_id, version, hash, body, settings_json, saved_at
         FROM template_versions ORDER BY template_id`
      )
      .all()
    expect(versions).toEqual(
      [...ROWS]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((row) => ({
          template_id: row.id,
          version: row.version,
          hash: row.hash,
          body: row.body,
          settings_json: row.settings_json,
          saved_at: row.updated_at ?? row.created_at
        }))
    )
  })

  test('creates llm_calls with a project id and the source CHECK', () => {
    const db = appAt19()
    migrate(db, APP_MIGRATIONS)
    expect(column(db, 'llm_calls', 'project_id')?.notnull).toBe(0)
    expect(columns(db, 'llm_calls').map((item) => item.name)).toContain('template_hash')
    const insert = (source: string): void => {
      db.prepare(
        `INSERT INTO llm_calls (project_id, id, connection, model, source, template_kind,
           template_id, template_hash, assist_id, started_at, duration_ms, tokens_in,
           tokens_out, ok, error)
         VALUES (NULL, ?, 'claude-code', NULL, ?, NULL, NULL, NULL, NULL,
           '2026-10-19T12:00:00.000Z', 1, 0, 0, 1, NULL)`
      ).run(`llm-${source}`, source)
    }
    insert('playground')
    expect(() => {
      insert('cron')
    }).toThrow(/CHECK/)
  })

  test('a row of a kind this build lacks is skipped by every listing', () => {
    const db = appAt19()
    migrate(db, APP_MIGRATIONS)
    insertRow(db, {
      ...(ROWS[0] as TemplateRow),
      id: 'tpl-future-step',
      kind: 'future_step',
      is_default: 1
    })
    expect(listTemplates(db).map((record) => record.id)).not.toContain('tpl-future-step')
    expect(getTemplate(db, 'tpl-future-step')).toBeNull()
    const listed = listGenerationTemplates(db, { includeDeleted: true })
    expect(listed.map((template) => template.kind)).not.toContain('future_step')
    expect(listed.map((template) => template.id)).toContain('tpl-mine')
  })
})

describe('project 022_template_overrides_and_llm_calls', () => {
  test('creates template_overrides and llm_calls', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((migration) => migration.version < 22)
    )
    expect(tableNames(db)).not.toContain('template_overrides')
    expect(tableNames(db)).not.toContain('llm_calls')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db).map((item) => item.version)).toContain(22)
    expect(tableNames(db)).toEqual(expect.arrayContaining(['template_overrides', 'llm_calls']))
    expect(columns(db, 'llm_calls').map((item) => item.name)).not.toContain('project_id')

    const override = db.prepare(
      `INSERT INTO template_overrides
         (id, kind, version, base_template_id, body, hash, settings_json, created_at, reset_at)
       VALUES (?, 'aio_gap', ?, 'tpl-aio-gap', 'Body', ?, NULL, '2026-10-19T12:00:00.000Z', NULL)`
    )
    override.run('ovr-1', 1, 'd'.repeat(64))
    override.run('ovr-2', 2, 'e'.repeat(64))
    expect(() => override.run('ovr-3', 2, 'f'.repeat(64))).toThrow(/UNIQUE/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO template_overrides
             (id, kind, version, base_template_id, body, hash, settings_json, created_at)
           VALUES ('ovr-4', 'aio_gap', 9, 'tpl-aio-gap', 'Body', 'h', '[1]',
             '2026-10-19T12:00:00.000Z')`
        )
        .run()
    ).toThrow(/CHECK/)

    const call = (source: string): void => {
      db.prepare(
        `INSERT INTO llm_calls (id, connection, model, source, template_kind, template_id,
           template_hash, assist_id, started_at, duration_ms, tokens_in, tokens_out, ok, error)
         VALUES (?, 'anthropic-api', NULL, ?, NULL, NULL, NULL, NULL,
           '2026-10-19T12:00:00.000Z', 5, 1, 1, 0, 'failed')`
      ).run(`llm-${source}`, source)
    }
    call('report')
    expect(() => {
      call('nightly')
    }).toThrow(/CHECK/)
  })
})
