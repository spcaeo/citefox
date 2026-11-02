import { afterEach, describe, expect, test } from 'vitest'
import { openSqliteDatabase, type SqliteDatabase } from './database'
import { StorageError } from './errors'
import { migrate } from './migrate'
import { applied, closeTracked, column, tableNames, track } from './migrate.test-helper'
import { PROJECT_MIGRATIONS } from './project-schema'
import { TOPIC_FOLDERS_VERSION } from './project-schema-topic-folders'
import {
  deleteTopicFolder,
  insertTopicFolder,
  listTopicFolders,
  moveTopicsToFolder,
  renameTopicFolder
} from './topic-folders'

/** Project database upgrade 050: topic folders. */

afterEach(() => {
  closeTracked()
})

const NOW = '2026-10-29T12:00:00.000Z'
const LATER = '2026-10-29T12:05:00.000Z'

function addTopic(db: SqliteDatabase, id: string): void {
  db.prepare(
    `INSERT INTO pages (id, url, title, label, folder, status, interval_days, samples,
       prompt_count, kind)
     VALUES (?, NULL, ?, ?, NULL, 'tracked', 14, 1, 1, 'topic')`
  ).run(id, id, id)
  db.prepare(
    `INSERT INTO topics (page_id, seed, source, created_at, updated_at)
     VALUES (?, ?, 'seed', ?, ?)`
  ).run(id, id, NOW, NOW)
}

function upTo(version: number): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(
    db,
    PROJECT_MIGRATIONS.filter((item) => item.version < version)
  )
  return db
}

function fresh(): SqliteDatabase {
  const db = track(openSqliteDatabase(':memory:'))
  migrate(db, PROJECT_MIGRATIONS)
  addTopic(db, 'topic-1')
  addTopic(db, 'topic-2')
  addTopic(db, 'topic-3')
  return db
}

describe('project migration 050', () => {
  test('adds folders to an existing project, where every topic starts in No folder', () => {
    const db = upTo(TOPIC_FOLDERS_VERSION)
    addTopic(db, 'topic-1')
    expect(tableNames(db)).not.toContain('topic_folders')
    migrate(db, PROJECT_MIGRATIONS)
    expect(applied(db)).toContainEqual({ version: 50, name: '050_topic_folders' })
    expect(tableNames(db)).toContain('topic_folders')
    expect(column(db, 'topics', 'folder_id')).toMatchObject({ notnull: 0, dflt_value: null })
    expect(listTopicFolders(db)).toEqual({ folders: [], placement: {} })
  })

  test('the database refuses an empty name, a case-insensitive repeat and an unknown folder', () => {
    const db = fresh()
    expect(() => db.prepare(`INSERT INTO topic_folders VALUES ('f0', '', ?)`).run(NOW)).toThrow()
    db.prepare(`INSERT INTO topic_folders VALUES ('f1', 'Carrier shutdowns', ?)`).run(NOW)
    expect(() =>
      db.prepare(`INSERT INTO topic_folders VALUES ('f2', 'carrier SHUTDOWNS', ?)`).run(NOW)
    ).toThrow()
    expect(() =>
      db.prepare(`UPDATE topics SET folder_id = 'nope' WHERE page_id = 'topic-1'`).run()
    ).toThrow()
  })
})

describe('topic folder storage', () => {
  test('creates, renames and moves topics in and out of folders', () => {
    const db = fresh()
    insertTopicFolder(db, { id: 'f1', name: '  Carrier   shutdowns ', createdAt: NOW })
    insertTopicFolder(db, { id: 'f2', name: 'Monitoring tools', createdAt: LATER })
    moveTopicsToFolder(db, ['topic-1', 'topic-2'], 'f1')
    moveTopicsToFolder(db, ['topic-3'], 'f2')
    renameTopicFolder(db, 'f2', 'Monitoring')
    expect(listTopicFolders(db)).toEqual({
      folders: [
        { id: 'f1', name: 'Carrier shutdowns', createdAt: NOW },
        { id: 'f2', name: 'Monitoring', createdAt: LATER }
      ],
      placement: { 'topic-1': 'f1', 'topic-2': 'f1', 'topic-3': 'f2' }
    })
    moveTopicsToFolder(db, ['topic-2'], null)
    expect(listTopicFolders(db).placement).toEqual({ 'topic-1': 'f1', 'topic-3': 'f2' })
  })

  test('deleting a folder sends its topics back to No folder', () => {
    const db = fresh()
    insertTopicFolder(db, { id: 'f1', name: 'Compliance', createdAt: NOW })
    moveTopicsToFolder(db, ['topic-1', 'topic-3'], 'f1')
    deleteTopicFolder(db, 'f1')
    expect(listTopicFolders(db)).toEqual({ folders: [], placement: {} })
    expect(() => deleteTopicFolder(db, 'f1')).toThrow(StorageError)
  })

  test('refuses a repeated name, a long name, an unknown folder or topic', () => {
    const db = fresh()
    insertTopicFolder(db, { id: 'f1', name: 'Pricing', createdAt: NOW })
    insertTopicFolder(db, { id: 'f2', name: 'Industries', createdAt: NOW })
    expect(() => insertTopicFolder(db, { id: 'f3', name: 'pricing', createdAt: NOW })).toThrow(
      'A folder called "pricing" already exists.'
    )
    expect(() => renameTopicFolder(db, 'f2', 'PRICING')).toThrow(StorageError)
    // Renaming a folder to its own name in other letters is fine.
    renameTopicFolder(db, 'f1', 'PRICING')
    expect(() => insertTopicFolder(db, { id: 'f4', name: 'x'.repeat(81), createdAt: NOW })).toThrow(
      'A folder name is 1 to 80 characters.'
    )
    expect(() => moveTopicsToFolder(db, ['topic-1'], 'nope')).toThrow('That folder was not found.')
    expect(() => moveTopicsToFolder(db, ['topic-1', 'ghost'], 'f1')).toThrow(
      'That topic was not found.'
    )
    // The move is all or nothing.
    expect(listTopicFolders(db).placement).toEqual({})
    expect(() => renameTopicFolder(db, 'ghost', 'Ghost')).toThrow('That folder was not found.')
  })
})
