/** API keys. Secrets go to the keychain and never come back on a result. */

import type { ApiKeyMetadata, CloroCredits, ConnectionState, SerpApiUsage } from '@shared/domain'
import type {
  IpcHandlersFor,
  keysChannels,
  KeyTestReason,
  KeyTestResult,
  RemoveKeyResult
} from '@shared/ipc'
import {
  IpcRequestError,
  parseAddKey,
  parseKeyId,
  parseRenameKey,
  parseReorderKeys,
  parseReplaceKey,
  parseSetKeyCap,
  parseSetKeyOn,
  parseUpdateKey
} from '../ipc-request'
import { presentApiKey, usageMonth } from '../keys/present'
import { redactString } from '../logging/redact'
import { createAnthropicApiProvider } from '../providers/claude/anthropic-api'
import { createCloroAccountClient } from '../providers/cloro/account'
import { createJinaReaderClient } from '../providers/jina/reader'
import { createSerpApiAccountClient } from '../providers/serpapi/account'
import { testYouTubeKey } from '../providers/youtube/data-api'
import { keychainAccountForKey, maskedHint } from '../secrets/secret-store'
import { getKeyUsageForMonth } from '../storage/key-usage'
import {
  deleteApiKey,
  getApiKey,
  getProject,
  insertApiKey,
  insertConnectionEvent,
  listApiKeys,
  listApiKeysByProvider,
  reorderApiKeys,
  updateApiKey,
  type ApiKeyRecord,
  type ConnectionEventKind
} from '../storage/records'
import { guard, type EngineContext } from './context'

export function keysHandlers(ctx: EngineContext): IpcHandlersFor<typeof keysChannels> {
  return {
    'keys:add': (request) => guard('keys:add', ctx, () => addKey(ctx, request)),
    'keys:test': (request) => guard('keys:test', ctx, () => testKey(ctx, request)),
    'keys:rename': (request) => guard('keys:rename', ctx, () => renameKey(ctx, request)),
    'keys:setOn': (request) => guard('keys:setOn', ctx, () => setKeyOn(ctx, request)),
    'keys:setCap': (request) => guard('keys:setCap', ctx, () => setKeyCap(ctx, request)),
    'keys:replace': (request) => guard('keys:replace', ctx, () => replaceKey(ctx, request)),
    'keys:update': (request) => guard('keys:update', ctx, () => updateKey(ctx, request)),
    'keys:reorder': (request) => guard('keys:reorder', ctx, () => reorderKeys(ctx, request)),
    'keys:list': () => guard('keys:list', ctx, () => listKeys(ctx)),
    'keys:remove': (request) => guard('keys:remove', ctx, () => removeKey(ctx, request))
  }
}

async function addKey(ctx: EngineContext, request: unknown): Promise<ApiKeyMetadata> {
  const parsed = parseAddKey(request)
  assertProjects(ctx, parsed.projectIds, 'keys:add')
  const id = ctx.createId()
  const keychainRef = keychainAccountForKey(parsed.provider, id)
  const hint = maskedHint(parsed.secret)
  ctx.secrets.set(keychainRef, parsed.secret)
  const record: ApiKeyRecord = {
    id,
    provider: parsed.provider,
    name: parsed.name,
    keychainRef,
    rotationOrder: parsed.rotationOrder ?? nextRotationOrder(ctx, parsed.provider),
    cap: parsed.cap,
    on: true,
    projectIds: parsed.projectIds,
    hint,
    state: 'unchecked',
    lastReason: null,
    serpapiUsage: null,
    plan: null,
    cloroCredits: null
  }
  try {
    insertApiKey(ctx.storage.db, record)
  } catch (error) {
    ctx.secrets.delete(keychainRef)
    throw error
  }
  // Both tests are free (cloro's balance read costs no credits), so a new key is checked at once.
  if (testsOnSave(parsed.provider)) {
    return presentOne(ctx, (await applyTest(ctx, record)).key)
  }
  return presentOne(ctx, record)
}

