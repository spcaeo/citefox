import {
  isCapRule,
  isClaudeFallback,
  isProjectClaudeConnection,
  isSampleCount,
  isSearchSource
} from '@shared/domain'
import type {
  ProjectClaudeSettings,
  ProjectSearchSettings,
  ProjectTemplateOverride,
  SampleCount
} from '@shared/domain'
import type { DeleteProjectRequest, UpdateProjectSettingsRequest } from '@shared/ipc'
import { IpcRequestError } from './ipc-request'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/
const KIND = /^[a-z][a-z0-9_]{0,40}$/
const MAX_CAP = 1_000_000_000

/** `projectSettings:update`. Unknown keys are refused; omitted parts stay as they are. */
export function parseUpdateProjectSettings(value: unknown): UpdateProjectSettingsRequest {
  const channel = 'projectSettings:update'
  const record = plain(value, channel)
  allowOnly(record, channel, [
    'projectId',
    'search',
    'claude',
    'defaultSamples',
    'templateOverrides',
    'checkWhenReady'
  ])
  const request: UpdateProjectSettingsRequest = { projectId: readId(record.projectId, channel) }
  if (has(record, 'search')) request.search = parseProjectSearch(record.search, channel)
  if (has(record, 'claude')) request.claude = parseProjectClaude(record.claude, channel)
  if (has(record, 'defaultSamples')) {
    request.defaultSamples = readSamples(record.defaultSamples, channel)
  }
  if (has(record, 'templateOverrides')) {
    request.templateOverrides = readOverrides(record.templateOverrides, channel)
  }
  if (has(record, 'checkWhenReady')) {
    if (typeof record.checkWhenReady !== 'boolean') throw new IpcRequestError(channel)
    request.checkWhenReady = record.checkWhenReady
  }
  return request
}

/** `projectSettings:delete`. The name is compared exactly by the engine. */
export function parseDeleteProject(value: unknown): DeleteProjectRequest {
  const channel = 'projectSettings:delete'
  const record = plain(value, channel)
  allowOnly(record, channel, ['projectId', 'confirmName'])
  if (typeof record.confirmName !== 'string' || record.confirmName.length > 200) {
    throw new IpcRequestError(channel)
  }
  return { projectId: readId(record.projectId, channel), confirmName: record.confirmName }
}

/** FR-11.4. A dedicated source needs a key; a shared source drops any key id. */
export function parseProjectSearch(value: unknown, channel: string): ProjectSearchSettings {
  const record = plain(value, channel)
  allowOnly(record, channel, ['source', 'cap', 'capRule', 'dedicatedKeyId'])
  const source = record.source
  const capRule = record.capRule
  if (typeof source !== 'string' || !isSearchSource(source)) throw new IpcRequestError(channel)
  if (typeof capRule !== 'string' || !isCapRule(capRule)) throw new IpcRequestError(channel)
  const cap = record.cap
  if (
    cap !== null &&
    (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > MAX_CAP)
  ) {
    throw new IpcRequestError(channel, 'The cap must be a whole number of searches')
  }
  const keyId = record.dedicatedKeyId === null ? null : readId(record.dedicatedKeyId, channel)
  if (source === 'dedicated' && keyId === null) {
    throw new IpcRequestError(channel, 'Choose a dedicated key')
  }
  return {
    source,
    cap,
    capRule,
    dedicatedKeyId: source === 'dedicated' ? keyId : null
  }
}

/** FR-11.7, LLM-5. Key ids that the chosen connection and rule do not use are dropped. */
export function parseProjectClaude(value: unknown, channel: string): ProjectClaudeSettings {
  const record = plain(value, channel)
  allowOnly(record, channel, ['connection', 'keyId', 'fallback', 'fallbackKeyId', 'model'])
  const connection = record.connection
  const fallback = record.fallback
  if (typeof connection !== 'string' || !isProjectClaudeConnection(connection)) {
    throw new IpcRequestError(channel)
  }
  if (typeof fallback !== 'string' || !isClaudeFallback(fallback)) {
    throw new IpcRequestError(channel)
  }
  const keyId = record.keyId === null ? null : readId(record.keyId, channel)
  const fallbackKeyId = record.fallbackKeyId === null ? null : readId(record.fallbackKeyId, channel)
  const model = record.model
  if (model !== null && (typeof model !== 'string' || !MODEL.test(model))) {
    throw new IpcRequestError(channel, 'That model name is not valid')
  }
  if (connection === 'api_key' && keyId === null) {
    throw new IpcRequestError(channel, 'Choose an Anthropic API key')
  }
  if (fallback === 'switch_key' && fallbackKeyId === null) {
    throw new IpcRequestError(channel, 'Choose the API key to switch to')
  }
  return {
    connection,
    keyId: connection === 'api_key' ? keyId : null,
    fallback,
    fallbackKeyId: fallback === 'switch_key' ? fallbackKeyId : null,
    model
  }
}

/** Optional `projects:create` fields (FR-10.4). */
export function parseCreateOptions(
  record: Record<string, unknown>,
  channel: string
): {
  copySettingsFrom?: string | null
  search?: ProjectSearchSettings
  claude?: ProjectClaudeSettings
} {
  const out: {
    copySettingsFrom?: string | null
    search?: ProjectSearchSettings
    claude?: ProjectClaudeSettings
  } = {}
  if (has(record, 'copySettingsFrom')) {
    out.copySettingsFrom =
      record.copySettingsFrom === null ? null : readId(record.copySettingsFrom, channel)
  }
  if (has(record, 'search')) out.search = parseProjectSearch(record.search, channel)
  if (has(record, 'claude')) out.claude = parseProjectClaude(record.claude, channel)
  return out
}

function readOverrides(value: unknown, channel: string): ProjectTemplateOverride[] {
  if (!Array.isArray(value) || value.length > 20) throw new IpcRequestError(channel)
  return value.map((item: unknown) => {
    const record = plain(item, channel)
    allowOnly(record, channel, ['kind', 'templateId'])
    if (typeof record.kind !== 'string' || !KIND.test(record.kind)) {
      throw new IpcRequestError(channel)
    }
    return { kind: record.kind, templateId: readId(record.templateId, channel) }
  })
}

function readSamples(value: unknown, channel: string): SampleCount {
  if (typeof value !== 'number' || !isSampleCount(value)) throw new IpcRequestError(channel)
  return value
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function plain(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function allowOnly(
  record: Record<string, unknown>,
  channel: string,
  allowed: readonly string[]
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  }
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined
}
