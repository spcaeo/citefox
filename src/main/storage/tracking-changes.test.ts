import type { BuyerPrompt } from '@shared/domain'
import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { saveEngineSettings } from './engine-records'
import { migrate } from './migrate'
import { insertPage } from './pages'
import { insertMarket, writeProjectProfile } from './project-profile'
import { readProjectSchedule, writeProjectSchedule } from './project-schedule'
import { PROJECT_MIGRATIONS } from './project-schema'
import { activatePromptSet, insertPromptSet } from './prompt-set-records'
import { listTrackingChanges, recordTrackingChange } from './tracking-changes'

/** Owner decision 1: changes to what a project tracks are recorded where they are saved. */

const databases: SqliteDatabase[] = []
const NOW = '2026-10-19T12:00:00.000Z'
const LATER = '2026-10-20T12:00:00.000Z'

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  migrate(db, PROJECT_MIGRATIONS)
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
  insertPage(db, {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/page-1',
    title: null,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: 'check',
    intervalDays: 14,
    samples: 1,
    promptCount: 3,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  return db
}

function question(id: string, position: number, text: string): BuyerPrompt {
  return {
    id,
    position,
    label: text,
    source: 'written_by_user',
    intentStage: 'problem',
    mappedElement: 'intro',
    enabled: true,
    variants: [{ marketId: 'mkt-us', language: 'en', text, originalText: null }]
  }
}

function saveSet(
  db: SqliteDatabase,
  id: string,
  version: number,
  texts: readonly string[],
  savedAt: string
): void {
  insertPromptSet(
    db,
    {
      id,
      pageId: 'page-1',
      version,
      savedAt,
      icpId: 'icp-1',
      templateId: null,
      templateName: null,
      templateHash: null,
      templateUpdatedAt: null,
      prompts: texts.map((text, index) => question(`${id}-q${index + 1}`, index + 1, text))
    },
    ['TextBolt']
  )
}

describe('tracking changes', () => {
  test('a page gaining and losing questions, engines, a market and a new schedule', () => {
    const db = projectDb()
    db.pragma('foreign_keys = OFF')
    saveSet(db, 'set-1', 1, ['Q one?', 'Q two?'], NOW)
    saveSet(db, 'set-2', 2, ['Q one?', 'Q three?', 'Q four?'], LATER)
    activatePromptSet(db, 'page-1', 'set-1', ['TextBolt'], LATER)
    saveEngineSettings(db, { engines: ['google_aio', 'chatgpt'] }, LATER)
    saveEngineSettings(db, { engines: ['chatgpt'] }, LATER)
    insertMarket(db, {
      id: 'mkt-uk',
      country: 'GB',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    })
    const schedule = readProjectSchedule(db, 'proj-1')
    writeProjectSchedule(db, schedule)
    writeProjectSchedule(db, { ...schedule, nextCheckAt: LATER })
    writeProjectSchedule(db, { ...schedule, defaultIntervalDays: 30 })

    const rows = listTrackingChanges(db).map((row) => [row.kind, row.count, row.detail])
    expect(rows).toEqual([
      ['questions_added', 2, null],
      ['questions_added', 2, null],
      ['questions_removed', 1, null],
      ['questions_added', 1, null],
      ['questions_removed', 2, null],
      ['engine_on', 1, 'ChatGPT'],
      ['engine_off', 1, 'Google AI Overview'],
      ['market_added', 1, 'GB · EN'],
      ['schedule_changed', 1, 'every 30 days']
    ])
    expect(listTrackingChanges(db)[0]).toMatchObject({ pageId: 'page-1', at: NOW })
  })

  test('a project file from before 057 records and lists nothing, and the save still works', () => {
    const db = openSqliteDatabase(':memory:')
    databases.push(db)
    migrate(
      db,
      PROJECT_MIGRATIONS.filter((migration) => migration.version < 57)
    )
    expect(() =>
      recordTrackingChange(db, { at: NOW, kind: 'engine_on', detail: 'ChatGPT' })
    ).not.toThrow()
    expect(listTrackingChanges(db)).toEqual([])
  })
})
