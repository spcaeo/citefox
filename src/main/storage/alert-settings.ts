import { containsSecret } from '../logging/redact'
import { assertKeychainRef } from '../secrets/secret-store'
import type { SqliteDatabase } from './database'
import { isSqliteError } from './database'
import { StorageError } from './errors'
import { assertId, readJson, requireLabel } from './values'

/**
 * FR-23.13 and section 9.2. One row in the project database.
 * `projectId` is not a column. The file is already one project, and the caller
 * stamps it, the same way `readProjectSchedule` does. A missing row is all off,
 * matching the email engine's `defaultAlertSettings`, and is not inserted.
 * `emailAccountId` points at app.sqlite `email_accounts` and has no foreign key.
 * `slackKeychainRef` is a keychain id. The webhook URL is never stored (NFR-5).
 */
export interface StoredAlertSettings {
  projectId: string
  desktop: boolean
  emailAfterCheck: boolean
  emailAccountId: string | null
  emailTo: readonly string[]
  slackEnabled: boolean
  slackKeychainRef: string | null
  monthlyClientPdf: boolean
}

const EMAIL = /^[^\s@]+@[^\s@]+$/

export function getAlertSettings(db: SqliteDatabase, projectId: string): StoredAlertSettings {
  const id = requireProjectId(projectId)
  const row = db
    .prepare<unknown[], AlertSql>(
      `SELECT desktop, email_after_check, email_account_id, email_to, slack_enabled,
              slack_keychain_ref, monthly_client_pdf
       FROM alert_settings WHERE id = 1`
    )
    .get()
  if (row === undefined) return defaults(id)
  return settingsFromSql(id, row)
}

export function saveAlertSettings(db: SqliteDatabase, settings: StoredAlertSettings): void {
  const row = normalize(settings)
  runWrite('Could not save alert settings', () => {
    db.prepare(
      `INSERT INTO alert_settings (
         id, desktop, email_after_check, email_account_id, email_to,
         slack_enabled, slack_keychain_ref, monthly_client_pdf
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         desktop = excluded.desktop,
         email_after_check = excluded.email_after_check,
         email_account_id = excluded.email_account_id,
         email_to = excluded.email_to,
         slack_enabled = excluded.slack_enabled,
         slack_keychain_ref = excluded.slack_keychain_ref,
         monthly_client_pdf = excluded.monthly_client_pdf`
    ).run(
      row.desktop ? 1 : 0,
      row.emailAfterCheck ? 1 : 0,
      row.emailAccountId,
      JSON.stringify(row.emailTo),
      row.slackEnabled ? 1 : 0,
      row.slackKeychainRef,
      row.monthlyClientPdf ? 1 : 0
    )
  })
}

interface AlertSql {
  desktop: number
  email_after_check: number
  email_account_id: string | null
  email_to: string
  slack_enabled: number
  slack_keychain_ref: string | null
  monthly_client_pdf: number
}

function defaults(projectId: string): StoredAlertSettings {
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

function settingsFromSql(projectId: string, row: AlertSql): StoredAlertSettings {
  return {
    projectId,
    desktop: flag(row.desktop, 'desktop'),
    emailAfterCheck: flag(row.email_after_check, 'email after check'),
    emailAccountId:
      row.email_account_id === null
        ? null
        : requireKeychainRef(row.email_account_id, 'email account'),
    emailTo: readEmails(row.email_to),
    slackEnabled: flag(row.slack_enabled, 'slack'),
    slackKeychainRef:
      row.slack_keychain_ref === null
        ? null
        : requireKeychainRef(row.slack_keychain_ref, 'slack keychain ref'),
    monthlyClientPdf: flag(row.monthly_client_pdf, 'monthly client pdf')
  }
}

function normalize(settings: StoredAlertSettings): StoredAlertSettings {
  return {
    projectId: requireProjectId(settings.projectId),
    desktop: requireBoolean(settings.desktop, 'desktop'),
    emailAfterCheck: requireBoolean(settings.emailAfterCheck, 'email after check'),
    emailAccountId: requireOptionalRef(settings.emailAccountId, 'email account'),
    emailTo: requireEmails(settings.emailTo),
    slackEnabled: requireBoolean(settings.slackEnabled, 'slack'),
    slackKeychainRef: requireOptionalRef(settings.slackKeychainRef, 'slack keychain ref'),
    monthlyClientPdf: requireBoolean(settings.monthlyClientPdf, 'monthly client pdf')
  }
}

function requireProjectId(value: string): string {
  const id = assertId(value)
  if (containsSecret(id)) throw new StorageError('project id cannot contain a secret')
  return id
}

/** Same rejection as `email_accounts.keychain_ref` (NFR-5): secrets and URLs. */
function requireKeychainRef(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new StorageError(`Invalid ${label}`)
  if (containsSecret(value)) throw new StorageError(`${label} cannot contain a secret`)
  try {
    assertKeychainRef(value)
  } catch {
    throw new StorageError(`Invalid ${label}`)
  }
  return value
}

function requireOptionalRef(value: string | null, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new StorageError(`Invalid ${label}`)
  return requireKeychainRef(value, label)
}

function requireEmails(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new StorageError('Invalid email to')
  return values.map((item) => requireEmail(item))
}

function readEmails(encoded: string): string[] {
  const parsed = readJson(encoded, 'email to')
  if (!Array.isArray(parsed)) throw new StorageError('Invalid email to')
  return parsed.map((item) => requireEmail(item))
}

function requireEmail(value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('Invalid email to')
  const email = requireLabel(value, 'email to', 320)
  if (!EMAIL.test(email)) throw new StorageError('Invalid email to')
  return email
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new StorageError(`Invalid ${label}`)
  return value
}

function flag(value: number, label: string): boolean {
  if (value === 1) return true
  if (value === 0) return false
  throw new StorageError(`Invalid ${label}`)
}

function runWrite(action: string, write: () => void): void {
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    if (isSqliteError(error) && error.code.startsWith('SQLITE_CONSTRAINT')) {
      throw new StorageError(`${action}: rejected by the database`)
    }
    throw new StorageError(`${action} failed`)
  }
}
