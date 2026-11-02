import { afterEach, describe, expect, test } from 'vitest'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import {
  addNotice,
  getNotice,
  listOpenNotices,
  resolveNoticesByKey,
  resolveStoredNotice,
  type NoticeInput
} from './notices'
import { deleteProject, insertProject } from './records'
import { projectDatabaseRelativePath } from './slug'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('notices (app migration 021)', () => {
  test('keeps one open notice per key, lists newest first, and allows a new one once answered', () => {
    const db = appDb()
    expect(addNotice(db, notice('n-1', '2026-10-19T12:00:00.000Z'))).toBe(true)
    expect(addNotice(db, notice('n-2', '2026-10-19T12:05:00.000Z'))).toBe(false)
    expect(
      addNotice(db, { ...notice('n-3', '2026-10-19T12:06:00.000Z'), dedupeKey: 'other' })
    ).toBe(true)
    expect(listOpenNotices(db).map((item) => item.id)).toEqual(['n-3', 'n-1'])
    expect(getNotice(db, 'n-1')).toMatchObject({
      kind: 'search_cap',
      projectId: 'proj-1',
      actions: [
        { id: 'allow_10_month', label: 'Continue', primary: true },
        { id: 'wait_reset', label: 'Wait', primary: false }
      ],
      data: { month: '2026-10' },
      resolvedAt: null
    })

    expect(resolveStoredNotice(db, 'n-1', 'wait_reset', '2026-10-19T13:00:00.000Z')).toBe(true)
    expect(resolveStoredNotice(db, 'n-1', 'wait_reset', '2026-10-19T13:00:00.000Z')).toBe(false)
    expect(getNotice(db, 'n-1')?.resolution).toBe('wait_reset')
    expect(addNotice(db, notice('n-4', '2026-10-19T14:00:00.000Z'))).toBe(true)
    expect(resolveNoticesByKey(db, 'cap:proj-1:2026-10', 'gone', '2026-10-19T15:00:00.000Z')).toBe(
      1
    )
    expect(listOpenNotices(db).map((item) => item.id)).toEqual(['n-3'])
  })

  test('redacts secrets, stores an unknown project as null, and is removed with its project', () => {
    const db = appDb()
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
    addNotice(db, { ...notice('n-1', '2026-10-19T12:00:00.000Z'), body: `Key ${secret} failed.` })
    addNotice(db, {
      ...notice('n-2', '2026-10-19T12:00:00.000Z'),
      dedupeKey: 'ghost',
      projectId: 'proj-gone'
    })
    expect(getNotice(db, 'n-1')?.body).not.toContain(secret)
    expect(getNotice(db, 'n-2')?.projectId).toBeNull()
    expect(() =>
      addNotice(db, { ...notice('n-3', '2026-10-19T12:00:00.000Z'), kind: 'Bad Kind' })
    ).toThrow()
    expect(() =>
      addNotice(db, { ...notice('n-3', '2026-10-19T12:00:00.000Z'), dedupeKey: 'x', actions: [] })
    ).toThrow()
    deleteProject(db, 'proj-1')
    expect(getNotice(db, 'n-1')).toBeNull()
  })
})

function appDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  insertProject(db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  return db
}

function notice(id: string, createdAt: string): NoticeInput {
  return {
    id,
    kind: 'search_cap',
    projectId: 'proj-1',
    dedupeKey: 'cap:proj-1:2026-10',
    title: 'TextBolt reached its search cap',
    body: '100 of 100 searches used.',
    actions: [
      { id: 'allow_10_month', label: 'Continue', primary: true },
      { id: 'wait_reset', label: 'Wait', primary: false }
    ],
    data: { month: '2026-10' },
    createdAt
  }
}
