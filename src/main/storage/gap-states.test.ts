import type { PageSummary } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { listGapStates, writeGapState } from './gap-states'
import { migrate } from './migrate'
import { insertPage } from './pages'
import { ensureProjectSchema, writeProjectProfile } from './project-profile'
import { PROJECT_MIGRATIONS } from './project-schema'
import { GAP_STATES_VERSION } from './project-schema-gap-states'

const databases: SqliteDatabase[] = []
const AT = '2026-10-19T12:00:00.000Z'
const LATER = '2026-10-20T09:30:00.000Z'

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('gap_states (migration 041)', () => {
  test('migrates an older project database and adds the table', () => {
    const db = openSqliteDatabase(':memory:')
    databases.push(db)
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((migration) => migration.version < GAP_STATES_VERSION)
    )
    expect(tableExists(db)).toBe(false)
    migrate(db, PROJECT_MIGRATIONS)
    expect(tableExists(db)).toBe(true)
    expect(PROJECT_MIGRATIONS.at(-1)?.version).toBeGreaterThanOrEqual(GAP_STATES_VERSION)
  })

  test('writes a draft, a status and a URL per prompt, and drops an empty row', () => {
    const db = projectDb()
    const draft = writeGapState(
      db,
      'page-1',
      'prompt-1',
      { faq: { question: 'Can staff reply?', answer: 'Yes, replies come back by email.' } },
      AT
    )
    expect(draft).toEqual({
      promptId: 'prompt-1',
      status: null,
      publishedUrl: null,
      faq: {
        question: 'Can staff reply?',
        answer: 'Yes, replies come back by email.',
        wordCount: 6
      },
      updatedAt: AT
    })
    const published = writeGapState(
      db,
      'page-1',
      'prompt-1',
      { status: 'published', publishedUrl: 'https://textbolt.com/alerts#faq' },
      LATER
    )
    // The draft stays when only the status changes.
    expect(published?.faq?.question).toBe('Can staff reply?')
    expect(published).toMatchObject({ status: 'published', updatedAt: LATER })
    writeGapState(db, 'page-1', 'prompt-2', { status: 'verified' }, AT)
    expect(listGapStates(db, 'page-1').map((state) => state.promptId)).toEqual([
      'prompt-1',
      'prompt-2'
    ])
    expect(writeGapState(db, 'page-1', 'prompt-2', { status: null }, LATER)).toBeNull()
    expect(listGapStates(db, 'page-1')).toHaveLength(1)
  })

  test('rejects a status the table does not know and a draft with an empty answer', () => {
    const db = projectDb()
    expect(() => writeGapState(db, 'page-1', 'prompt-1', { status: 'done' as never }, AT)).toThrow(
      'Unknown gap status'
    )
    expect(() =>
      writeGapState(db, 'page-1', 'prompt-1', { faq: { question: 'Q?', answer: '' } }, AT)
    ).toThrow('Invalid FAQ answer')
  })
})

function tableExists(db: SqliteDatabase): boolean {
  return (
    db
      .prepare<unknown[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gap_states'"
      )
      .get() !== undefined
  )
}

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
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
  insertPage(db, page())
  return db
}

function page(): PageSummary {
  return {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/alerts',
    title: null,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  }
}
