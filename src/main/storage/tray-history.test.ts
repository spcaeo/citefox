import { afterEach, describe, expect, test } from 'vitest'
import { TRAY_MENU_CHECK_LIMIT } from '@shared/domain'
import { openAppDatabase } from './app-database'
import { closeDatabase, type SqliteDatabase } from './database'
import { insertProject, type ProjectRecord } from './records'
import { projectDatabaseRelativePath } from './slug'
import { appendTrayCheck, listRecentTrayChecks, type TrayCheckRecord } from './tray-history'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('tray history', () => {
  test('appends finished checks and lists the latest menu window without deleting the rest', () => {
    const db = memory()
    insertProject(db, project())
    expect(TRAY_MENU_CHECK_LIMIT).toBe(5)
    const checks: TrayCheckRecord[] = []
    for (let index = 0; index < 6; index += 1) {
      const check: TrayCheckRecord = {
        id: `check-${index}`,
        projectId: 'project-1',
        pageId: 'page-1',
        label: index === 0 ? 'Text alerts' : `Page ${index}`,
        score: index === 5 ? null : 40 + index,
        change: index === 0 ? null : index - 3,
        finishedAt: `2026-04-0${index + 1}T08:00:00.000Z`
      }
      checks.push(check)
      appendTrayCheck(db, check)
    }
    const recent = listRecentTrayChecks(db)
    expect(recent).toHaveLength(5)
    expect(recent[0]).toMatchObject({
      label: 'Page 5',
      score: null,
      finishedAt: '2026-04-06T08:00:00.000Z'
    })
    expect(recent.map((row) => row.label)).toEqual([
      'Page 5',
      'Page 4',
      'Page 3',
      'Page 2',
      'Page 1'
    ])
    expect(listRecentTrayChecks(db, 6)).toHaveLength(6)
    expect(listRecentTrayChecks(db, 6)[5]).toMatchObject({
      label: 'Text alerts',
      score: 40,
      change: null
    })
    expect(() => appendTrayCheck(db, checks[0]!)).toThrow(/already exists/)
    expect(() =>
      appendTrayCheck(db, { ...checks[1]!, id: 'check-x', projectId: 'missing' })
    ).toThrow(/missing/)
    expect(() => appendTrayCheck(db, { ...checks[1]!, id: 'check-y', score: 101 })).toThrow(/score/)
  })
})

function memory(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

function project(): ProjectRecord {
  return {
    id: 'project-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  }
}
