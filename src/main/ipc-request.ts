import {
  isApiKeyProvider,
  isClaudeProvider,
  isCountryCode,
  isGenerationTemplateKind,
  isIntervalDays,
  isJinaMode,
  isLanguageTag,
  isMarketDevice,
  isSampleCount,
  isSerpApiRotationMode,
  isSidebarMode,
  isThemePreference
} from '@shared/domain'
import type {
  ApiKeyProvider,
  AppSettings,
  ClaudeProvider,
  IntervalDays,
  JinaMode,
  MarketDevice,
  SampleCount,
  SerpApiRotationMode
} from '@shared/domain'
import { isPlaygroundSavePart } from '@shared/ipc'
import type {
  AddApiKeyRequest,
  AppSettingsPatch,
  CreateTemplateRequest,
  KeyIdRequest,
  ListTemplatesRequest,
  MarketDraft,
  PlaygroundAioRequest,
  PlaygroundOverrides,
  PlaygroundRunRequest,
  SavePlaygroundRunRequest,
  RenameKeyRequest,
  ReorderKeysRequest,
  ReplaceKeyRequest,
  RunClaudeCheckupRequest,
  ClaudePauseRequest,
  SaveProfileRequest,
  SetKeyCapRequest,
  SetKeyOnRequest,
  UpdateKeyRequest,
  TemplateIdRequest,
  TemplateUsageRequest,
  UpdateTemplateRequest
} from '@shared/ipc'
import type { IpcInvokeChannel } from '@shared/ipc'

import { readTemplateSettingsRequest } from './ipc-ai'
import { claudeBinaryPathProblem } from './providers/claude/binary'
import { codexBinaryPathProblem } from './providers/codex/binary'
import { MAX_PROMPT_COUNT } from './storage/pages'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63})$/
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/
const MAX_SECRET_LENGTH = 4096
const MAX_CLAUDE_CONCURRENCY = 32

/**
 * A rejected IPC call names the channel and a fixed reason.
 * The reason never includes the arguments, so a secret cannot be echoed (NFR-5).
 */
export class IpcRequestError extends Error {
  readonly channel: string
  readonly nextStep: string | null

  constructor(channel: string, reason = 'Invalid request', nextStep: string | null = null) {
    super(`${channel}: ${reason}`)
    this.name = 'IpcRequestError'
    this.channel = channel
    this.nextStep = nextStep
  }
}

export function parseSaveProfile(value: unknown): SaveProfileRequest {
  const channel = 'onboarding:saveProfile'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    [
      'userName',
      'projectName',
      'domain',
      'includeSubdomains',
      'brandNames',
      'competitors',
      'country',
      'language',
      'location',
      'device',
      'switchingFrom',
      'integrations'
    ],
    ['includeSubdomains', 'device', 'switchingFrom', 'integrations']
  )
  const includeSubdomains = has(record, 'includeSubdomains') ? record.includeSubdomains : true
  const device = has(record, 'device') ? record.device : 'desktop'
  return {
    // Optional in onboarding v2: '' keeps the saved name (handlers/onboarding.ts).
    userName: record.userName === '' ? '' : readLabel(record.userName, channel, 200),
    projectName: readLabel(record.projectName, channel, 200),
    domain: readDomain(record.domain, channel),
    includeSubdomains: readBoolean(includeSubdomains, channel),
    brandNames: readNameList(record.brandNames, channel, true),
    competitors: readNameList(record.competitors, channel, false),
    country: readCountry(record.country, channel),
    language: readLanguage(record.language, channel),
    location: readNullableLabel(record.location, channel, 120),
    device: readDevice(device, channel),
    ...readBuyerContextLists(record, channel)
  }
}