async function testKey(ctx: EngineContext, request: unknown): Promise<KeyTestResult> {
  const parsed = parseKeyId(request, 'keys:test')
  const key = requireKey(ctx, parsed.id, 'keys:test')
  const tested = await applyTest(ctx, key)
  return { key: presentOne(ctx, tested.key), message: tested.message, reason: tested.reason }
}

function renameKey(ctx: EngineContext, request: unknown): ApiKeyMetadata {
  const parsed = parseRenameKey(request)
  const key = requireKey(ctx, parsed.id, 'keys:rename')
  const next = { ...key, name: parsed.name }
  updateApiKey(ctx.storage.db, next)
  return presentOne(ctx, next)
}

function setKeyOn(ctx: EngineContext, request: unknown): ApiKeyMetadata {
  const parsed = parseSetKeyOn(request)
  const key = requireKey(ctx, parsed.id, 'keys:setOn')
  if (key.on === parsed.on) return presentOne(ctx, key)
  const next = { ...key, on: parsed.on }
  updateApiKey(ctx.storage.db, next)
  if (!parsed.on) {
    recordEvent(ctx, key.id, 'failed', 'Key switched off.')
  }
  return presentOne(ctx, next)
}

function setKeyCap(ctx: EngineContext, request: unknown): ApiKeyMetadata {
  const parsed = parseSetKeyCap(request)
  const key = requireKey(ctx, parsed.id, 'keys:setCap')
  const next = { ...key, cap: parsed.cap }
  updateApiKey(ctx.storage.db, next)
  return presentOne(ctx, next)
}

async function replaceKey(ctx: EngineContext, request: unknown): Promise<ApiKeyMetadata> {
  const parsed = parseReplaceKey(request)
  const key = requireKey(ctx, parsed.id, 'keys:replace')
  ctx.secrets.set(key.keychainRef, parsed.secret)
  const next: ApiKeyRecord = {
    ...key,
    hint: maskedHint(parsed.secret),
    state: 'unchecked',
    lastReason: null,
    serpapiUsage: null,
    cloroCredits: null
  }
  updateApiKey(ctx.storage.db, next)
  if (testsOnSave(key.provider)) return presentOne(ctx, (await applyTest(ctx, next)).key)
  return presentOne(ctx, next)
}

function updateKey(ctx: EngineContext, request: unknown): ApiKeyMetadata {
  const parsed = parseUpdateKey(request)
  const key = requireKey(ctx, parsed.id, 'keys:update')
  if (parsed.projectIds !== undefined) assertProjects(ctx, parsed.projectIds, 'keys:update')
  const next: ApiKeyRecord = {
    ...key,
    name: parsed.name ?? key.name,
    plan: parsed.plan === undefined ? (key.plan ?? null) : parsed.plan,
    cap: parsed.monthlyCap === undefined ? key.cap : parsed.monthlyCap,
    on: parsed.enabled === undefined ? key.on : parsed.enabled,
    projectIds: parsed.projectIds ?? key.projectIds
  }
  updateApiKey(ctx.storage.db, next)
  if (parsed.enabled === false && key.on) {
    recordEvent(ctx, key.id, 'failed', 'Key switched off.')
  }
  return presentOne(ctx, next)
}

function listKeys(ctx: EngineContext): ApiKeyMetadata[] {
  return presentKeys(ctx, listApiKeys(ctx.storage.db))
}

