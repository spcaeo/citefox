import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, openSqliteDatabase, type SqliteDatabase } from './database'
import { getAlertSettings, saveAlertSettings, type StoredAlertSettings } from './alert-settings'
import { ensureProjectSchema } from './project-profile'

const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

describe('alert settings', () => {
  test('a missing row is all off and is not inserted', () => {
    const db = projectDb()
    expect(getAlertSettings(db, 'project-1')).toEqual(off('project-1'))
    const count = db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM alert_settings`)
      .get()
    expect(count?.n).toBe(0)
  })

  test('round-trips an upsert and keeps SQL defaults off', () => {
    const db = projectDb()
    const saved: StoredAlertSettings = {
      projectId: 'project-1',
      desktop: true,
      emailAfterCheck: true,
      emailAccountId: 'acct-1',
      emailTo: ['client@example.com', 'owner@example.com'],
      slackEnabled: true,
      slackKeychainRef: 'citefox.slack.one',
      monthlyClientPdf: true
    }
    saveAlertSettings(db, saved)
    expect(getAlertSettings(db, 'project-1')).toEqual(saved)
    saveAlertSettings(db, { ...saved, desktop: false, emailTo: [], slackKeychainRef: null })
    expect(getAlertSettings(db, 'project-1')).toEqual({
      ...saved,
      desktop: false,
      emailTo: [],
      slackKeychainRef: null
    })
    const count = db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM alert_settings`)
      .get()
    expect(count?.n).toBe(1)

    const fresh = projectDb()
    fresh.prepare(`INSERT INTO alert_settings (id) VALUES (1)`).run()
    expect(getAlertSettings(fresh, 'project-1')).toEqual(off('project-1'))
  })

  test('rejects secrets and URLs on the slack ref and the email account id', () => {
    const db = projectDb()
    const slack = 'https://hooks.slack.com/services/T00/B00/secret'
    const anthropic = `sk-ant-${'abcdefghij1234'}`
    const url = 'https://example.com/hook'
    expect(() => saveAlertSettings(db, { ...off('project-1'), slackKeychainRef: slack })).toThrow(
      /secret/
    )
    expect(() => saveAlertSettings(db, { ...off('project-1'), emailAccountId: anthropic })).toThrow(
      /secret/
    )
    expect(() =>
      saveAlertSettings(db, { ...off('project-1'), slackKeychainRef: 'a'.repeat(64) })
    ).toThrow(/secret/)
    expect(() => saveAlertSettings(db, { ...off('project-1'), emailAccountId: url })).toThrow(
      /email account/
    )
    expect(() =>
      saveAlertSettings(db, { ...off('project-1'), slackKeychainRef: 'Not-A-Ref' })
    ).toThrow(/slack keychain ref/)
    expect(() => saveAlertSettings(db, { ...off('project-1'), emailTo: ['not-an-email'] })).toThrow(
      /email to/
    )
    const dumped = JSON.stringify(
      db.prepare(`SELECT slack_keychain_ref, email_account_id, email_to FROM alert_settings`).all()
    )
    expect(dumped).not.toContain('hooks.slack.com')
    expect(dumped).not.toContain('sk-ant')
    expect(dumped).not.toContain('example.com/hook')
  })
})

function off(projectId: string): StoredAlertSettings {
  return {
    projectId,
    desktop: false,
    emailAfterCheck: false,
    emailAccountId: null,
    emailTo: [],
    slackEnabled: false,
    slackKeychainRef: null,
    monthlyClientPdf: false
  }
}

function projectDb(): SqliteDatabase {
  const db = openSqliteDatabase(':memory:')
  databases.push(db)
  ensureProjectSchema(db)
  return db
}