/** Optional `switchingFrom` and `integrations` name lists (Docs/FEEDBACK.md row 3), 12 each. */
export function readBuyerContextLists(
  record: Record<string, unknown>,
  channel: string
): { switchingFrom?: string[]; integrations?: string[] } {
  const out: { switchingFrom?: string[]; integrations?: string[] } = {}
  for (const key of ['switchingFrom', 'integrations'] as const) {
    if (!has(record, key)) continue
    const names = readNameList(record[key], channel, false)
    if (names.length > 12) throw new IpcRequestError(channel)
    out[key] = names
  }
  return out
}

export function parseAddKey(value: unknown): AddApiKeyRequest {
  const channel = 'keys:add'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    ['provider', 'name', 'secret', 'cap', 'projectIds', 'rotationOrder'],
    ['rotationOrder']
  )
  const request: AddApiKeyRequest = {
    provider: readProvider(record.provider, channel),
    name: readLabel(record.name, channel, 200),
    secret: readSecret(record.secret, channel),
    cap: readCap(record.cap, channel),
    projectIds: readProjectIds(record.projectIds, channel)
  }
  if (has(record, 'rotationOrder')) {
    request.rotationOrder = readInteger(record.rotationOrder, channel, 0, 10_000)
  }
  return request
}

export function parseUpdateKey(value: unknown): UpdateKeyRequest {
  const channel = 'keys:update'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    ['id', 'name', 'plan', 'monthlyCap', 'enabled', 'projectIds'],
    ['name', 'plan', 'monthlyCap', 'enabled', 'projectIds']
  )
  const request: UpdateKeyRequest = { id: readId(record.id, channel) }
  if (has(record, 'name')) request.name = readLabel(record.name, channel, 200)
  if (has(record, 'plan')) request.plan = readNullableLabel(record.plan, channel, 80)
  if (has(record, 'monthlyCap')) request.monthlyCap = readCap(record.monthlyCap, channel)
  if (has(record, 'enabled')) request.enabled = readBoolean(record.enabled, channel)
  if (has(record, 'projectIds')) request.projectIds = readProjectIds(record.projectIds, channel)
  return request
}

export function parseReorderKeys(value: unknown): ReorderKeysRequest {
  const channel = 'keys:reorder'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['provider', 'ids'], ['provider'])
  const request: ReorderKeysRequest = { ids: readReorderIds(record.ids, channel) }
  if (has(record, 'provider')) request.provider = readProvider(record.provider, channel)
  return request
}

export function parseKeyId(value: unknown, channel: IpcInvokeChannel): KeyIdRequest {
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id'])
  return { id: readId(record.id, channel) }
}

export function parseRenameKey(value: unknown): RenameKeyRequest {
  const channel = 'keys:rename'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id', 'name'])
  return { id: readId(record.id, channel), name: readLabel(record.name, channel, 200) }
}

export function parseSetKeyOn(value: unknown): SetKeyOnRequest {
  const channel = 'keys:setOn'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id', 'on'])
  return { id: readId(record.id, channel), on: readBoolean(record.on, channel) }
}

export function parseSetKeyCap(value: unknown): SetKeyCapRequest {
  const channel = 'keys:setCap'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id', 'cap'])
  return { id: readId(record.id, channel), cap: readCap(record.cap, channel) }
}

export function parseReplaceKey(value: unknown): ReplaceKeyRequest {
  const channel = 'keys:replace'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id', 'secret'])
  return { id: readId(record.id, channel), secret: readSecret(record.secret, channel) }
}

export function parseRunCheckup(value: unknown): RunClaudeCheckupRequest {
  const channel = 'claudeCode:runCheckup'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['binaryPath', 'provider'], ['provider'])
  if (!has(record, 'provider')) return { binaryPath: readBinaryPath(record.binaryPath, channel) }
  if (record.provider !== 'claude-code' && record.provider !== 'codex') {
    throw new IpcRequestError(channel)
  }
  const provider = record.provider
  const binaryPath =
    provider === 'codex'
      ? readCodexBinaryPath(record.binaryPath, channel)
      : readBinaryPath(record.binaryPath, channel)
  return { binaryPath, provider }
}

