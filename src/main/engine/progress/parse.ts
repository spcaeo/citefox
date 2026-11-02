import { isFixKind, isFixRecheckRule, type FixRecheckRule } from '@shared/domain'
import type {
  AddNoteRequest,
  CheckRunIdRequest,
  CompareContentRequest,
  CreateFixRequest,
  FixIdRequest,
  FixListRequest,
  FixPreviewRequest,
  HistoryListRequest,
  UpdateFixRequest,
  NoteIdRequest,
  UpdateNoteRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'

/**
 * Request parsing for the `fixes:*` and `history:*` channels. A malformed
 * request is refused with the channel name only, never its arguments (NFR-5).
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/** Prompts a fix can target: a page fix gathers its searches from several topics. */
const MAX_IDS = 500
const URL_MAX = 2000
export const FIX_TEXT_MAX = 4000

export function parseFixList(value: unknown): FixListRequest {
  const channel = 'fixes:list'
  const record = exact(value, channel, ['projectId', 'pageId'])
  return { projectId: readId(record.projectId, channel), pageId: readId(record.pageId, channel) }
}

export function parseFixPreview(value: unknown): FixPreviewRequest {
  const channel = 'fixes:preview'
  const record = exact(value, channel, [
    'projectId',
    'pageId',
    'goLiveAt',
    'promptIds',
    'marketIds'
  ])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    goLiveAt: readInstant(record.goLiveAt, channel),
    promptIds: readIds(record.promptIds, channel, true),
    marketIds: readIds(record.marketIds, channel, true)
  }
}

export function parseCreateFix(value: unknown): CreateFixRequest {
  const channel = 'fixes:create'
  const keys = ['projectId', 'pageId', 'description', 'goLiveAt', 'rule', 'promptIds', 'marketIds']
  const present = typeof value === 'object' && value !== null ? Object.keys(value) : []
  const hasKind = present.includes('kind')
  const optional = ['kind', 'url', 'pageFixId'].filter((key) => present.includes(key))
  const record = exact(value, channel, [...keys, ...optional])
  if (hasKind && !isFixKind(record.kind)) throw new IpcRequestError(channel)
  const description = readText(record.description, channel, 'Describe what you changed first')
  const promptIds = readIds(record.promptIds, channel, true)
  if (promptIds.length === 0) {
    throw new IpcRequestError(channel, 'Pick at least one prompt this fix should help')
  }
  const marketIds = readIds(record.marketIds, channel, true)
  if (marketIds.length === 0) throw new IpcRequestError(channel, 'Pick at least one market')
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    description,
    goLiveAt: readInstant(record.goLiveAt, channel),
    rule: readRule(record.rule, channel),
    promptIds,
    marketIds,
    ...(hasKind && isFixKind(record.kind) ? { kind: record.kind } : {}),
    ...(optional.includes('url') ? { url: readUrl(record.url, channel) } : {}),
    ...(optional.includes('pageFixId') ? { pageFixId: readId(record.pageFixId, channel) } : {})
  }
}

function readUrl(value: unknown, channel: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const url = value.trim()
  if (url.length === 0 || url.length > URL_MAX || /\s/u.test(url)) {
    throw new IpcRequestError(channel, 'Enter the page address, such as https://example.com/page')
  }
  return url
}

export function parseUpdateFix(value: unknown): UpdateFixRequest {
  const channel = 'fixes:update'
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const allowed = [
    'projectId',
    'fixId',
    'description',
    'kind',
    'goLiveAt',
    'rule',
    'promptIds',
    'marketIds'
  ]
  const record = value as Record<string, unknown>
  if (!Object.keys(record).every((key) => allowed.includes(key))) {
    throw new IpcRequestError(channel)
  }
  const request: {
    -readonly [K in keyof UpdateFixRequest]: UpdateFixRequest[K]
  } = {
    projectId: readId(record.projectId, channel),
    fixId: readId(record.fixId, channel)
  }
  if (record.description !== undefined) {
    request.description = readText(record.description, channel, 'Describe what you changed first')
  }
  if (record.kind !== undefined) {
    if (!isFixKind(record.kind)) throw new IpcRequestError(channel)
    request.kind = record.kind
  }
  if (record.goLiveAt !== undefined) request.goLiveAt = readInstant(record.goLiveAt, channel)
  if (record.rule !== undefined) request.rule = readRule(record.rule, channel)
  if (record.promptIds !== undefined) {
    const promptIds = readIds(record.promptIds, channel, true)
    if (promptIds.length === 0) {
      throw new IpcRequestError(channel, 'Pick at least one prompt this fix should help')
    }
    request.promptIds = promptIds
  }
  if (record.marketIds !== undefined) {
    const marketIds = readIds(record.marketIds, channel, true)
    if (marketIds.length === 0) throw new IpcRequestError(channel, 'Pick at least one market')
    request.marketIds = marketIds
  }
  return request
}

