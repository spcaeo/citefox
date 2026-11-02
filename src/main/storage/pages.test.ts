import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { migrate } from './migrate'
import {
  MAX_PROMPT_COUNT,
  addPageMarket,
  getPage,
  getPageMarketFirstCheckNotBefore,
  getPageMarketLastCheckedAt,
  insertPage,
  listPageMarketSchedules,
  listPageMarkets,
  listPageMarketsFirstCheckDue,
  listPages,
  listPinnedPages,
  setPageMarketFirstCheckNotBefore,
  setPageMarketLastCheckedAt,
  setPagePinned,
  setPageStatus,
  setPageTitleIfEmpty
} from './pages'
import {
  ensureProjectSchema,
  getMarket,
  insertMarket,
  writeProjectProfile
} from './project-profile'
import { PROJECT_MIGRATIONS } from './project-schema'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('pages', () => {
  test('stores a page, its markets, and the pinned list', () => {
    const db = projectDb()
    const page = samplePage({ pinned: true })
    insertPage(db, page)
    addPageMarket(db, {
      pageId: page.id,
      marketId: 'mkt-us',
      addedAt: '2026-10-19T12:00:00.000Z',
      baselineRunId: null
    })
    addPageMarket(db, {
      pageId: page.id,
      marketId: 'mkt-mx',
      addedAt: '2026-10-19T12:00:01.000Z',
      baselineRunId: null
    })

    expect(getPage(db, page.id, PROJECT)).toEqual({ ...page, kind: 'page' })
    expect(getPage(db, page.id, 'proj-other')?.projectId).toBe('proj-other')
    expect(pageColumns(db)).not.toContain('project_id')
    expect(listPages(db, PROJECT).map((row) => row.id)).toEqual([page.id])
    expect(listPinnedPages(db, PROJECT).map((row) => row.id)).toEqual([page.id])
    expect(listPageMarkets(db, page.id).map((row) => row.marketId)).toEqual(['mkt-us', 'mkt-mx'])
    expect(getPageMarketLastCheckedAt(db, page.id, 'mkt-us')).toBeNull()
    setPageMarketLastCheckedAt(db, page.id, 'mkt-us', '2026-04-06T08:00:00.000Z')
    expect(getPageMarketLastCheckedAt(db, page.id, 'mkt-us')).toBe('2026-04-06T08:00:00.000Z')
    expect(getPageMarketLastCheckedAt(db, page.id, 'mkt-mx')).toBeNull()
    expect(() => getPageMarketLastCheckedAt(db, page.id, 'mkt-no')).toThrow(/Unknown page market/)
    expect(() =>
      setPageMarketLastCheckedAt(db, page.id, 'mkt-no', '2026-04-06T08:00:00.000Z')
    ).toThrow(/Unknown page market/)
    expect(setPagePinned(db, page.id, false, PROJECT).pinned).toBe(false)
    expect(listPinnedPages(db, PROJECT)).toEqual([])
  })

  test('lists markets added together in the order they were added, not by id', () => {
    const db = projectDb()
    insertPage(db, samplePage())
    for (const [id, country] of [
      ['mkt-gb', 'GB'],
      ['mkt-au', 'AU']
    ] as const) {
      insertMarket(db, {
        id,
        country,
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      })
    }
    // Add page saves every market with the same timestamp; random ids must not reorder them.
    const added = ['mkt-us', 'mkt-gb', 'mkt-mx', 'mkt-au']
    for (const marketId of added) {
      addPageMarket(db, {
        pageId: 'page-1',
        marketId,
        addedAt: '2026-10-21T10:22:14.554Z',
        baselineRunId: null
      })
    }
    expect(listPageMarkets(db, 'page-1').map((row) => row.marketId)).toEqual(added)
    expect(
      listPageMarketSchedules(db)
        .get('page-1')
        ?.map((row) => row.marketId)
    ).toEqual(added)
  })

  test('lists 2,014 pages in one statement with their setup step (NFR-12)', () => {
    const db = projectDb()
    const insert = db.transaction(() => {
      for (let index = 0; index < 2014; index += 1) {
        insertPage(
          db,
          samplePage({
            id: `page-${index}`,
            url: `https://textbolt.com/blog/post-${index}/`
          })
        )
      }
    })
    insert()
    const prepared: string[] = []
    const original = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      prepared.push(sql)
      return original(sql)
    }) as typeof db.prepare
    const started = performance.now()
    const pages = listPages(db, PROJECT)
    const elapsed = performance.now() - started
    db.prepare = original
    expect(pages).toHaveLength(2014)
    expect(pages.every((page) => page.setupStep === 'read')).toBe(true)
    expect(prepared).toHaveLength(1)
    expect(elapsed).toBeLessThan(500)
  })

  test('clears the pin and pinned_at when a page is removed, and leaves other pins', () => {
    const db = projectDb()
    insertPage(db, samplePage())
    insertPage(
      db,
      samplePage({
        id: 'page-2',
        url: 'https://example.com/other'
      })
    )
    setPagePinned(db, 'page-1', true, PROJECT, '2026-10-19T12:00:00.000Z')
    setPagePinned(db, 'page-2', true, PROJECT, '2026-10-19T12:00:01.000Z')
    setPageStatus(db, 'page-1', 'removed', PROJECT)
    expect(listPinnedPages(db, PROJECT).map((row) => row.id)).toEqual(['page-2'])
    expect(getPage(db, 'page-1', PROJECT)).toMatchObject({ status: 'removed', pinned: false })
    expect(pinnedAt(db, 'page-1')).toBeNull()
    expect(getPage(db, 'page-2', PROJECT)?.pinned).toBe(true)
    expect(pinnedAt(db, 'page-2')).toBe('2026-10-19T12:00:01.000Z')
  })

  test('fills an empty title and leaves a stored title alone', () => {
    const db = projectDb()
    insertPage(db, samplePage({ title: null }))
    expect(setPageTitleIfEmpty(db, 'page-1', 'From the page', PROJECT).title).toBe('From the page')
    expect(setPageTitleIfEmpty(db, 'page-1', 'Later title', PROJECT).title).toBe('From the page')
  })

  test('rejects a duplicate URL, a bad count, a missing market, and a secret URL', () => {
    const db = projectDb()
    insertPage(db, samplePage())
    expect(() => insertPage(db, samplePage({ id: 'page-2' }))).toThrow(/already exists/)
    expect(() =>
      insertPage(
        db,
        samplePage({
          id: 'page-3',
          url: 'https://example.com/other',
          promptCount: MAX_PROMPT_COUNT + 1
        })
      )
    ).toThrow(StorageError)
    try {
      insertPage(
        db,
        samplePage({
          id: 'page-3',
          url: 'https://example.com/other',
          promptCount: MAX_PROMPT_COUNT + 1
        })
      )
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError)
      expect((error as StorageError).message).toBe(
        `The maximum prompt count is ${MAX_PROMPT_COUNT}.`
      )
    }
    insertPage(
      db,
      samplePage({ id: 'page-max', url: 'https://example.com/max', promptCount: MAX_PROMPT_COUNT })
    )
    expect(getPage(db, 'page-max', PROJECT)?.promptCount).toBe(MAX_PROMPT_COUNT)
    expect(() =>
      insertPage(db, samplePage({ id: 'page-4', url: 'https://example.com/four', promptCount: 0 }))
    ).toThrow(/prompt count/)
    expect(() =>
      insertPage(db, samplePage({ id: 'page-5', url: 'https://user:secret@example.com/x' }))
    ).toThrow(StorageError)
    expect(() =>
      insertPage(
        db,
        samplePage({ id: 'page-6', url: 'https://example.com/?api_key=sk-ant-api03-abcdefghij' })
      )
    ).toThrow(/secret/)
    expect(() =>
      addPageMarket(db, {
        pageId: 'page-1',
        marketId: 'mkt-missing',
        addedAt: '2026-10-19T12:00:00.000Z',
        baselineRunId: null
      })
    ).toThrow(/market/)
  })

  test('lets a profile rewrite replace markets without deleting page links', () => {
    const db = projectDb()
    insertPage(db, samplePage())
    addPageMarket(db, {
      pageId: 'page-1',
      marketId: 'mkt-us',
      addedAt: '2026-10-19T12:00:00.000Z',
      baselineRunId: null
    })
    writeProjectProfile(db, {
      includeSubdomains: false,
      brandNames: ['TextBolt'],
      competitors: [],
      market: {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    })
    expect(listPageMarkets(db, 'page-1')).toHaveLength(1)
    expect(getMarket(db, 'mkt-mx')).toBeNull()
  })

  test('upgrades a version-1 project file and keeps the market row', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, [PROJECT_MIGRATIONS[0]!])
    db.prepare(
      `INSERT INTO markets (
         id, country, language, location, device, local_wording, serpapi_location, is_default
       ) VALUES ('mkt-us', 'US', 'en', NULL, 'desktop', 0, NULL, 1)`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(tableNames(db)).toContain('pages')
    expect(tableNames(db)).toContain('prompt_sets')
    expect(tableNames(db)).not.toContain('api_keys')
    const market = db.prepare<unknown[], { id: string }>('SELECT id FROM markets').get()
    expect(market?.id).toBe('mkt-us')
    const versions = db
      .prepare<unknown[], { version: number }>(
        'SELECT version FROM schema_migrations ORDER BY version'
      )
      .all()
      .map((row) => row.version)
    expect(versions).toEqual(PROJECT_MIGRATIONS.map((item) => item.version))
    expect(tableNames(db)).toContain('analyses')
    const marketColumns = db
      .prepare<unknown[], { name: string }>('PRAGMA table_info(page_markets)')
      .all()
      .map((row) => row.name)
    expect(marketColumns).toContain('last_checked_at')
    expect(marketColumns).toContain('first_check_not_before')
    expect(tableNames(db)).toContain('project_schedule')
    expect(tableNames(db)).toContain('fixes')
    expect(tableNames(db)).toContain('fix_prompts')
    const scheduleColumns = db
      .prepare<unknown[], { name: string }>('PRAGMA table_info(project_schedule)')
      .all()
      .map((row) => row.name)
    expect(scheduleColumns).toEqual(expect.arrayContaining(['cap', 'cap_rule', 'dedicated_key_id']))
  })

  test('keeps last_checked_at null when an older page market is upgraded', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 6))
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    db.prepare(
      `INSERT INTO markets (
         id, country, language, location, device, local_wording, serpapi_location, is_default
       ) VALUES ('mkt-us', 'US', 'en', NULL, 'desktop', 0, NULL, 1)`
    ).run()
    db.prepare(
      `INSERT INTO page_markets (page_id, market_id, added_at, baseline_run_id)
       VALUES ('page-1', 'mkt-us', '2026-04-01T00:00:00.000Z', NULL)`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(getPageMarketLastCheckedAt(db, 'page-1', 'mkt-us')).toBeNull()
  })

  test('backfills the newest prompt set as the only active set', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 4))
    const hash = 'a'.repeat(64)
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'setting_up', 14, 1, 10)`
    ).run()
    db.prepare(
      `INSERT INTO snapshots (
         id, page_id, fetched_at, method, duration_ms, outline_json, faqs_json,
         h2_count, h3_count, table_count, body_text, word_count, content_hash
       ) VALUES (
         'snap-1', 'page-1', '2026-10-19T12:00:00.000Z', 'file', 0, '[]', '[]',
         0, 0, 0, 'Body', 1, ?
       )`
    ).run(hash)
    db.prepare(
      `INSERT INTO buyer_profiles (
         id, page_id, snapshot_id, body_json, template_id, template_name, template_hash, created_at
       ) VALUES (
         'icp-1', 'page-1', 'snap-1', '{}', 'tpl', 'CiteFox default', ?, '2026-10-19T12:00:00.000Z'
       )`
    ).run(hash)
    const insertSet = db.prepare(
      `INSERT INTO prompt_sets (
         id, page_id, version, saved_at, icp_id, template_id, template_name, template_hash
       ) VALUES (?, 'page-1', ?, ?, 'icp-1', 'tpl', 'CiteFox default', ?)`
    )
    insertSet.run('pset-1', 1, '2026-10-19T12:00:00.000Z', hash)
    insertSet.run('pset-2', 2, '2026-10-19T13:00:00.000Z', hash)
    migrate(db, PROJECT_MIGRATIONS)
    const rows = db
      .prepare<unknown[], { id: string; is_active: number }>(
        'SELECT id, is_active FROM prompt_sets ORDER BY version'
      )
      .all()
    expect(rows).toEqual([
      { id: 'pset-1', is_active: 0 },
      { id: 'pset-2', is_active: 1 }
    ])
  })

  test('keeps page tables out of the app database', () => {
    const app = track(openAppDatabase(':memory:'))
    expect(tableNames(app)).toContain('templates')
    expect(tableNames(app)).not.toContain('pages')
    expect(tableNames(app)).not.toContain('snapshots')
    expect(tableNames(app)).not.toContain('fixes')
    expect(tableNames(app)).not.toContain('project_schedule')
  })

  test('stores and clears a first-check hold, and lists markets due as of a time', () => {
    const db = projectDb()
    insertPage(db, samplePage({ status: 'tracked' }))
    insertPage(
      db,
      samplePage({ id: 'page-2', url: 'https://textbolt.com/pricing', status: 'tracked' })
    )
    addPageMarket(db, {
      pageId: 'page-1',
      marketId: 'mkt-us',
      addedAt: '2026-04-01T00:00:00.000Z',
      baselineRunId: null
    })
    addPageMarket(db, {
      pageId: 'page-1',
      marketId: 'mkt-mx',
      addedAt: '2026-04-01T00:00:00.000Z',
      baselineRunId: null
    })
    addPageMarket(db, {
      pageId: 'page-2',
      marketId: 'mkt-us',
      addedAt: '2026-04-01T00:00:00.000Z',
      baselineRunId: null
    })
    expect(getPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-us')).toBeNull()

    setPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-mx', '2026-04-08T00:00:00.000Z')
    setPageMarketFirstCheckNotBefore(db, 'page-2', 'mkt-us', '2026-04-02T00:00:00Z')
    setPageMarketLastCheckedAt(db, 'page-1', 'mkt-us', '2026-04-03T08:00:00.000Z')

    expect(getPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-mx')).toBe(
      '2026-04-08T00:00:00.000Z'
    )
    expect(listPageMarketsFirstCheckDue(db, '2026-04-02T00:00:00.000Z')).toEqual([
      { pageId: 'page-2', marketId: 'mkt-us', firstCheckNotBefore: '2026-04-02T00:00:00Z' }
    ])
    expect(listPageMarketsFirstCheckDue(db, '2026-04-08T00:00:00.000Z')).toEqual([
      { pageId: 'page-2', marketId: 'mkt-us', firstCheckNotBefore: '2026-04-02T00:00:00Z' },
      { pageId: 'page-1', marketId: 'mkt-mx', firstCheckNotBefore: '2026-04-08T00:00:00.000Z' }
    ])

    setPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-mx', null)
    expect(getPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-mx')).toBeNull()
    expect(listPageMarketsFirstCheckDue(db, '2026-04-01T00:00:00.000Z')).toEqual([
      { pageId: 'page-1', marketId: 'mkt-mx', firstCheckNotBefore: null }
    ])
    expect(listPageMarketsFirstCheckDue(db, '2026-04-08T00:00:00.000Z')).toEqual([
      { pageId: 'page-1', marketId: 'mkt-mx', firstCheckNotBefore: null },
      { pageId: 'page-2', marketId: 'mkt-us', firstCheckNotBefore: '2026-04-02T00:00:00Z' }
    ])
    expect(() => getPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-no')).toThrow(
      /Unknown page market/
    )
    expect(() => setPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-no', null)).toThrow(
      /Unknown page market/
    )
    expect(() => setPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-mx', '2026-04-08')).toThrow(
      /timestamp/
    )
    expect(getPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-mx')).toBeNull()
  })

  test('keeps first_check_not_before null when an older page market is upgraded', () => {
    const db = track(openSqliteDatabase(':memory:'))
    migrate(db, PROJECT_MIGRATIONS.slice(0, 8))
    db.prepare(
      `INSERT INTO pages (id, url, status, interval_days, samples, prompt_count)
       VALUES ('page-1', 'https://textbolt.com/a', 'tracked', 14, 1, 10)`
    ).run()
    db.prepare(
      `INSERT INTO markets (
         id, country, language, location, device, local_wording, serpapi_location, is_default
       ) VALUES ('mkt-us', 'US', 'en', NULL, 'desktop', 0, NULL, 1)`
    ).run()
    db.prepare(
      `INSERT INTO page_markets (page_id, market_id, added_at, baseline_run_id, last_checked_at)
       VALUES ('page-1', 'mkt-us', '2026-04-01T00:00:00.000Z', NULL, '2026-04-06T08:00:00.000Z')`
    ).run()
    migrate(db, PROJECT_MIGRATIONS)
    expect(getPageMarketLastCheckedAt(db, 'page-1', 'mkt-us')).toBe('2026-04-06T08:00:00.000Z')
    expect(getPageMarketFirstCheckNotBefore(db, 'page-1', 'mkt-us')).toBeNull()
    const names = db
      .prepare<unknown[], { name: string }>('SELECT name FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => row.name)
    expect(names).toContain('009_page_market_first_check')
  })
})

function projectDb(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  ensureProjectSchema(db)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt', 'Text Bolt'],
    competitors: ['SimpleTexting', 'Twilio'],
    market: {
      id: 'mkt-us',
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertMarket(db, {
    id: 'mkt-mx',
    country: 'MX',
    language: 'es',
    location: 'Mexico City',
    device: 'desktop',
    localWording: true,
    serpapiLocation: null
  })
  return db
}

function samplePage(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    title: null,
    label: null,
    folder: null,
    status: 'not_tracked',
    setupStep: 'read',
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null,
    ...overrides
  }
}

function pinnedAt(db: SqliteDatabase, id: string): string | null {
  const row = db
    .prepare<unknown[], { pinned_at: string | null }>(`SELECT pinned_at FROM pages WHERE id = ?`)
    .get(id)
  return row?.pinned_at ?? null
}

function track(db: SqliteDatabase): SqliteDatabase {
  databases.push(db)
  return db
}

const PROJECT = 'proj-1'

function pageColumns(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { name: string }>('PRAGMA table_info(pages)')
    .all()
    .map((row) => row.name)
}

function tableNames(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
}
