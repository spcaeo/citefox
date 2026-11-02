import { isTopicStage, type TopicStage } from '@shared/domain'
import {
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_DROPPED_CHARS,
  IMPORT_MAX_PASTE_CHARS,
  IMPORT_MAX_ROWS,
  type ImportCommitRequest,
  type ImportDefaults,
  type ImportPickFileRequest,
  type ImportPreviewRequest,
  type ImportReadRequest,
  type ImportRules,
  type ImportSource,
  type ImportTemplateRequest,
  type ImportUndoRequest,
  type ImportValidateRequest
} from '@shared/ipc'
import {
  IMPORT_FIELDS,
  isImportEntity,
  type ImportEntity,
  type ImportStageWords
} from '@shared/import-fields'
import { IpcRequestError } from '../ipc-request'

/**
 * Request parsing for the importer. Every field is checked and unknown keys are
 * rejected; a bad request fails with the channel name only, like the other areas.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const TOKEN = /^[A-Za-z0-9._:-]{1,120}$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u
/** Keys a row may carry besides its entity's fields. */
const ROW_EXTRA_KEYS = ['stageRaw', 'marketRaw', 'createTopic', 'addMarket'] as const
const MAX_VALUE = 2000
const MAX_STAGE_WORDS = 200

type Rec = Record<string, unknown>

function rec(
  value: unknown,
  channel: string,
  allowed: readonly string[],
  optional: readonly string[] = []
): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new IpcRequestError(channel)
  const record = value as Rec
  for (const key of Object.keys(record))
    if (!allowed.includes(key)) throw new IpcRequestError(channel)
  for (const key of allowed) {
    if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(record, key)) {
      throw new IpcRequestError(channel)
    }
  }
  return record
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function nullableId(value: unknown, channel: string): string | null {
  return value === null ? null : id(value, channel)
}

function entity(value: unknown, channel: string): ImportEntity {
  if (!isImportEntity(value)) throw new IpcRequestError(channel)
  return value
}

function bool(value: unknown, channel: string): boolean {
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function str(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new IpcRequestError(channel)
  return value
}

function source(value: unknown, channel: string): ImportSource {
  const kind = (value as Rec | null)?.kind
  if (kind === 'paste') {
    const r = rec(value, channel, ['kind', 'text'])
    return { kind: 'paste', text: str(r.text, channel, IMPORT_MAX_PASTE_CHARS) }
  }
  if (kind === 'dropped') {
    const r = rec(value, channel, ['kind', 'name', 'data', 'sheet'])
    const name = str(r.name, channel, 260).trim()
    const data = str(r.data, channel, IMPORT_MAX_DROPPED_CHARS)
    if (name.length === 0 || /[\\/]/u.test(name) || !BASE64.test(data)) {
      throw new IpcRequestError(channel)
    }
    return {
      kind: 'dropped',
      name,
      data,
      sheet: r.sheet === null ? null : str(r.sheet, channel, 200)
    }
  }
  const r = rec(value, channel, ['kind', 'token', 'sheet'])
  if (r.kind !== 'file' || typeof r.token !== 'string' || !TOKEN.test(r.token))
    throw new IpcRequestError(channel)
  return {
    kind: 'file',
    token: r.token,
    sheet: r.sheet === null ? null : str(r.sheet, channel, 200)
  }
}

function mapping(value: unknown, channel: string, of: ImportEntity): (string | null)[] {
  if (!Array.isArray(value) || value.length > IMPORT_MAX_COLUMNS + 10)
    throw new IpcRequestError(channel)
  const fields = new Set(IMPORT_FIELDS[of].map((field) => field.id))
  return value.map((item: unknown) => {
    if (item === null) return null
    if (typeof item !== 'string' || !fields.has(item)) throw new IpcRequestError(channel)
    return item
  })
}

function stageWordsRecord(value: unknown, channel: string): ImportStageWords {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new IpcRequestError(channel)
  const entries = Object.entries(value as Rec)
  if (entries.length > MAX_STAGE_WORDS) throw new IpcRequestError(channel)
  const out: Record<string, TopicStage> = {}
  for (const [key, stage] of entries) {
    if (key.length === 0 || key.length > 60 || typeof stage !== 'string' || !isTopicStage(stage)) {
      throw new IpcRequestError(channel)
    }
    out[key] = stage
  }
  return out
}

function defaults(value: unknown, channel: string): ImportDefaults {
  const r = rec(value, channel, ['stage', 'page', 'market'])
  if (r.stage !== null && (typeof r.stage !== 'string' || !isTopicStage(r.stage)))
    throw new IpcRequestError(channel)
  return {
    stage: r.stage,
    page: r.page === null ? null : str(r.page, channel, MAX_VALUE).trim() || null,
    market: nullableId(r.market, channel)
  }
}

function rules(value: unknown, channel: string): ImportRules {
  const r = rec(value, channel, ['keywords'])
  return { keywords: bool(r.keywords, channel) }
}

function rowValues(value: unknown, channel: string, of: ImportEntity): Record<string, string> {
  const allowed = [...IMPORT_FIELDS[of].map((field) => field.id), ...ROW_EXTRA_KEYS]
  const r = rec(value, channel, allowed, allowed)
  const out: Record<string, string> = {}
  for (const [key, cell] of Object.entries(r)) out[key] = str(cell, channel, MAX_VALUE)
  return out
}

function rows<T>(value: unknown, channel: string, each: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > IMPORT_MAX_ROWS) throw new IpcRequestError(channel)
  return value.map(each)
}

