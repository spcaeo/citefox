import { afterEach, describe, expect, test } from 'vitest'
import { PROJECT_MIGRATIONS } from './project-schema'
import { openSqliteDatabase } from './database'
import { listAnalysesByMarket, listAnalysesByRun } from './analyses'
import { migrate } from './migrate'
import {
  applied,
  closeTracked,
  column,
  columns,
  foreignKeys,
  indexSql,
  tableNames,
  tableSql,
  track
} from './migrate.test-helper'

/** Project database upgrades. */

afterEach(() => {
  closeTracked()
})

describe('project alert settings migration', () => {
  test('adds alert settings after fix follow-ups and keeps the page', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 10))
    expect(tableNames(db)).not.toContain('alert_settings')
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db).map((row) => row.name)).toContain('011_alert_settings')
    expect(columns(db, 'alert_settings').map((column) => column.name)).toEqual([
      'id',
      'desktop',
      'email_after_check',
      'email_account_id',
      'email_to',
      'slack_enabled',
      'slack_keychain_ref',
      'monthly_client_pdf',
      'monthly_pdf_to'
    ])
    for (const name of ['desktop', 'email_after_check', 'slack_enabled', 'monthly_client_pdf']) {
      expect(column(db, 'alert_settings', name)?.dflt_value).toBe('0')
      expect(column(db, 'alert_settings', name)?.notnull).toBe(1)
    }
    expect(column(db, 'alert_settings', 'email_account_id')?.notnull).toBe(0)
    expect(column(db, 'alert_settings', 'slack_keychain_ref')?.notnull).toBe(0)
    expect(column(db, 'alert_settings', 'email_to')?.dflt_value).toContain('[]')
    expect(() =>
      db.prepare(`INSERT INTO alert_settings (id, desktop) VALUES (1, 2)`).run()
    ).toThrow(/CHECK/)
    expect(() =>
      db.prepare(`INSERT INTO alert_settings (id, email_to) VALUES (1, '"nope"')`).run()
    ).toThrow(/CHECK/)
    db.prepare(`INSERT INTO alert_settings (id) VALUES (1)`).run()
    const row = db
      .prepare<unknown[], { desktop: number; email_to: string; slack_keychain_ref: string | null }>(
        `SELECT desktop, email_to, slack_keychain_ref FROM alert_settings WHERE id = 1`
      )
      .get()
    expect(row).toEqual({ desktop: 0, email_to: '[]', slack_keychain_ref: null })
    const page = db.prepare<unknown[], { id: string }>(`SELECT id FROM pages`).get()
    expect(page?.id).toBe('page-1')
    const columnNames = columns(db, 'alert_settings').map((column) => column.name)
    expect(columnNames).not.toContain('webhook')
    expect(columnNames.join(' ')).not.toContain('url')
  })
})