export function parseClaudePause(value: unknown): ClaudePauseRequest {
  const channel = 'claudeCode:getPause'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId'])
  return { projectId: readNullableId(record.projectId, channel) }
}

const SETTINGS_KEYS = [
  'userName',
  'defaultCountry',
  'defaultLanguage',
  'defaultLocation',
  'defaultDevice',
  'defaultIntervalDays',
  'defaultSamples',
  'defaultPromptCount',
  'claudeBinaryPath',
  'claudeConcurrency',
  'claudeModel',
  'claudeProvider',
  'codexBinaryPath',
  'codexModel',
  'codexQuickModel',
  'jinaMode',
  'serpapiRotation',
  'sidebar',
  'theme',
  'celebrate',
  'celebrateSound'
] as const

export function parseSettingsPatch(value: unknown): AppSettingsPatch {
  const channel = 'settings:update'
  const record = plainObject(value, channel)
  requireKeys(record, channel, SETTINGS_KEYS, SETTINGS_KEYS)
  const patch: AppSettingsPatch = {}
  if (has(record, 'userName')) patch.userName = readNullableLabel(record.userName, channel, 200)
  if (has(record, 'defaultCountry'))
    patch.defaultCountry = readNullableCountry(record.defaultCountry, channel)
  if (has(record, 'defaultLanguage')) {
    patch.defaultLanguage = readNullableLanguage(record.defaultLanguage, channel)
  }
  if (has(record, 'defaultLocation')) {
    patch.defaultLocation = readNullableLabel(record.defaultLocation, channel, 120)
  }
  if (has(record, 'defaultDevice')) patch.defaultDevice = readDevice(record.defaultDevice, channel)
  if (has(record, 'defaultIntervalDays')) {
    patch.defaultIntervalDays = readInterval(record.defaultIntervalDays, channel)
  }
  if (has(record, 'defaultSamples'))
    patch.defaultSamples = readSamples(record.defaultSamples, channel)
  if (has(record, 'defaultPromptCount')) {
    patch.defaultPromptCount = readPromptCount(record.defaultPromptCount, channel)
  }
  if (has(record, 'claudeBinaryPath')) {
    patch.claudeBinaryPath = readBinaryPath(record.claudeBinaryPath, channel)
  }
  if (has(record, 'claudeConcurrency')) {
    patch.claudeConcurrency = readInteger(
      record.claudeConcurrency,
      channel,
      1,
      MAX_CLAUDE_CONCURRENCY
    )
  }
  if (has(record, 'claudeModel')) patch.claudeModel = readModel(record.claudeModel, channel)
  if (has(record, 'claudeProvider'))
    patch.claudeProvider = readClaudeProvider(record.claudeProvider, channel)
  if (has(record, 'codexBinaryPath')) {
    patch.codexBinaryPath = readCodexBinaryPath(record.codexBinaryPath, channel)
  }
  if (has(record, 'codexModel')) patch.codexModel = readModel(record.codexModel, channel)
  if (has(record, 'codexQuickModel')) {
    patch.codexQuickModel = readModel(record.codexQuickModel, channel)
  }
  if (has(record, 'jinaMode')) patch.jinaMode = readJinaMode(record.jinaMode, channel)
  if (has(record, 'serpapiRotation')) {
    patch.serpapiRotation = readSavedRotation(record.serpapiRotation, channel)
  }
  if (has(record, 'sidebar')) {
    if (typeof record.sidebar !== 'string' || !isSidebarMode(record.sidebar)) {
      throw new IpcRequestError(channel)
    }
    patch.sidebar = record.sidebar
  }
  if (has(record, 'theme')) {
    if (typeof record.theme !== 'string' || !isThemePreference(record.theme)) {
      throw new IpcRequestError(channel)
    }
    patch.theme = record.theme
  }
  if (has(record, 'celebrate')) {
    if (typeof record.celebrate !== 'boolean') throw new IpcRequestError(channel)
    patch.celebrate = record.celebrate
  }
  if (has(record, 'celebrateSound')) {
    if (typeof record.celebrateSound !== 'boolean') throw new IpcRequestError(channel)
    patch.celebrateSound = record.celebrateSound
  }
  return patch
}