export function parseFixId(value: unknown, channel: string): FixIdRequest {
  const record = exact(value, channel, ['projectId', 'fixId'])
  return { projectId: readId(record.projectId, channel), fixId: readId(record.fixId, channel) }
}

export function parseHistoryList(value: unknown): HistoryListRequest {
  const channel = 'history:list'
  const record = exact(value, channel, ['projectId', 'pageId', 'marketId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    marketId: record.marketId === null ? null : readId(record.marketId, channel)
  }
}

export function parseCompareContent(value: unknown): CompareContentRequest {
  const channel = 'history:compare'
  const record = exact(value, channel, ['projectId', 'pageId', 'fromSnapshotId', 'toSnapshotId'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    fromSnapshotId: readId(record.fromSnapshotId, channel),
    toSnapshotId: readId(record.toSnapshotId, channel)
  }
}

export function parseAddNote(value: unknown): AddNoteRequest {
  const channel = 'history:addNote'
  const record = exact(value, channel, ['projectId', 'pageId', 'date', 'text'])
  return {
    projectId: readId(record.projectId, channel),
    pageId: readId(record.pageId, channel),
    date: readLocalDate(record.date, channel),
    text: readText(record.text, channel, 'Write the note first')
  }
}

export function parseUpdateNote(value: unknown): UpdateNoteRequest {
  const channel = 'history:updateNote'
  const record = exact(value, channel, ['projectId', 'noteId', 'date', 'text'])
  return {
    projectId: readId(record.projectId, channel),
    noteId: readId(record.noteId, channel),
    date: readLocalDate(record.date, channel),
    text: readText(record.text, channel, 'Write the note first')
  }
}

export function parseNoteId(value: unknown): NoteIdRequest {
  const channel = 'history:deleteNote'
  const record = exact(value, channel, ['projectId', 'noteId'])
  return { projectId: readId(record.projectId, channel), noteId: readId(record.noteId, channel) }
}

export function parseCheckRunId(value: unknown): CheckRunIdRequest {
  const channel = 'history:delete'
  const record = exact(value, channel, ['projectId', 'runId'])
  return { projectId: readId(record.projectId, channel), runId: readId(record.runId, channel) }
}

function exact(value: unknown, channel: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const present = Object.keys(record)
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    throw new IpcRequestError(channel)
  }
  return record
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function readIds(value: unknown, channel: string, unique: boolean): string[] {
  if (!Array.isArray(value) || value.length > MAX_IDS) throw new IpcRequestError(channel)
  const ids = value.map((item) => readId(item, channel))
  if (unique && new Set(ids).size !== ids.length) throw new IpcRequestError(channel)
  return ids
}

function readText(value: unknown, channel: string, empty: string): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const text = value.trim()
  if (text.length === 0) throw new IpcRequestError(channel, empty)
  if (text.length > FIX_TEXT_MAX) {
    throw new IpcRequestError(channel, `Keep it under ${FIX_TEXT_MAX} characters`)
  }
  return text
}

function readInstant(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new IpcRequestError(channel, 'Pick a valid date')
  }
  return new Date(value).toISOString()
}

function readLocalDate(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) {
    throw new IpcRequestError(channel, 'Pick a valid date')
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== (month ?? 0) - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new IpcRequestError(channel, 'Pick a valid date')
  }
  return value
}

function readRule(value: unknown, channel: string): FixRecheckRule {
  if (typeof value !== 'string' || !isFixRecheckRule(value)) throw new IpcRequestError(channel)
  return value
}