describe('project analyses migration', () => {
  test('keeps generation rows and opens analyses on a version 12 database', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 12))
    expect(tableNames(db)).not.toContain('analyses')
    expect(applied(db).at(-1)?.name).toBe('012_check_runs')
    const hash = 'ab'.repeat(32)
    const otherHash = 'cd'.repeat(32)
    db.prepare(
      `INSERT INTO pages (id, url, title, status, interval_days, samples, prompt_count, pinned)
       VALUES ('page-1', 'https://textbolt.com/a', 'Alerts', 'tracked', 14, 1, 10, 0)`
    ).run()
    db.prepare(
      `INSERT INTO markets (
         id, country, language, location, device, local_wording, serpapi_location, is_default
       ) VALUES ('mkt-us', 'US', 'en', NULL, 'desktop', 0, NULL, 0)`
    ).run()
    db.prepare(
      `INSERT INTO snapshots (
         id, page_id, fetched_at, method, http_status, duration_ms, title, meta_description, h1,
         canonical, published_at, modified_at, outline_json, faqs_json, h2_count, h3_count,
         table_count, body_text, word_count, content_hash, summary_json
       ) VALUES (
         'snap-1', 'page-1', '2026-10-01T00:00:00.000Z', 'direct', 200, 5, 'Alerts', NULL, 'H1',
         NULL, NULL, NULL, '[]', '[]', 0, 0, 0, 'Body text for the snapshot.', 5, ?, NULL
       )`
    ).run(hash)
    db.prepare(
      `INSERT INTO buyer_profiles (
         id, page_id, snapshot_id, body_json, template_id, template_name, template_hash,
         template_updated_at, created_at
       ) VALUES (
         'icp-1', 'page-1', 'snap-1', '{"who":"ops"}', 'tpl-buyer-profile', 'CiteFox default',
         ?, NULL, '2026-10-01T00:00:00.000Z'
       )`
    ).run(hash)
    db.prepare(
      `INSERT INTO prompt_sets (
         id, page_id, version, saved_at, icp_id, template_id, template_hash, template_updated_at,
         template_name, is_active
       ) VALUES (
         'pset-1', 'page-1', 1, '2026-10-01T00:00:00.000Z', 'icp-1', NULL, NULL, NULL, NULL, 1
       )`
    ).run()
    db.prepare(
      `INSERT INTO prompts (
         id, prompt_set_id, position, label, source, intent_stage, mapped_element, enabled
       ) VALUES ('prompt-1', 'pset-1', 1, 'Crew', 'title_meta_h1', 'problem', 'intro', 1)`
    ).run()
    db.prepare(
      `INSERT INTO check_jobs (
         id, started_at, finished_at, status, page_ids, market_ids, prompt_ids, reason, searches_used
       ) VALUES (
         'job-1', '2026-10-01T00:00:00.000Z', '2026-10-01T00:01:00.000Z', 'finished',
         '["page-1"]', NULL, NULL, 'manual', 1
       )`
    ).run()
    db.prepare(
      `INSERT INTO runs (
         id, job_id, page_id, prompt_set_id, snapshot_id, market_id, started_at, finished_at,
         kind, partial, status, samples, content_hash
       ) VALUES (
         'run-1', 'job-1', 'page-1', 'pset-1', 'snap-1', 'mkt-us',
         '2026-10-01T00:00:00.000Z', '2026-10-01T00:01:00.000Z',
         'manual', 0, 'finished', 1, ?
       )`
    ).run(hash)
    db.prepare(
      `INSERT INTO generations (
         id, page_id, kind, template_id, template_hash, started_at, duration_ms,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
         model, connection, ok, error, input_hash, output_json
       ) VALUES (
         'gen-ok', 'page-1', 'coverage', 'tpl-coverage', ?, '2026-10-01T00:00:00.000Z', 12,
         10, 4, 2, 1, 0, 'claude-sonnet', 'claude-code', 1, NULL, ?, '{"kept":true}'
       )`
    ).run(hash, otherHash)
    db.prepare(
      `INSERT INTO generations (
         id, page_id, kind, template_id, template_hash, started_at, duration_ms,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
         model, connection, ok, error, input_hash, output_json
       ) VALUES (
         'gen-fail', 'page-1', 'buyer_profile', 'tpl-buyer-profile', ?, '2026-10-01T00:02:00.000Z', 3,
         1, 0, 0, 0, 0, NULL, 'anthropic-api', 0, 'schema miss', ?, NULL
       )`
    ).run(hash, hash)
    const generationsBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM generations ORDER BY id`)
      .all()
    const runsBefore = db
      .prepare<unknown[], Record<string, unknown>>(`SELECT * FROM runs ORDER BY id`)
      .all()
    const generationIndex = indexSql(db, 'generations')

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db).at(-1)).toEqual(latestProjectMigration())
    expect(tableNames(db)).toContain('analyses')
    expect(tableNames(db)).not.toContain('generations_next')
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM generations ORDER BY id`).all()
    ).toEqual(generationsBefore)
    // Migration 045 adds the engines a run checked: Google AI Overview on every old run.
    expect(
      db.prepare<unknown[], Record<string, unknown>>(`SELECT * FROM runs ORDER BY id`).all()
    ).toEqual(runsBefore.map((run) => ({ ...run, engines_json: '["google_aio"]', google_aio: 1 })))
    expect(indexSql(db, 'generations')).toEqual(generationIndex)
    // Migration 020 opened the kind check; the kind is validated in code since then.
    expect(tableSql(db, 'generations')).toContain('length(kind) > 0')
    expect(columns(db, 'analyses').map((column) => column.name)).toEqual([
      'id',
      'run_id',
      'snapshot_id',
      'kind',
      'prompt_id',
      'body_json',
      'template_hash',
      'done',
      'market_id',
      'generation_id'
    ])
    expect(indexSql(db, 'analyses').map((index) => index.name)).toEqual([
      'idx_analyses_generation',
      'idx_analyses_market',
      'idx_analyses_prompt',
      'idx_analyses_run',
      'idx_analyses_snapshot'
    ])
    expect(
      indexSql(db, 'analyses')
        .find((index) => index.name === 'idx_analyses_market')
        ?.sql.replace(/\s+/g, ' ')
    ).toContain('ON analyses (market_id)')
    expect(foreignKeys(db, 'analyses').map((key) => `${key.from}->${key.table}.${key.to}`)).toEqual(
      [
        'generation_id->generations.id',
        'prompt_id->prompts.id',
        'run_id->runs.id',
        'snapshot_id->snapshots.id'
      ]
    )
    expect(foreignKeys(db, 'analyses').map((key) => key.from)).not.toContain('market_id')

    db.prepare(
      `INSERT INTO generations (
         id, page_id, kind, template_id, template_hash, started_at, duration_ms,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
         model, connection, ok, error, input_hash, output_json
       ) VALUES (
         'gen-gap', 'page-1', 'aio_gap', 'aio_gap.md', ?, '2026-10-02T00:00:00.000Z', 4,
         11, 7, 2, 1, 0, 'claude-test', 'claude-code', 1, NULL, ?, '{"facts":[]}'
       )`
    ).run(hash, otherHash)
    db.prepare(
      `INSERT INTO generations (
         id, page_id, kind, template_id, template_hash, started_at, duration_ms,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, serpapi_searches,
         model, connection, ok, error, input_hash, output_json
       ) VALUES (
         'gen-summary', 'page-1', 'summary', 'run_summary.md', ?, '2026-10-02T00:01:00.000Z', 4,
         11, 7, 2, 1, 0, 'claude-test', 'claude-code', 1, NULL, ?, '{"body":"kept"}'
       )`
    ).run(hash, hash)
    // Since migration 020 the generation kind is validated in code (STORED_GENERATION_KINDS),
    // so later Claude steps need no table rebuild.
    db.prepare(
      `INSERT INTO analyses (
         id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done,
         market_id, generation_id
       ) VALUES (
         'an-gap', 'run-1', NULL, 'aio_gap', 'prompt-1', '{"prompts":[]}', ?, 1, 'mkt-us', 'gen-gap'
       )`
    ).run(hash)
    db.prepare(
      `INSERT INTO analyses (
         id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done,
         market_id, generation_id
       ) VALUES (
         'an-summary', 'run-1', NULL, 'summary', NULL, '{"body":"kept"}', ?, 1, 'mkt-us', 'gen-summary'
       )`
    ).run(hash)
    expect(listAnalysesByRun(db, 'run-1').map((row) => row.kind)).toEqual(['aio_gap', 'summary'])
    expect(listAnalysesByMarket(db, 'mkt-us').map((row) => row.generationId)).toEqual([
      'gen-gap',
      'gen-summary'
    ])
    expect(listAnalysesByRun(db, 'run-1')[0]).toMatchObject({
      runId: 'run-1',
      marketId: 'mkt-us',
      promptId: 'prompt-1',
      generationId: 'gen-gap',
      done: true,
      body: { prompts: [] }
    })
    expect(() =>
      db
        .prepare(
          `INSERT INTO analyses (
             id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done, market_id
           ) VALUES ('an-bad', 'run-1', NULL, 'coverage', NULL, '{}', ?, 1, 'mkt-us')`
        )
        .run(hash)
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO analyses (
             id, run_id, snapshot_id, kind, prompt_id, body_json, template_hash, done
           ) VALUES ('an-no-market', 'run-1', NULL, 'summary', NULL, '{}', ?, 1)`
        )
        .run(hash)
    ).toThrow(/CHECK/)
    expect(
      db.prepare<unknown[], { id: string }>(`SELECT id FROM generations WHERE id = 'gen-ok'`).get()
        ?.id
    ).toBe('gen-ok')
  })
})

describe('project monthly pdf recipient migration', () => {
  test('adds monthly_pdf_to to an existing version 13 alert_settings row', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 13))
    expect(applied(db).at(-1)).toEqual({ version: 13, name: '013_analyses' })
    expect(columns(db, 'alert_settings').map((column) => column.name)).not.toContain(
      'monthly_pdf_to'
    )
    db.prepare(
      `INSERT INTO alert_settings (
         id, desktop, email_after_check, email_account_id, email_to, slack_enabled,
         slack_keychain_ref, monthly_client_pdf
       ) VALUES (1, 1, 0, NULL, '["ops@example.com"]', 0, NULL, 1)`
    ).run()

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db).at(-1)).toEqual(latestProjectMigration())
    const added = column(db, 'alert_settings', 'monthly_pdf_to')
    expect(added).toMatchObject({ notnull: 0, dflt_value: null })
    expect(
      columns(db, 'alert_settings')
        .map((item) => item.name)
        .at(-1)
    ).toBe('monthly_pdf_to')
    const existing = db
      .prepare<unknown[], { monthly_pdf_to: string | null; monthly_client_pdf: number }>(
        `SELECT monthly_pdf_to, monthly_client_pdf FROM alert_settings WHERE id = 1`
      )
      .get()
    expect(existing).toEqual({ monthly_pdf_to: null, monthly_client_pdf: 1 })
    db.prepare(`UPDATE alert_settings SET monthly_pdf_to = ? WHERE id = 1`).run('pdf@example.com')
    expect(
      db
        .prepare<unknown[], { monthly_pdf_to: string }>(
          `SELECT monthly_pdf_to FROM alert_settings WHERE id = 1`
        )
        .get()?.monthly_pdf_to
    ).toBe('pdf@example.com')
  })
})

describe('project google extras migration (044)', () => {
  test('adds nullable google_json and eligibility_json and keeps old rows unread', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 43))
    db.pragma('foreign_keys = OFF')
    db.prepare(
      `INSERT INTO serp_results (
         id, run_id, prompt_id, sample_no, has_aio, needed_followup, searches, status, raw_search_json
       ) VALUES ('serp-old', 'run-old', 'prompt-1', 1, 0, 0, 1, 'no_aio', '{"organic_results": []}')`
    ).run()
    db.pragma('foreign_keys = ON')

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db).find((row) => row.version === 44)).toEqual({
      version: 44,
      name: '044_google_extras'
    })
    expect(column(db, 'serp_results', 'google_json')).toMatchObject({
      notnull: 0,
      dflt_value: null
    })
    expect(column(db, 'snapshots', 'eligibility_json')).toMatchObject({
      notnull: 0,
      dflt_value: null
    })
    // Old rows stay unread (null) until a screen needs them; the raw search is kept.
    const old = db
      .prepare<unknown[], { google_json: string | null; raw_search_json: string }>(
        `SELECT google_json, raw_search_json FROM serp_results WHERE id = 'serp-old'`
      )
      .get()
    expect(old).toEqual({ google_json: null, raw_search_json: '{"organic_results": []}' })
    expect(() =>
      db.prepare(`UPDATE serp_results SET google_json = 'not json' WHERE id = 'serp-old'`).run()
    ).toThrow(/CHECK/)
    db.prepare(
      `UPDATE serp_results SET google_json = '{"organic":[],"questions":[]}' WHERE id = 'serp-old'`
    ).run()
  })
})

describe('project migrations on a fresh database', () => {
  test('applies 1 to 056 in order: importer 038, alert rules 039, competitor aliases 040, gap states 041, check asks 042, fix loop 043, google extras 044, engines 045, codex 046, topic target 047, site overrides 048, guide 049, topic folders 050, page fix briefs 051, page edits 052, owner whys 053, fix verdicts 054, check intervals 055, page history 056, rules and tracking 057, also pages 058', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS)
    const rows = applied(db)
    expect(rows.map((row) => row.version)).toEqual(
      Array.from({ length: 58 }, (_, index) => index + 1)
    )
    expect(rows[37]?.name).toBe('038_import')
    expect(rows[38]?.name).toBe('039_alert_rules')
    expect(rows[39]?.name).toBe('040_competitor_aliases')
    expect(rows[40]?.name).toBe('041_gap_states')
    expect(rows[41]?.name).toBe('042_check_asks')
    expect(rows[42]?.name).toBe('043_fix_loop')
    expect(rows[43]?.name).toBe('044_google_extras')
    expect(rows[44]?.name).toBe('045_engines')
    expect(rows[45]?.name).toBe('046_codex_connection')
    expect(rows[46]?.name).toBe('047_topic_target_page')
    expect(rows[47]?.name).toBe('048_site_overrides')
    expect(rows[48]?.name).toBe('049_guide')
    expect(rows[49]?.name).toBe('050_topic_folders')
    expect(rows[50]?.name).toBe('051_page_fix_briefs')
    expect(rows[51]?.name).toBe('052_page_edits')
    expect(rows[52]?.name).toBe('053_owner_whys')
    expect(rows[53]?.name).toBe('054_fix_verdicts')
    expect(rows[54]?.name).toBe('055_check_intervals')
    expect(rows[55]?.name).toBe('056_page_history')
    expect(rows[56]?.name).toBe('057_rules_tracking')
    expect(rows[57]?.name).toBe('058_topic_also_pages')
  })
})

function latestProjectMigration(): { version: number; name: string } {
  const last = PROJECT_MIGRATIONS.at(-1)
  if (last === undefined) throw new Error('no project migrations')
  return { version: last.version, name: last.name }
}