export function parseListTemplates(value: unknown): ListTemplatesRequest {
  const channel = 'templates:list'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['kind', 'includeDeleted'], ['kind', 'includeDeleted'])
  const request: ListTemplatesRequest = {}
  if (has(record, 'kind')) request.kind = readTemplateKind(record.kind, channel)
  if (has(record, 'includeDeleted'))
    request.includeDeleted = readBoolean(record.includeDeleted, channel)
  return request
}

export function parseTemplateId(value: unknown, channel: IpcInvokeChannel): TemplateIdRequest {
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id'])
  return { id: readId(record.id, channel) }
}

export function parseCreateTemplate(value: unknown): CreateTemplateRequest {
  const channel = 'templates:create'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    ['kind', 'name', 'body', 'notes', 'fromId'],
    ['body', 'notes', 'fromId']
  )
  const request: CreateTemplateRequest = {
    kind: readTemplateKind(record.kind, channel),
    name: readPlainString(record.name, channel)
  }
  if (has(record, 'body')) request.body = readTemplateBody(record.body, channel)
  if (has(record, 'notes')) request.notes = readNotes(record.notes, channel)
  if (has(record, 'fromId')) request.fromId = readId(record.fromId, channel)
  return request
}

export function parseUpdateTemplate(value: unknown): UpdateTemplateRequest {
  const channel = 'templates:update'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    ['id', 'name', 'body', 'notes', 'settings'],
    ['name', 'body', 'notes', 'settings']
  )
  const request: UpdateTemplateRequest = { id: readId(record.id, channel) }
  if (has(record, 'name')) request.name = readPlainString(record.name, channel)
  if (has(record, 'body')) request.body = readTemplateBody(record.body, channel)
  if (has(record, 'notes')) request.notes = readNotes(record.notes, channel)
  if (has(record, 'settings')) {
    request.settings = readTemplateSettingsRequest(record.settings, channel)
  }
  return request
}

export function parseTemplateUsage(
  value: unknown,
  channel: 'templates:usage' | 'templates:usageDetail' = 'templates:usage'
): TemplateUsageRequest {
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id', 'projectId'], ['projectId'])
  const request: TemplateUsageRequest = { id: readId(record.id, channel) }
  if (has(record, 'projectId')) request.projectId = readId(record.projectId, channel)
  return request
}

export function parsePlaygroundAio(value: unknown): PlaygroundAioRequest {
  const channel = 'playground:checkAio'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['url', 'prompts', 'market', 'runId'])
  return {
    url: readHttpUrl(record.url, channel),
    prompts: readAioPrompts(record.prompts, channel),
    market: readAioMarket(record.market, channel),
    runId: readNullableId(record.runId, channel)
  }
}

export function parseSavePlayground(value: unknown): SavePlaygroundRunRequest {
  const channel = 'playground:saveToProject'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['runId', 'projectId', 'parts'])
  const parts = readSaveParts(record.parts, channel)
  const [first, ...rest] = parts
  if (first === undefined) throw new IpcRequestError(channel)
  return {
    runId: readId(record.runId, channel),
    projectId: readId(record.projectId, channel),
    parts: [first, ...rest]
  }
}

export function parsePlaygroundRun(value: unknown): PlaygroundRunRequest {
  const channel = 'playground:run'
  const record = plainObject(value, channel)
  requireKeys(
    record,
    channel,
    ['url', 'templateId', 'templateIds', 'kind', 'overrides'],
    ['templateId', 'templateIds', 'kind']
  )
  const request: PlaygroundRunRequest = {
    url: readHttpUrl(record.url, channel),
    overrides: readOverrides(record.overrides, channel)
  }
  if (has(record, 'templateId')) request.templateId = readId(record.templateId, channel)
  if (has(record, 'templateIds')) request.templateIds = readTemplateIds(record.templateIds, channel)
  if (has(record, 'kind')) request.kind = readTemplateKind(record.kind, channel)
  return request
}

