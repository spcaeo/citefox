import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import {
  insertEngineAnswer,
  listEngineAnswers,
  listEngineSources,
  readEngineSettings,
  readPageEngines,
  runEngines,
  saveEngineSettings,
  savePageEngines,
  saveJobSpend,
  type NewEngineAnswer
} from './engine-records'
import { migrate } from './migrate'
import { applied, closeTracked, column, tableNames, track } from './migrate.test-helper'
import { ENGINES_VERSION } from './project-schema-engines'
import { PROJECT_MIGRATIONS } from './project-schema'

/** Project database upgrade 045: engines, cloro, credits and cost. */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-24T09:00:00.000Z'

function before045(): SqliteDatabase {
  const at = PROJECT_MIGRATIONS.findIndex((item) => item.version === ENGINES_VERSION)
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS.slice(0, at))
  db.prepare(
    `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
     VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
  ).run()
  db.pragma('foreign_keys = OFF')
  db.prepare(
    `INSERT INTO check_jobs (
       id, started_at, finished_at, status, page_ids, market_ids, prompt_ids, reason, searches_used
     ) VALUES ('job-1', '2026-10-01T00:00:00.000Z', '2026-10-01T00:01:00.000Z', 'finished',
       '["page-1"]', NULL, NULL, 'manual', 2)`
  ).run()
  db.prepare(
    `INSERT INTO runs (
       id, job_id, page_id, prompt_set_id, snapshot_id, market_id, started_at, finished_at,
       kind, partial, status, samples, content_hash
     ) VALUES ('run-1', 'job-1', 'page-1', 'pset-1', 'snap-1', 'mkt-us',
       '2026-10-01T00:00:00.000Z', '2026-10-01T00:01:00.000Z', 'manual', 0, 'finished', 1, 'hash-1')`
  ).run()
  db.prepare(
    `INSERT INTO serp_results (
       id, run_id, prompt_id, sample_no, has_aio, needed_followup, searches, status, raw_search_json
     ) VALUES ('serp-old', 'run-1', 'prompt-1', 1, 0, 0, 1, 'no_aio', '{}')`
  ).run()
  db.pragma('foreign_keys = ON')
  return db
}

function answer(id: string, overrides: Partial<NewEngineAnswer> = {}): NewEngineAnswer {
  return {
    id,
    runId: 'run-1',
    promptId: 'prompt-1',
    sampleNo: 1,
    engine: 'chatgpt' as const,
    keyId: 'key-c',
    status: 'cited' as const,
    citedUrl: 'https://textbolt.com/a',
    position: 2,
    named: true,
    answerText: 'TextBolt sends texts.',
    answerMarkdown: '**TextBolt** sends texts.',
    errorCode: null,
    message: null,
    searches: 1,
    credits: 7,
    costMicros: 5600,
    rawJson: '{}',
    checkedAt: NOW,
    sources: [],
    ...overrides
  }
}

describe('project migration 045_engines', () => {
  test('follows 044 and marks every old row as Google AI Overview on SerpApi', () => {
    const at = PROJECT_MIGRATIONS.findIndex((item) => item.version === ENGINES_VERSION)
    expect(PROJECT_MIGRATIONS[at]).toMatchObject({ version: 45, name: '045_engines' })
    expect(PROJECT_MIGRATIONS[at - 1]?.version).toBe(44)
    const db = before045()

    migrate(db, PROJECT_MIGRATIONS)

    expect(applied(db).find((row) => row.version === 45)).toEqual({
      version: 45,
      name: '045_engines'
    })
    expect(
      db
        .prepare(
          `SELECT engine, provider, credits, cost_micros, aio_markdown FROM serp_results
           WHERE id = 'serp-old'`
        )
        .get()
    ).toEqual({
      engine: 'google_aio',
      provider: 'serpapi',
      credits: 0,
      cost_micros: 0,
      aio_markdown: null
    })
    expect(
      db.prepare(`SELECT engines_json, google_aio FROM runs WHERE id = 'run-1'`).get()
    ).toEqual({ engines_json: '["google_aio"]', google_aio: 1 })
    expect(
      db
        .prepare(`SELECT provider, credits_used, cost_micros FROM check_jobs WHERE id = 'job-1'`)
        .get()
    ).toEqual({ provider: null, credits_used: 0, cost_micros: 0 })
    expect(column(db, 'brand_captures', 'credits')).toMatchObject({ notnull: 1, dflt_value: '0' })
    expect(column(db, 'brand_captures', 'cost_micros')).toMatchObject({ notnull: 1 })
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'engine_answers',
        'engine_sources',
        'engine_settings',
        'page_engines'
      ])
    )
    expect(runEngines(db, 'run-1')).toEqual(['google_aio'])

    // Google rows stay Google; the answer engines live in engine_answers.
    expect(() =>
      db.prepare(`UPDATE serp_results SET engine = 'chatgpt' WHERE id = 'serp-old'`).run()
    ).toThrow(/CHECK/)
  })

  test('keeps Google AI Overview only and auto until a project picks engines', () => {
    const db = before045()
    migrate(db, PROJECT_MIGRATIONS)
    expect(readEngineSettings(db)).toEqual({
      engines: ['google_aio'],
      provider: 'auto',
      updatedAt: null
    })
    expect(readPageEngines(db, 'page-1')).toBeNull()

    expect(
      saveEngineSettings(db, { engines: ['perplexity', 'google_aio', 'chatgpt'] }, NOW)
    ).toEqual({
      engines: ['google_aio', 'chatgpt', 'perplexity'],
      provider: 'auto',
      updatedAt: NOW
    })
    expect(saveEngineSettings(db, { provider: 'serpapi' }, NOW).engines).toEqual([
      'google_aio',
      'chatgpt',
      'perplexity'
    ])
    expect(() => saveEngineSettings(db, { engines: [] }, NOW)).toThrow(/at least one engine/)

    savePageEngines(db, 'page-1', ['gemini'], NOW)
    expect(readPageEngines(db, 'page-1')).toEqual(['gemini'])
    savePageEngines(db, 'page-1', null, NOW)
    expect(readPageEngines(db, 'page-1')).toBeNull()

    // A removed page takes its own choice with it.
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-2', 'https://textbolt.com/b', 'tracked', 14, 1, 10)`
    ).run()
    savePageEngines(db, 'page-2', ['copilot'], NOW)
    db.prepare(`DELETE FROM pages WHERE id = 'page-2'`).run()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM page_engines`).get()).toEqual({ n: 0 })
  })

  test('stores answers with sources, never charges an unavailable engine, and sums the job', () => {
    const db = before045()
    migrate(db, PROJECT_MIGRATIONS)
    insertEngineAnswer(
      db,
      answer('ans-1', {
        sources: [
          {
            id: 'src-1',
            position: 1,
            url: 'https://textbolt.com/a',
            normalizedUrl: 'textbolt.com/a',
            domain: 'textbolt.com',
            title: 'TextBolt',
            classification: 'target'
          }
        ]
      })
    )
    insertEngineAnswer(
      db,
      answer('ans-2', {
        engine: 'perplexity',
        status: 'unavailable',
        citedUrl: 'https://ignored.example/',
        position: null,
        named: false,
        answerText: null,
        answerMarkdown: null,
        errorCode: 'unavailable',
        message: 'Perplexity is unavailable at cloro right now.',
        credits: 6,
        costMicros: 4800
      })
    )
    const answers = listEngineAnswers(db, ['run-1'], 'prompt-1')
    expect(answers.map((row) => [row.engine, row.status, row.credits, row.citedUrl])).toEqual([
      ['chatgpt', 'cited', 7, 'https://textbolt.com/a'],
      ['perplexity', 'unavailable', 0, null]
    ])
    expect(listEngineSources(db, ['ans-1'])).toEqual([
      {
        answerId: 'ans-1',
        position: 1,
        url: 'https://textbolt.com/a',
        domain: 'textbolt.com',
        title: 'TextBolt',
        classification: 'target'
      }
    ])
    // One reply per run, question, sample and engine.
    expect(() => insertEngineAnswer(db, answer('ans-3'))).toThrow()

    db.prepare(
      `UPDATE serp_results SET credits = 7, cost_micros = 5600 WHERE id = 'serp-old'`
    ).run()
    expect(saveJobSpend(db, 'job-1', 'cloro')).toEqual({ credits: 14, costMicros: 11_200 })
    expect(
      db
        .prepare(`SELECT provider, credits_used, cost_micros FROM check_jobs WHERE id = 'job-1'`)
        .get()
    ).toEqual({ provider: 'cloro', credits_used: 14, cost_micros: 11_200 })

    // Deleting an answer removes its sources.
    db.prepare(`DELETE FROM engine_answers WHERE id = 'ans-1'`).run()
    expect(listEngineSources(db, ['ans-1'])).toEqual([])
  })
})
