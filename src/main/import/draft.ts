import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isTopicStage } from '@shared/domain'
import {
  QUESTIONS_DRAFT_MAX_ROWS,
  type ImportDraftRequest,
  type QuestionsDraft,
  type QuestionsDraftOrigin,
  type QuestionsDraftRow,
  type SaveQuestionsDraftRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { atomicWriteFile } from '../storage/atomic-file'

/**
 * Add questions' unsaved rows (W3I-C4), one JSON file per project in the app's
 * data folder (`question-drafts/<projectId>.json`), written whole each time.
 * Kept until the rows are added or discarded, so a reload or a restart can
 * offer them again. Questions are not secrets; nothing else is stored.
 */

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const MAX_CELL = 2000
const ORIGINS: readonly QuestionsDraftOrigin[] = ['typed', 'suggested', 'imported', 'tracked']

type Rec = Record<string, unknown>

function rec(
  value: unknown,
  channel: string,
  keys: readonly string[],
  optional: readonly string[] = []
): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new IpcRequestError(channel)
  const record = value as Rec
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new IpcRequestError(channel)
  for (const key of keys) {
    if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(record, key))
      throw new IpcRequestError(channel)
  }
  return record
}

function projectId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function cell(value: unknown, channel: string): string {
  if (typeof value !== 'string' || value.length > MAX_CELL) throw new IpcRequestError(channel)
  return value
}

function flag(value: unknown, channel: string): boolean {
  if (typeof value !== 'boolean') throw new IpcRequestError(channel)
  return value
}

function nullableCell(value: unknown, channel: string): string | null {
  return value === null ? null : cell(value, channel)
}

function row(value: unknown, channel: string): QuestionsDraftRow {
  const r = rec(value, channel, [
    'question',
    'stage',
    'page',
    'market',
    'tags',
    'topic',
    'createTopic',
    'addMarket',
    'keep',
    'origin'
  ])
  const stage = cell(r.stage, channel)
  if (stage !== '' && !isTopicStage(stage)) throw new IpcRequestError(channel)
  const origin = r.origin
  if (typeof origin !== 'string' || !(ORIGINS as readonly string[]).includes(origin))
    throw new IpcRequestError(channel)
  return {
    question: cell(r.question, channel),
    stage,
    page: cell(r.page, channel),
    market: cell(r.market, channel),
    tags: cell(r.tags, channel),
    topic: cell(r.topic, channel),
    createTopic: flag(r.createTopic, channel),
    addMarket: flag(r.addMarket, channel),
    keep: flag(r.keep, channel),
    origin: origin as QuestionsDraftOrigin
  }
}

export function parseDraftRequest(value: unknown, channel: string): ImportDraftRequest {
  const r = rec(value, channel, ['projectId'])
  return { projectId: projectId(r.projectId, channel) }
}

export function parseSaveDraft(value: unknown): SaveQuestionsDraftRequest {
  const c = 'import:saveDraft'
  const r = rec(value, c, ['projectId', 'targetId', 'defaultPage', 'rows'])
  if (!Array.isArray(r.rows) || r.rows.length > QUESTIONS_DRAFT_MAX_ROWS)
    throw new IpcRequestError(c)
  const targetId = r.targetId === null ? null : projectId(r.targetId, c)
  return {
    projectId: projectId(r.projectId, c),
    targetId,
    defaultPage: nullableCell(r.defaultPage, c),
    rows: r.rows.map((item) => row(item, c))
  }
}

function draftFile(root: string, id: string): string {
  return join(root, 'question-drafts', `${id}.json`)
}

/** The saved draft, or null when there is none or the file cannot be read. */
export function readQuestionsDraft(root: string, id: string): QuestionsDraft | null {
  const file = draftFile(root, id)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Rec
    const savedAt = parsed.savedAt
    if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null
    const request: Rec = { ...parsed }
    delete request.savedAt
    const draft = parseSaveDraft(request)
    return draft.projectId === id && draft.rows.length > 0 ? { ...draft, savedAt } : null
  } catch {
    // A broken draft is not worth an error: Add questions starts empty.
    return null
  }
}

/** Saves the rows; an empty list clears the draft. */
export function writeQuestionsDraft(
  root: string,
  draft: SaveQuestionsDraftRequest,
  now: Date
): void {
  if (draft.rows.length === 0) {
    clearQuestionsDraft(root, draft.projectId)
    return
  }
  const saved: QuestionsDraft = { ...draft, savedAt: now.toISOString() }
  const file = draftFile(root, draft.projectId)
  mkdirSync(dirname(file), { recursive: true })
  atomicWriteFile(file, `${JSON.stringify(saved)}\n`)
}

export function clearQuestionsDraft(root: string, id: string): boolean {
  const file = draftFile(root, id)
  if (!existsSync(file)) return false
  rmSync(file, { force: true })
  return true
}
