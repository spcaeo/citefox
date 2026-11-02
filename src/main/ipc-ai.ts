import {
  TEMPLATE_PROMPT_COUNT_MAX,
  isGenerationTemplateKind,
  isIntentStage,
  isPromptCheckStatus,
  isPromptMovement,
  isTemplateTone,
  type GenerationTemplateKind,
  type IntentStage,
  type PromptCheckStatus,
  type PromptMovement,
  type TemplateSettings
} from '@shared/domain'
import {
  ASK_QUESTION_MAX,
  ASSIST_INSTRUCTION_MAX,
  type AskFilterRequest,
  type AskFilters,
  type AskProjectRequest,
  type AskQuestionRequest,
  type AssistDescribeRequest,
  type AssistInputValue,
  type AssistRunRequest,
  type LlmCallsRequest,
  type LlmUsageRequest,
  type SaveTemplateOverrideRequest,
  type TemplateKindRequest,
  type TemplateStepsRequest,
  type TemplateVersionsRequest,
  type TryTemplateRequest
} from '@shared/ipc'
import { IpcRequestError } from './ipc-request'

/**
 * Request parsers for the template editor, assist, Claude usage and Ask CiteFox
 * channels. Same rules as `ipc-request.ts`: an unknown key, a wrong type, or a
 * control character rejects the call with a message that names the channel only.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const ASSIST_ID = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){1,2}$/
const INPUT_KEY = /^[a-z][A-Za-z0-9]{0,39}$/
const MODEL = /^[A-Za-z0-9._:-]{1,80}$/
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/
const DOMAIN = /^[a-z0-9.-]{1,253}$/

export function parseTemplateSteps(value: unknown): TemplateStepsRequest {
  const channel = 'templates:steps'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId'], ['projectId'])
  return has(record, 'projectId') ? { projectId: readId(record.projectId, channel) } : {}
}

export function parseTemplateKind(value: unknown, channel: string): TemplateKindRequest {
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId', 'kind'])
  return { projectId: readId(record.projectId, channel), kind: readKind(record.kind, channel) }
}

export function parseSaveOverride(value: unknown): SaveTemplateOverrideRequest {
  const channel = 'templates:saveOverride'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId', 'kind', 'body', 'settings'])
  return {
    projectId: readId(record.projectId, channel),
    kind: readKind(record.kind, channel),
    body: readBody(record.body, channel),
    settings: readTemplateSettingsRequest(record.settings, channel)
  }
}

export function parseTemplateVersions(value: unknown): TemplateVersionsRequest {
  const channel = 'templates:versions'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['id', 'projectId', 'kind'], ['id', 'projectId', 'kind'])
  // Exactly one of: `id` alone, or `projectId` with `kind`.
  const hasId = has(record, 'id')
  const hasProject = has(record, 'projectId')
  const hasKind = has(record, 'kind')
  if (hasId ? hasProject || hasKind : !(hasProject && hasKind)) {
    throw new IpcRequestError(channel)
  }
  if (hasId) return { id: readId(record.id, channel) }
  return { projectId: readId(record.projectId, channel), kind: readKind(record.kind, channel) }
}

export function parseTryTemplate(value: unknown): TryTemplateRequest {
  const channel = 'templates:try'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId', 'pageId', 'marketId', 'kind', 'body', 'settings'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    marketId: record.marketId === null ? null : readId(record.marketId, channel),
    kind: readKind(record.kind, channel),
    body: readBody(record.body, channel),
    settings: readTemplateSettingsRequest(record.settings, channel)
  }
}

/** FR-26.3 settings on a request. Every field is required; null means "default". */
export function readTemplateSettingsRequest(value: unknown, channel: string): TemplateSettings {
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['model', 'language', 'promptCount', 'tone'])
  const { model, language, promptCount, tone } = record
  if (model !== null && (typeof model !== 'string' || !MODEL.test(model))) {
    throw new IpcRequestError(channel)
  }
  if (language !== null && (typeof language !== 'string' || !LANGUAGE.test(language))) {
    throw new IpcRequestError(channel)
  }
  if (
    promptCount !== null &&
    (typeof promptCount !== 'number' ||
      !Number.isInteger(promptCount) ||
      promptCount < 1 ||
      promptCount > TEMPLATE_PROMPT_COUNT_MAX)
  ) {
    throw new IpcRequestError(channel)
  }
  if (tone !== null && (typeof tone !== 'string' || !isTemplateTone(tone))) {
    throw new IpcRequestError(channel)
  }
  return {
    model: model as string | null,
    language: language as string | null,
    promptCount: promptCount as number | null,
    tone: tone as TemplateSettings['tone']
  }
}

export function parseAssistDescribe(value: unknown): AssistDescribeRequest {
  const channel = 'assist:describe'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['assistId', 'projectId'])
  return {
    assistId: readAssistId(record.assistId, channel),
    projectId: record.projectId === null ? null : readId(record.projectId, channel)
  }
}