export function assertNoArgs(channel: IpcInvokeChannel, args: readonly unknown[]): void {
  if (args.length !== 0) throw new IpcRequestError(channel)
}

function plainObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function requireKeys(
  record: Record<string, unknown>,
  channel: string,
  allowed: readonly string[],
  optional: readonly string[] = []
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of allowed) {
    if (optional.includes(key)) continue
    if (!has(record, key)) throw new IpcRequestError(channel)
  }
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function readLabel(value: unknown, channel: string, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value
  ) {
    throw new IpcRequestError(channel)
  }
  if (hasControlCharacter(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableLabel(value: unknown, channel: string, max: number): string | null {
  if (value === null) return null
  return readLabel(value, channel, max)
}

function readBoolean(value: unknown, channel: string): boolean {
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function readDomain(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const domain = value.toLowerCase()
  if (!DOMAIN.test(domain) || domain.length > 253) throw new IpcRequestError(channel)
  return domain
}

function readCountry(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !isCountryCode(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableCountry(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readCountry(value, channel)
}

function readLanguage(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !isLanguageTag(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableLanguage(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readLanguage(value, channel)
}

function readDevice(value: unknown, channel: string): MarketDevice {
  if (typeof value !== 'string' || !isMarketDevice(value)) throw new IpcRequestError(channel)
  return value
}

function readNameList(value: unknown, channel: string, required: boolean): string[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  if (required && value.length === 0) throw new IpcRequestError(channel)
  const seen = new Set<string>()
  const names: string[] = []
  for (const entry of value) {
    const name = readLabel(entry, channel, 80)
    if (seen.has(name)) throw new IpcRequestError(channel)
    seen.add(name)
    names.push(name)
  }
  return names
}

function readProvider(value: unknown, channel: string): ApiKeyProvider {
  if (typeof value !== 'string' || !isApiKeyProvider(value)) throw new IpcRequestError(channel)
  return value
}

function readSecret(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET_LENGTH) {
    throw new IpcRequestError(channel)
  }
  if (value.includes('\0')) throw new IpcRequestError(channel)
  return value
}

function readCap(value: unknown, channel: string): number | null {
  if (value === null) return null
  return readInteger(value, channel, 0, 1_000_000_000)
}

function readProjectIds(value: unknown, channel: string): string[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const entry of value) {
    const id = readId(entry, channel)
    if (seen.has(id)) throw new IpcRequestError(channel)
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readBinaryPath(value: unknown, channel: string): string | null {
  if (value === null) return null
  const filePath = readLabel(value, channel, 1024)
  const problem = claudeBinaryPathProblem(filePath)
  if (problem !== null) {
    throw new IpcRequestError(
      channel,
      problem,
      'Choose the claude program, for example ~/.local/bin/claude, or leave the path empty to search.'
    )
  }
  return filePath
}

function readCodexBinaryPath(value: unknown, channel: string): string | null {
  if (value === null) return null
  const filePath = readLabel(value, channel, 1024)
  const problem = codexBinaryPathProblem(filePath)
  if (problem !== null) {
    throw new IpcRequestError(
      channel,
      problem,
      'Choose the codex program, for example ~/.local/bin/codex, or leave the path empty to search.'
    )
  }
  return filePath
}

function readInterval(value: unknown, channel: string): IntervalDays {
  if (typeof value !== 'number' || !isIntervalDays(value)) throw new IpcRequestError(channel)
  return value
}

function readSamples(value: unknown, channel: string): SampleCount {
  if (typeof value !== 'number' || !isSampleCount(value)) throw new IpcRequestError(channel)
  return value
}

function readInteger(value: unknown, channel: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readModel(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !MODEL.test(value)) throw new IpcRequestError(channel)
  return value
}

function readClaudeProvider(value: unknown, channel: string): ClaudeProvider {
  if (typeof value !== 'string' || !isClaudeProvider(value)) throw new IpcRequestError(channel)
  return value
}

function readJinaMode(value: unknown, channel: string): JinaMode {
  if (typeof value !== 'string' || !isJinaMode(value)) throw new IpcRequestError(channel)
  return value
}

/** FR-11.2. The other modes stay in the type so the UI can show them disabled. */
/** FR-11.2. Any of the three rotation modes. */
function readSavedRotation(value: unknown, channel: string): SerpApiRotationMode {
  if (typeof value !== 'string' || !isSerpApiRotationMode(value)) throw new IpcRequestError(channel)
  return value
}

function readReorderIds(value: unknown, channel: string): string[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  return value.map((entry) => readId(entry, channel))
}

function readTemplateKind(value: unknown, channel: string): CreateTemplateRequest['kind'] {
  if (typeof value !== 'string' || !isGenerationTemplateKind(value)) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readPlainString(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  if (hasControlCharacter(value)) throw new IpcRequestError(channel)
  return value
}

function readTemplateBody(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > 500_000 || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readNotes(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readPlainString(value, channel)
}

function readHttpUrl(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    throw new IpcRequestError(channel)
  }
  if (value.includes('\0')) throw new IpcRequestError(channel)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new IpcRequestError(channel)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new IpcRequestError(channel)
  return value
}

function readTemplateIds(value: unknown, channel: string): string[] {
  if (!Array.isArray(value)) throw new IpcRequestError(channel)
  return value.map((entry) => readId(entry, channel))
}

function readOverrides(value: unknown, channel: string): PlaygroundOverrides | null {
  if (value === null) return null
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['body', 'promptCount', 'brandName'])
  return {
    body: readOverrideBody(record.body, channel),
    promptCount: readOverrideCount(record.promptCount, channel),
    brandName: readNullableLabel(record.brandName, channel, 200)
  }
}

function readOverrideBody(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readTemplateBody(value, channel)
}

function readOverrideCount(value: unknown, channel: string): number | null {
  if (value === null) return null
  return readPromptCount(value, channel)
}

function readNullableId(value: unknown, channel: string): string | null {
  if (value === null) return null
  return readId(value, channel)
}

/** A playground check is one or more prompt strings. An empty string is allowed. */
function readAioPrompts(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROMPT_COUNT) {
    throw new IpcRequestError(channel)
  }
  return value.map((entry) => readAioPrompt(entry, channel))
}

function readAioPrompt(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > 2000 || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  if (hasControlCharacter(value)) throw new IpcRequestError(channel)
  return value
}

function readAioMarket(value: unknown, channel: string): MarketDraft | null {
  if (value === null) return null
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['country', 'language', 'location', 'device', 'localWording'])
  return {
    country: readCountry(record.country, channel),
    language: readLanguage(record.language, channel),
    location: readNullableLabel(record.location, channel, 120),
    device: readDevice(record.device, channel),
    localWording: readBoolean(record.localWording, channel)
  }
}

function readSaveParts(
  value: unknown,
  channel: string
): SavePlaygroundRunRequest['parts'][number][] {
  if (!Array.isArray(value) || value.length === 0) throw new IpcRequestError(channel)
  const seen = new Set<string>()
  const parts: SavePlaygroundRunRequest['parts'][number][] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !isPlaygroundSavePart(entry) || seen.has(entry)) {
      throw new IpcRequestError(channel)
    }
    seen.add(entry)
    parts.push(entry)
  }
  return parts
}

function readPromptCount(value: unknown, channel: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > MAX_PROMPT_COUNT) {
    throw new IpcRequestError(channel, `The maximum prompt count is ${MAX_PROMPT_COUNT}.`)
  }
  return readInteger(value, channel, 1, MAX_PROMPT_COUNT)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export type { AppSettings }