function reorderKeys(ctx: EngineContext, request: unknown): ApiKeyMetadata[] {
  const parsed = parseReorderKeys(request)
  const provider = providerForReorder(ctx, parsed.provider, parsed.ids)
  const current = listApiKeysByProvider(ctx.storage.db, provider)
  if (
    !sameKeySet(
      current.map((key) => key.id),
      parsed.ids
    )
  ) {
    throw new IpcRequestError('keys:reorder', "The list must be exactly this provider's keys")
  }
  reorderApiKeys(ctx.storage.db, parsed.ids)
  const used = usedByKey(ctx)
  return parsed.ids.map((id) => {
    const key = getApiKey(ctx.storage.db, id)
    if (key === null) throw new IpcRequestError('keys:reorder', 'That key was not found')
    return presentApiKey(key, used.get(id) ?? 0)
  })
}

function removeKey(ctx: EngineContext, request: unknown): RemoveKeyResult {
  const parsed = parseKeyId(request, 'keys:remove')
  const key = requireKey(ctx, parsed.id, 'keys:remove')
  try {
    ctx.secrets.delete(key.keychainRef)
  } catch (error) {
    ctx.logger.error('keys:remove could not delete the keychain item', error)
  }
  deleteApiKey(ctx.storage.db, key.id)
  return { id: key.id }
}

function requireKey(ctx: EngineContext, id: string, channel: string): ApiKeyRecord {
  const key = getApiKey(ctx.storage.db, id)
  if (key === null) throw new IpcRequestError(channel, 'That key was not found')
  return key
}

function nextRotationOrder(ctx: EngineContext, provider: ApiKeyRecord['provider']): number {
  const existing = listApiKeysByProvider(ctx.storage.db, provider)
  let max = -1
  for (const key of existing) {
    if (key.rotationOrder > max) max = key.rotationOrder
  }
  return max + 1
}

function providerForReorder(
  ctx: EngineContext,
  provider: ApiKeyRecord['provider'] | undefined,
  ids: readonly string[]
): ApiKeyRecord['provider'] {
  if (provider !== undefined) return provider
  const firstId = ids[0]
  if (firstId === undefined) {
    throw new IpcRequestError('keys:reorder', "The list must be exactly this provider's keys")
  }
  const first = getApiKey(ctx.storage.db, firstId)
  if (first === null) {
    throw new IpcRequestError('keys:reorder', "The list must be exactly this provider's keys")
  }
  return first.provider
}

function sameKeySet(current: readonly string[], requested: readonly string[]): boolean {
  if (requested.length !== current.length) return false
  if (new Set(requested).size !== requested.length) return false
  const ids = new Set(current)
  return requested.every((id) => ids.has(id))
}

function usedByKey(ctx: EngineContext): Map<string, number> {
  const usage = getKeyUsageForMonth(ctx.storage.db, usageMonth(ctx.now()))
  return new Map(usage.keys.map((key) => [key.keyId, key.searches]))
}

function presentOne(ctx: EngineContext, record: ApiKeyRecord): ApiKeyMetadata {
  return presentApiKey(record, usedByKey(ctx).get(record.id) ?? 0)
}

export function presentKeys(
  ctx: EngineContext,
  records: readonly ApiKeyRecord[]
): ApiKeyMetadata[] {
  const used = usedByKey(ctx)
  return records.map((record) => presentApiKey(record, used.get(record.id) ?? 0))
}

function assertProjects(ctx: EngineContext, projectIds: readonly string[], channel: string): void {
  for (const id of projectIds) {
    if (getProject(ctx.storage.db, id) === null) {
      throw new IpcRequestError(channel, 'That project was not found')
    }
  }
}

interface KeyProbe {
  state: ConnectionState
  message: string
  usage: SerpApiUsage | null
  reason: KeyTestReason | null
  credits?: CloroCredits | null
}

function testsOnSave(provider: ApiKeyRecord['provider']): boolean {
  return provider === 'anthropic' || provider === 'cloro'
}

