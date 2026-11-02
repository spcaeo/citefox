import { isApiKeyProvider, isConnectionState, KEY_TEST_REASONS } from '@shared/domain'
import type {
  ApiKeyMetadata,
  ApiKeyProvider,
  CloroCredits,
  ConnectionState,
  KeyTestReason,
  SerpApiUsage
} from '@shared/domain'
import { assertKeychainRef } from '../secrets/secret-store'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  assertId,
  ID,
  isOneOf,
  rejectSecret,
  requireBoolean,
  requireInteger,
  requireLabel,
  requireOptionalLabel,
  requireUtcTimestamp,
  runWrite
} from './record-values'

/** `api_keys`, `key_usage`, and `connection_events` rows in app.sqlite. */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const CONNECTION_EVENT_KINDS = ['rate_limited', 'failed', 'cap_reached', 'failover'] as const

export type ConnectionEventKind = (typeof CONNECTION_EVENT_KINDS)[number]

/** Stored `api_keys` row. Same shape as the IPC metadata, with no secret. */
export type ApiKeyRecord = ApiKeyMetadata

export interface KeyUsageRecord {
  id: string
  keyId: string
  /** Null when the searches are not tied to a project, such as a playground check. */
  projectId: string | null
  month: string
  searches: number
  calls: number
  tokens: number
  /** cloro credits charged. Absent or 0 for every other provider. */
  credits?: number
}

export interface ConnectionEventRecord {
  id: string
  keyId: string
  at: string
  kind: ConnectionEventKind
  detail: string | null
}

export function insertApiKey(db: SqliteDatabase, record: ApiKeyRecord): void {
  const row = normalizeApiKey(record)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO api_keys (
             id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
             serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan,
             cloro_remaining, cloro_per_cycle, cloro_resets_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.provider,
          row.name,
          row.keychainRef,
          row.rotationOrder,
          row.cap,
          row.on ? 1 : 0,
          JSON.stringify(row.projectIds),
          row.hint,
          row.state,
          row.serpapiUsage?.used ?? null,
          row.serpapiUsage?.planLimit ?? null,
          row.serpapiUsage?.plan ?? null,
          row.lastReason,
          row.plan,
          row.cloroCredits?.remaining ?? null,
          row.cloroCredits?.perCycle ?? null,
          row.cloroCredits?.resetsAt ?? null
        ),
    'Could not save api key'
  )
}

export function getApiKey(db: SqliteDatabase, id: string): ApiKeyRecord | null {
  assertId(id)
  const row = db
    .prepare<unknown[], ApiKeySql>(
      `SELECT id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
              serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan,
              cloro_remaining, cloro_per_cycle, cloro_resets_at
       FROM api_keys WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : apiKeyFromSql(row)
}

export function insertKeyUsage(db: SqliteDatabase, record: KeyUsageRecord): void {
  const row = normalizeKeyUsage(record)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens, credits)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.keyId,
          row.projectId,
          row.month,
          row.searches,
          row.calls,
          row.tokens,
          row.credits ?? 0
        ),
    'Could not save key usage'
  )
}

/**
 * Adds searches, calls, and tokens to the month row for one key and project.
 * A second call in the same month updates that row. It does not insert a generation.
 */
export function addKeyUsage(db: SqliteDatabase, record: KeyUsageRecord): void {
  const row = normalizeKeyUsage(record)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO key_usage (id, key_id, project_id, month, searches, calls, tokens, credits)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (key_id, ifnull(project_id, ''), month) DO UPDATE SET
             searches = searches + excluded.searches,
             calls = calls + excluded.calls,
             tokens = tokens + excluded.tokens,
             credits = credits + excluded.credits`
        )
        .run(
          row.id,
          row.keyId,
          row.projectId,
          row.month,
          row.searches,
          row.calls,
          row.tokens,
          row.credits ?? 0
        ),
    'Could not save key usage'
  )
}

