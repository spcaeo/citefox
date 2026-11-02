import { isClaudeCheckupRowState } from '@shared/ipc'
import type { ClaudeCheckupResult, ClaudeCheckupRow } from '@shared/ipc'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  assertId,
  isOneOf,
  rejectSecret,
  requireBoolean,
  requireInteger,
  requireLabel,
  requireUtcTimestamp,
  runWrite
} from './record-values'

/** `claude_checkups` rows in app.sqlite. */

/** One Run checkup. `result` is the IPC checkup payload. The latest row is current. */
export interface ClaudeCheckupRecord {
  id: string
  ranAt: string
  binaryOk: boolean
  loginOk: boolean
  roundTripOk: boolean
  result: ClaudeCheckupResult
}

export function insertClaudeCheckup(
  db: SqliteDatabase,
  record: { id: string; ranAt: string; result: ClaudeCheckupResult }
): void {
  const id = assertId(record.id)
  const ranAt = requireUtcTimestamp(record.ranAt)
  const result = requireCheckupResult(record.result)
  const flags = checkupFlags(result)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO claude_checkups (id, ran_at, binary_ok, login_ok, roundtrip_ok, detail_json)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, ranAt, flags.binaryOk, flags.loginOk, flags.roundTripOk, JSON.stringify(result)),
    'Could not save checkup'
  )
}

export function getClaudeCheckup(db: SqliteDatabase, id: string): ClaudeCheckupRecord | null {
  assertId(id)
  const row = db
    .prepare<unknown[], CheckupSql>(
      `SELECT id, ran_at, binary_ok, login_ok, roundtrip_ok, detail_json
       FROM claude_checkups WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : checkupFromSql(row)
}

/** Latest by `ran_at`, then row id, so two checks in the same millisecond stay ordered. */
export function getLatestClaudeCheckup(db: SqliteDatabase): ClaudeCheckupRecord | null {
  const row = db
    .prepare<unknown[], CheckupSql>(
      `SELECT id, ran_at, binary_ok, login_ok, roundtrip_ok, detail_json
       FROM claude_checkups ORDER BY ran_at DESC, rowid DESC LIMIT 1`
    )
    .get()
  return row === undefined ? null : checkupFromSql(row)
}

interface CheckupSql {
  id: string
  ran_at: string
  binary_ok: number
  login_ok: number
  roundtrip_ok: number
  detail_json: string
}

function checkupFromSql(row: CheckupSql): ClaudeCheckupRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.detail_json) as unknown
  } catch {
    throw new StorageError('Invalid checkup detail')
  }
  const result = requireCheckupResult(parsed)
  const flags = checkupFlags(result)
  if (
    row.binary_ok !== flags.binaryOk ||
    row.login_ok !== flags.loginOk ||
    row.roundtrip_ok !== flags.roundTripOk
  ) {
    throw new StorageError('Invalid checkup detail')
  }
  return {
    id: row.id,
    ranAt: row.ran_at,
    binaryOk: flags.binaryOk === 1,
    loginOk: flags.loginOk === 1,
    roundTripOk: flags.roundTripOk === 1,
    result
  }
}

function checkupFlags(result: ClaudeCheckupResult): {
  binaryOk: number
  loginOk: number
  roundTripOk: number
} {
  return {
    binaryOk: result.rows.binary.state === 'ok' ? 1 : 0,
    loginOk: result.login === 'logged_in' && result.rows.login.state === 'ok' ? 1 : 0,
    roundTripOk: result.roundTrip === 'ok' ? 1 : 0
  }
}

const CHECKUP_LOGINS = ['logged_in', 'logged_out', 'api_key', 'skipped'] as const
const CHECKUP_ROUND_TRIPS = ['ok', 'failed', 'skipped'] as const

function requireCheckupResult(value: unknown): ClaudeCheckupResult {
  if (!isPlainRecord(value)) throw new StorageError('Invalid checkup detail')
  if (!isPlainRecord(value.rows)) throw new StorageError('Invalid checkup detail')
  const result: ClaudeCheckupResult = {
    // Absent on rows saved before Codex was an option: those were Claude Code.
    ...(value.provider === 'codex' ? { provider: 'codex' as const } : {}),
    binaryPath: requireNullableText(value.binaryPath, 'checkup binary path', 1024),
    version: requireNullableText(value.version, 'checkup version', 80),
    login: requireEnum(value.login, CHECKUP_LOGINS, 'checkup login'),
    plan: requireNullableText(value.plan, 'checkup plan', 80),
    roundTrip: requireEnum(value.roundTrip, CHECKUP_ROUND_TRIPS, 'checkup round trip'),
    durationMs: requireNullableInteger(value.durationMs, 'checkup duration', 0, 3_600_000),
    resolvedModel: requireResolvedModel(value.resolvedModel),
    ready: requireBoolean(value.ready, 'checkup ready'),
    message: requireText(value.message, 'checkup message', 500),
    nextStep: requireNullableText(value.nextStep, 'checkup next step', 500),
    rows: {
      binary: requireCheckupRow(value.rows.binary),
      login: requireCheckupRow(value.rows.login),
      roundTrip: requireCheckupRow(value.rows.roundTrip)
    }
  }
  const ready =
    result.rows.binary.state === 'ok' &&
    result.rows.login.state === 'ok' &&
    result.rows.roundTrip.state === 'ok'
  if (result.ready !== ready) throw new StorageError('Invalid checkup detail')
  const encoded = JSON.stringify(result)
  if (encoded.length > 100_000) throw new StorageError('Invalid checkup detail')
  rejectSecret(encoded, 'checkup detail', true)
  return result
}

function requireResolvedModel(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return requireText(value, 'checkup resolved model', 200)
}

function requireCheckupRow(value: unknown): ClaudeCheckupRow {
  if (!isPlainRecord(value)) throw new StorageError('Invalid checkup detail')
  if (typeof value.state !== 'string' || !isClaudeCheckupRowState(value.state)) {
    throw new StorageError('Invalid checkup detail')
  }
  return {
    state: value.state,
    statusLabel: requireText(value.statusLabel, 'checkup status', 80),
    detail: requireText(value.detail, 'checkup row detail', 500),
    nextStep: requireNullableText(value.nextStep, 'checkup row next step', 500)
  }
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new StorageError(`Invalid ${label}`)
  return requireLabel(value, label, max)
}

function requireNullableText(value: unknown, label: string, max: number): string | null {
  if (value === null) return null
  return requireText(value, label, max)
}

function requireNullableInteger(
  value: unknown,
  label: string,
  min: number,
  max: number
): number | null {
  if (value === null) return null
  if (typeof value !== 'number') throw new StorageError(`Invalid ${label}`)
  return requireInteger(value, label, min, max)
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !isOneOf(allowed, value)) {
    throw new StorageError(`Invalid ${label}`)
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