export function parsePickFile(value: unknown): ImportPickFileRequest {
  const c = 'import:pickFile'
  const r = rec(value, c, ['entity'])
  return { entity: entity(r.entity, c) }
}

export function parseRead(value: unknown): ImportReadRequest {
  const c = 'import:read'
  const r = rec(value, c, ['projectId', 'entity', 'source', 'hasHeader'])
  return {
    projectId: id(r.projectId, c),
    entity: entity(r.entity, c),
    source: source(r.source, c),
    hasHeader: r.hasHeader === null ? null : bool(r.hasHeader, c)
  }
}

export function parsePreview(value: unknown): ImportPreviewRequest {
  const c = 'import:preview'
  const r = rec(value, c, [
    'projectId',
    'entity',
    'sourceId',
    'mapping',
    'stageWords',
    'defaults',
    'rules',
    'targetId',
    'saveMapping'
  ])
  const of = entity(r.entity, c)
  return {
    projectId: id(r.projectId, c),
    entity: of,
    sourceId: id(r.sourceId, c),
    mapping: mapping(r.mapping, c, of),
    stageWords: stageWordsRecord(r.stageWords, c),
    defaults: defaults(r.defaults, c),
    rules: rules(r.rules, c),
    targetId: nullableId(r.targetId, c),
    saveMapping: bool(r.saveMapping, c)
  }
}

export function parseValidate(value: unknown): ImportValidateRequest {
  const c = 'import:validate'
  const r = rec(value, c, ['projectId', 'entity', 'targetId', 'rules', 'rows'])
  const of = entity(r.entity, c)
  return {
    projectId: id(r.projectId, c),
    entity: of,
    targetId: nullableId(r.targetId, c),
    rules: rules(r.rules, c),
    rows: rows(r.rows, c, (item) => {
      const row = rec(item, c, ['key', 'values', 'keep'], ['keep'])
      return {
        key: str(row.key, c, 80),
        values: rowValues(row.values, c, of),
        ...(row.keep === undefined ? {} : { keep: bool(row.keep, c) })
      }
    })
  }
}

export function parseCommit(value: unknown): ImportCommitRequest {
  const c = 'import:commit'
  const r = rec(value, c, ['projectId', 'entity', 'targetId', 'rules', 'rows'])
  const of = entity(r.entity, c)
  return {
    projectId: id(r.projectId, c),
    entity: of,
    targetId: nullableId(r.targetId, c),
    rules: rules(r.rules, c),
    rows: rows(r.rows, c, (item) => {
      const row = rec(item, c, ['values', 'keep'])
      return { values: rowValues(row.values, c, of), keep: bool(row.keep, c) }
    })
  }
}

export function parseUndo(value: unknown): ImportUndoRequest {
  const c = 'import:undo'
  const r = rec(value, c, ['projectId', 'batchId'])
  return { projectId: id(r.projectId, c), batchId: id(r.batchId, c) }
}

export function parseTemplate(value: unknown): ImportTemplateRequest {
  const c = 'import:template'
  const r = rec(value, c, ['entity', 'format'])
  if (r.format !== 'csv' && r.format !== 'xlsx') throw new IpcRequestError(c)
  return { entity: entity(r.entity, c), format: r.format }
}