export function getKeyUsage(db: SqliteDatabase, id: string): KeyUsageRecord | null {
  assertId(id)
  const row = db
    .prepare<unknown[], KeyUsageSql>(
      `SELECT id, key_id, project_id, month, searches, calls, tokens, credits
       FROM key_usage WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : keyUsageFromSql(row)
}

export function insertConnectionEvent(db: SqliteDatabase, record: ConnectionEventRecord): void {
  const row = normalizeConnectionEvent(record)
  runWrite(
    () =>
      db
        .prepare(
          `INSERT INTO connection_events (id, key_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)`
        )
        .run(row.id, row.keyId, row.at, row.kind, row.detail),
    'Could not save connection event'
  )
}

export function getConnectionEvent(db: SqliteDatabase, id: string): ConnectionEventRecord | null {
  assertId(id)
  const row = db
    .prepare<unknown[], ConnectionEventSql>(
      `SELECT id, key_id, at, kind, detail FROM connection_events WHERE id = ?`
    )
    .get(id)
  return row === undefined ? null : connectionEventFromSql(row)
}

export function listApiKeys(db: SqliteDatabase): ApiKeyRecord[] {
  const rows = db
    .prepare<unknown[], ApiKeySql>(
      `SELECT id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
              serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan,
              cloro_remaining, cloro_per_cycle, cloro_resets_at
       FROM api_keys ORDER BY rotation_order ASC, rowid ASC`
    )
    .all()
  return rows.map((row) => apiKeyFromSql(row))
}

/**
 * Keys for one provider, lowest `rotation_order` first (FR-11.2).
 * Equal orders stay in insertion order (`rowid`).
 */
export function listApiKeysByProvider(
  db: SqliteDatabase,
  provider: ApiKeyProvider
): ApiKeyRecord[] {
  const stored = requireProvider(provider)
  const rows = db
    .prepare<unknown[], ApiKeySql>(
      `SELECT id, provider, name, keychain_ref, rotation_order, cap, "on", project_ids, hint, state,
              serpapi_used, serpapi_limit, serpapi_plan, last_reason, plan,
              cloro_remaining, cloro_per_cycle, cloro_resets_at
       FROM api_keys WHERE provider = ?
       ORDER BY rotation_order ASC, rowid ASC`
    )
    .all(stored)
  return rows.map((row) => apiKeyFromSql(row))
}

/** The first key for a provider, lowest `rotation_order` first (FR-11.2). */
export function getApiKeyByProvider(
  db: SqliteDatabase,
  provider: ApiKeyProvider
): ApiKeyRecord | null {
  return listApiKeysByProvider(db, provider)[0] ?? null
}

export function updateApiKey(db: SqliteDatabase, record: ApiKeyRecord): void {
  const row = normalizeApiKey(record)
  const existing = getApiKey(db, row.id)
  if (existing === null) throw new StorageError('Could not save api key')
  if (existing.provider !== row.provider || existing.keychainRef !== row.keychainRef) {
    throw new StorageError('Could not save api key')
  }
  if (existing.rotationOrder !== row.rotationOrder) throw new StorageError('Could not save api key')
  const result = db
    .prepare(
      `UPDATE api_keys
       SET name = ?, cap = ?, "on" = ?, project_ids = ?, hint = ?, state = ?,
           serpapi_used = ?, serpapi_limit = ?, serpapi_plan = ?, last_reason = ?, plan = ?,
           cloro_remaining = ?, cloro_per_cycle = ?, cloro_resets_at = ?
       WHERE id = ?`
    )
    .run(
      row.name,
      row.cap,
      row.on ? 1 : 0,
      JSON.stringify(row.projectIds),
      row.hint,
      row.state,
      row.serpapiUsage?.used ?? null,
      row.serpapiUsage?.planLimit ?? null,
      row.serpapiUsage?.plan ?? null,
      row.lastReason,
      row.plan,
      row.cloroCredits?.remaining ?? null,
      row.cloroCredits?.perCycle ?? null,
      row.cloroCredits?.resetsAt ?? null,
      row.id
    )
  if (result.changes !== 1) throw new StorageError('Could not save api key')
}

export function deleteConnectionEventsForKey(db: SqliteDatabase, keyId: string): void {
  assertId(keyId)
  db.prepare(`DELETE FROM connection_events WHERE key_id = ?`).run(keyId)
}

export function deleteKeyUsageForKey(db: SqliteDatabase, keyId: string): void {
  assertId(keyId)
  db.prepare(`DELETE FROM key_usage WHERE key_id = ?`).run(keyId)
}

export function deleteApiKey(db: SqliteDatabase, id: string): void {
  const keyId = assertId(id)
  const existing = getApiKey(db, keyId)
  if (existing === null) throw new StorageError('Could not remove api key')
  const remove = db.transaction(() => {
    // key_usage rows stay: the searches were spent and still count toward
    // each project's monthly cap (FR-11.4). Migration 017 dropped their key FK.
    deleteConnectionEventsForKey(db, keyId)
    const result = db.prepare(`DELETE FROM api_keys WHERE id = ?`).run(keyId)
    if (result.changes !== 1) throw new StorageError('Could not remove api key')
    const remaining = listApiKeysByProvider(db, existing.provider)
    for (let index = 0; index < remaining.length; index += 1) {
      const key = remaining[index]
      if (key === undefined || key.rotationOrder === index) continue
      const updated = db
        .prepare(`UPDATE api_keys SET rotation_order = ? WHERE id = ?`)
        .run(index, key.id)
      if (updated.changes !== 1) throw new StorageError('Could not save api key')
    }
  })
  remove()
}

/** Writes `rotation_order` 0..n-1 in the given id order. Callers pass one provider. */
export function reorderApiKeys(db: SqliteDatabase, ids: readonly string[]): void {
  const apply = db.transaction(() => {
    for (let index = 0; index < ids.length; index += 1) {
      const id = assertId(ids[index] ?? '')
      const result = db
        .prepare(`UPDATE api_keys SET rotation_order = ? WHERE id = ?`)
        .run(index, id)
      if (result.changes !== 1) throw new StorageError('Could not save api key')
    }
  })
  apply()
}

export function listConnectionEventsForKey(
  db: SqliteDatabase,
  keyId: string
): ConnectionEventRecord[] {
  assertId(keyId)
  const rows = db
    .prepare<unknown[], ConnectionEventSql>(
      `SELECT id, key_id, at, kind, detail FROM connection_events
       WHERE key_id = ? ORDER BY at ASC, rowid ASC`
    )
    .all(keyId)
  return rows.map((row) => connectionEventFromSql(row))
}

interface ApiKeySql {
  id: string
  provider: string
  name: string
  keychain_ref: string
  rotation_order: number
  cap: number | null
  on: number
  project_ids: string
  hint: string
  state: string
  serpapi_used: number | null
  serpapi_limit: number | null
  serpapi_plan: string | null
  last_reason: string | null
  plan: string | null
  cloro_remaining: number | null
  cloro_per_cycle: number | null
  cloro_resets_at: string | null
}

interface KeyUsageSql {
  id: string
  key_id: string
  project_id: string | null
  month: string
  searches: number
  calls: number
  tokens: number
  credits: number
}

interface ConnectionEventSql {
  id: string
  key_id: string
  at: string
  kind: string
  detail: string | null
}

function normalizeApiKey(record: ApiKeyRecord): ApiKeyRecord {
  return {
    id: assertId(record.id),
    provider: requireProvider(record.provider),
    name: requireLabel(record.name, 'api key name', 200),
    keychainRef: requireKeychainRef(record.keychainRef),
    rotationOrder: requireInteger(record.rotationOrder, 'rotation order', 0, 10_000),
    cap: requireCap(record.cap),
    on: requireBoolean(record.on, 'api key on'),
    projectIds: requireProjectIds(record.projectIds),
    hint: requireHint(record.hint),
    state: requireConnectionState(record.state),
    lastReason: requireLastReason(record.lastReason),
    serpapiUsage: requireSerpApiUsage(record.provider, record.serpapiUsage),
    plan: requireOptionalLabel(record.plan ?? null, 'api key plan', 80),
    cloroCredits: requireCloroCredits(record.provider, record.cloroCredits ?? null)
  }
}

function normalizeKeyUsage(record: KeyUsageRecord): KeyUsageRecord {
  return {
    id: assertId(record.id),
    keyId: assertId(record.keyId),
    projectId: record.projectId === null ? null : assertId(record.projectId),
    month: requireMonth(record.month),
    searches: requireInteger(record.searches, 'searches', 0, 1_000_000_000),
    calls: requireInteger(record.calls, 'calls', 0, 1_000_000_000),
    tokens: requireInteger(record.tokens, 'tokens', 0, 1_000_000_000_000),
    credits: requireInteger(record.credits ?? 0, 'credits', 0, 1_000_000_000_000)
  }
}

function normalizeConnectionEvent(record: ConnectionEventRecord): ConnectionEventRecord {
  return {
    id: assertId(record.id),
    keyId: assertId(record.keyId),
    at: requireUtcTimestamp(record.at),
    kind: requireKind(record.kind),
    detail: requireOptionalDetail(record.detail)
  }
}

function apiKeyFromSql(row: ApiKeySql): ApiKeyRecord {
  let projectIds: unknown
  try {
    projectIds = JSON.parse(row.project_ids) as unknown
  } catch {
    throw new StorageError('Invalid project_ids')
  }
  return normalizeApiKey({
    id: row.id,
    provider: requireProvider(row.provider),
    name: row.name,
    keychainRef: row.keychain_ref,
    rotationOrder: row.rotation_order,
    cap: row.cap,
    on: row.on === 1,
    projectIds: requireStringArray(projectIds),
    hint: row.hint,
    state: requireConnectionState(row.state),
    lastReason: requireLastReason(row.last_reason),
    serpapiUsage: usageFromSql(row),
    plan: row.plan,
    cloroCredits:
      row.cloro_remaining === null
        ? null
        : {
            remaining: row.cloro_remaining,
            perCycle: row.cloro_per_cycle,
            resetsAt: row.cloro_resets_at
          }
  })
}

function keyUsageFromSql(row: KeyUsageSql): KeyUsageRecord {
  return normalizeKeyUsage({
    id: row.id,
    keyId: row.key_id,
    projectId: row.project_id,
    month: row.month,
    searches: row.searches,
    calls: row.calls,
    tokens: row.tokens,
    credits: row.credits
  })
}

function connectionEventFromSql(row: ConnectionEventSql): ConnectionEventRecord {
  return normalizeConnectionEvent({
    id: row.id,
    keyId: row.key_id,
    at: row.at,
    kind: requireKind(row.kind),
    detail: row.detail
  })
}

function requireProvider(value: string): ApiKeyProvider {
  if (!isApiKeyProvider(value)) throw new StorageError('Invalid api key provider')
  return value
}

function requireKind(value: string): ConnectionEventKind {
  if (!isOneOf(CONNECTION_EVENT_KINDS, value))
    throw new StorageError('Invalid connection event kind')
  return value
}

function requireKeychainRef(value: string): string {
  try {
    assertKeychainRef(value)
  } catch {
    throw new StorageError('Invalid keychain ref')
  }
  return value
}

function requireCap(value: number | null): number | null {
  if (value === null) return null
  return requireInteger(value, 'cap', 0, 1_000_000_000)
}

function requireProjectIds(values: readonly string[]): string[] {
  return requireStringArray(values)
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new StorageError('Invalid project_ids')
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !ID.test(entry)) throw new StorageError('Invalid project id')
    if (seen.has(entry)) throw new StorageError('Duplicate project id')
    seen.add(entry)
    ids.push(entry)
  }
  return ids
}

function requireConnectionState(value: string): ConnectionState {
  if (!isConnectionState(value)) throw new StorageError('Invalid connection state')
  return value
}

function requireLastReason(value: unknown): KeyTestReason | null {
  if (value === null) return null
  if (typeof value !== 'string' || !isOneOf(KEY_TEST_REASONS, value)) {
    throw new StorageError('Invalid last reason')
  }
  return value
}

function requireSerpApiUsage(
  provider: ApiKeyProvider,
  usage: SerpApiUsage | null
): SerpApiUsage | null {
  if (usage === null) return null
  if (provider !== 'serpapi')
    throw new StorageError('SerpApi usage is only stored for a SerpApi key')
  const used = requireInteger(usage.used, 'serpapi used', 0, 1_000_000_000)
  const planLimit =
    usage.planLimit === null
      ? null
      : requireInteger(usage.planLimit, 'serpapi plan limit', 0, 1_000_000_000)
  const plan = usage.plan === null ? null : requireLabel(usage.plan, 'serpapi plan', 80)
  return { used, planLimit, plan }
}

function requireCloroCredits(
  provider: ApiKeyProvider,
  credits: CloroCredits | null
): CloroCredits | null {
  if (credits === null) return null
  if (provider !== 'cloro') throw new StorageError('cloro credits are only stored for a cloro key')
  return {
    remaining: requireInteger(credits.remaining, 'cloro credits', 0, 1_000_000_000_000),
    perCycle:
      credits.perCycle === null
        ? null
        : requireInteger(credits.perCycle, 'cloro credits per cycle', 0, 1_000_000_000_000),
    resetsAt: credits.resetsAt === null ? null : requireUtcTimestamp(credits.resetsAt)
  }
}

function usageFromSql(row: ApiKeySql): SerpApiUsage | null {
  if (row.serpapi_used === null) return null
  return {
    used: row.serpapi_used,
    planLimit: row.serpapi_limit,
    plan: row.serpapi_plan
  }
}

function requireHint(value: string): string {
  if (value !== '' && !/^[\x21-\x7E]{4}$/.test(value)) throw new StorageError('Invalid key hint')
  rejectSecret(value, 'key hint', true)
  return value
}

function requireMonth(value: string): string {
  if (!MONTH.test(value)) throw new StorageError('Invalid usage month')
  return value
}

function requireOptionalDetail(value: string | null): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new StorageError('Invalid connection event detail')
  }
  if (value.includes('\0')) throw new StorageError('Invalid connection event detail')
  rejectSecret(value, 'connection event detail', true)
  return value
}