async function applyTest(
  ctx: EngineContext,
  key: ApiKeyRecord
): Promise<{ key: ApiKeyRecord; message: string; reason: KeyTestReason | null }> {
  const probe = await probeKey(ctx, key)
  const state: ConnectionState =
    probe.state === 'ok' || probe.state === 'warning' ? probe.state : 'warning'
  const reason = state === 'ok' ? null : (probe.reason ?? 'other')
  const next: ApiKeyRecord = {
    ...key,
    state,
    lastReason: cachedLastReason(state, probe.reason),
    serpapiUsage: key.provider === 'serpapi' ? probe.usage : null,
    // A failed test keeps the last balance it read, so Connections still shows it.
    cloroCredits: key.provider === 'cloro' ? (probe.credits ?? key.cloroCredits ?? null) : null
  }
  updateApiKey(ctx.storage.db, next)
  recordTestEvents(ctx, key, next, probe.message, reason)
  return { key: next, message: probe.message, reason }
}

/**
 * `last_reason` stays aligned with the cached `state` column.
 * A warning stores the failure code. `ok`, `unchecked`, and `off` store null.
 */
function cachedLastReason(
  state: ConnectionState,
  reason: KeyTestReason | null
): KeyTestReason | null {
  if (state !== 'warning') return null
  return reason ?? 'other'
}

async function probeKey(ctx: EngineContext, key: ApiKeyRecord): Promise<KeyProbe> {
  if (key.provider === 'serpapi') {
    const client = createSerpApiAccountClient({
      transport: ctx.http,
      logger: ctx.logger,
      secrets: ctx.knownSecrets
    })
    const result = await client.testKey(ctx.secrets, key.keychainRef)
    return {
      state: result.state,
      message: result.message,
      usage: result.usage,
      reason: result.reason
    }
  }
  if (key.provider === 'cloro') {
    const client = createCloroAccountClient({
      transport: ctx.http,
      logger: ctx.logger,
      secrets: ctx.knownSecrets
    })
    const result = await client.testKey(ctx.secrets, key.keychainRef)
    return {
      state: result.state,
      message: result.message,
      usage: null,
      reason: result.reason,
      credits: result.credits
    }
  }
  if (key.provider === 'jina') {
    const client = createJinaReaderClient({
      transport: ctx.http,
      logger: ctx.logger,
      secrets: ctx.knownSecrets
    })
    const result = await client.testKey(ctx.secrets, key.keychainRef)
    return { state: result.state, message: result.message, usage: null, reason: result.reason }
  }
  if (key.provider === 'anthropic') {
    const provider = createAnthropicApiProvider({
      secretStore: ctx.secrets,
      keychainRef: key.keychainRef,
      transport: ctx.http,
      logger: ctx.logger,
      model: ctx.storage.readSettings().claudeModel,
      secrets: ctx.knownSecrets
    })
    const result = await provider.testKey()
    return { state: result.state, message: result.message, usage: null, reason: result.reason }
  }
  const result = await testYouTubeKey({
    transport: ctx.http,
    logger: ctx.logger,
    secretStore: ctx.secrets,
    keychainRef: key.keychainRef,
    secrets: ctx.knownSecrets
  })
  return { state: result.state, message: result.message, usage: null, reason: result.reason }
}

function recordTestEvents(
  ctx: EngineContext,
  before: ApiKeyRecord,
  after: ApiKeyRecord,
  message: string,
  reason: KeyTestReason | null
): void {
  if (before.state !== after.state && after.state === 'warning') {
    recordEvent(ctx, after.id, reason === 'rate_limited' ? 'rate_limited' : 'failed', message)
  }
}

function recordEvent(
  ctx: EngineContext,
  keyId: string,
  kind: ConnectionEventKind,
  detail: string
): void {
  const safe = redactString(detail, { secrets: ctx.knownSecrets() }).slice(0, 500)
  try {
    insertConnectionEvent(ctx.storage.db, {
      id: ctx.createId(),
      keyId,
      at: ctx.now().toISOString(),
      kind,
      detail: safe.length === 0 ? null : safe
    })
  } catch (error) {
    ctx.logger.error('Could not record a connection event', error)
  }
}