export function parseAssistRun(value: unknown): AssistRunRequest {
  const channel = 'assist:run'
  const record = plainObject(value, channel)
  requireKeys(record, channel, [
    'assistId',
    'projectId',
    'pageId',
    'marketId',
    'promptId',
    'inputs',
    'instruction'
  ])
  return {
    assistId: readAssistId(record.assistId, channel),
    projectId: readNullableId(record.projectId, channel),
    pageId: readNullableId(record.pageId, channel),
    marketId: readNullableId(record.marketId, channel),
    promptId: readNullableId(record.promptId, channel),
    inputs: readInputs(record.inputs, channel),
    instruction: readInstruction(record.instruction, channel)
  }
}

export function parseLlmUsage(value: unknown): LlmUsageRequest {
  const channel = 'llm:usage'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId'], ['projectId'])
  return has(record, 'projectId') ? { projectId: readId(record.projectId, channel) } : {}
}

export function parseLlmCalls(value: unknown): LlmCallsRequest {
  const channel = 'llm:calls'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId', 'templateKind'], ['projectId'])
  const templateKind = readKind(record.templateKind, channel)
  return has(record, 'projectId')
    ? { projectId: readId(record.projectId, channel), templateKind }
    : { templateKind }
}

export function parseAskQuestion(value: unknown): AskQuestionRequest {
  const channel = 'ask:question'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId', 'question'])
  const question = typeof record.question === 'string' ? record.question.trim() : ''
  if (question.length === 0 || question.length > ASK_QUESTION_MAX || hasControl(question, true)) {
    throw new IpcRequestError(channel, 'Ask a question of 1 to 500 characters.')
  }
  return { projectId: readId(record.projectId, channel), question }
}

export function parseAskFilter(value: unknown): AskFilterRequest {
  const channel = 'ask:filter'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId', 'filters'])
  return {
    projectId: readId(record.projectId, channel),
    filters: readAskFilters(record.filters, channel)
  }
}

export function parseAskProject(value: unknown): AskProjectRequest {
  const channel = 'ask:options'
  const record = plainObject(value, channel)
  requireKeys(record, channel, ['projectId'])
  return { projectId: readId(record.projectId, channel) }
}

/** Filters from the renderer or from Claude. Empty lists become null. */
export function readAskFilters(value: unknown, channel: string): AskFilters {
  const record = plainObject(value, channel)
  requireKeys(record, channel, [
    'pageIds',
    'marketIds',
    'statuses',
    'movements',
    'intentStages',
    'citedDomain',
    'text'
  ])
  return {
    pageIds: readList(record.pageIds, channel, (item) => ID.test(item)),
    marketIds: readList(record.marketIds, channel, (item) => ID.test(item)),
    statuses: readList(record.statuses, channel, isPromptCheckStatus) as PromptCheckStatus[] | null,
    movements: readList(record.movements, channel, isPromptMovement) as PromptMovement[] | null,
    intentStages: readList(record.intentStages, channel, isIntentStage) as IntentStage[] | null,
    citedDomain: readCitedDomain(record.citedDomain, channel),
    text: readFilterText(record.text, channel)
  }
}

function readList(
  value: unknown,
  channel: string,
  accept: (item: string) => boolean
): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > 50) throw new IpcRequestError(channel)
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !accept(item)) throw new IpcRequestError(channel)
    if (!items.includes(item)) items.push(item)
  }
  return items.length === 0 ? null : items
}

function readCitedDomain(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  if (domain.length === 0) return null
  if (!DOMAIN.test(domain)) throw new IpcRequestError(channel)
  return domain
}

function readFilterText(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > 200 || hasControl(value, false)) {
    throw new IpcRequestError(channel)
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function readInputs(value: unknown, channel: string): Record<string, AssistInputValue> {
  const record = plainObject(value, channel)
  const keys = Object.keys(record)
  if (keys.length > 30) throw new IpcRequestError(channel)
  const inputs: Record<string, AssistInputValue> = {}
  for (const key of keys) {
    if (!INPUT_KEY.test(key)) throw new IpcRequestError(channel)
    inputs[key] = readInputValue(record[key], channel)
  }
  return inputs
}

function readInputValue(value: unknown, channel: string): AssistInputValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new IpcRequestError(channel)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > 200_000 || value.includes('\0')) throw new IpcRequestError(channel)
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new IpcRequestError(channel)
    return value.map((item) => {
      if (typeof item !== 'string' || item.length > 20_000 || item.includes('\0')) {
        throw new IpcRequestError(channel)
      }
      return item
    })
  }
  throw new IpcRequestError(channel)
}

function readInstruction(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > ASSIST_INSTRUCTION_MAX) {
    throw new IpcRequestError(channel, 'Keep the instruction under 1,000 characters.')
  }
  if (hasControl(value, true)) throw new IpcRequestError(channel)
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function readAssistId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ASSIST_ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readKind(value: unknown, channel: string): GenerationTemplateKind {
  if (typeof value !== 'string' || !isGenerationTemplateKind(value)) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readBody(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > 500_000 || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  return value
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readNullableId(value: unknown, channel: string): string | null {
  return value === null ? null : readId(value, channel)
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

/** Control characters other than tab and newline (allowed where `lines` is true). */
function hasControl(value: string, lines: boolean): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (lines && (code === 9 || code === 10 || code === 13)) continue
    if (code <= 31 || code === 127) return true
  }
  return false
}
