import {
  isGapStatus,
  type GapStates,
  type PageIdRequest,
  type SetGapStatusRequest,
  type UpdateGapDraftRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { PipelineError } from '../pipeline/errors'
import { getLatestCoverage, getLatestSnapshot, updateCoverageRow } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import {
  GAP_FAQ_ANSWER_MAX,
  GAP_FAQ_QUESTION_MAX,
  listGapStates,
  writeGapState
} from '../storage/gap-states'
import type { EngineHost } from './host'
import { requirePage } from './page-access'
import { withProject } from './project-db'

/**
 * Content gap edits (Content gaps tab): the person's FAQ draft per prompt and
 * where each gap stands. Claude's draft stays on the matrix row, so a reset
 * shows it again; published and verified rows are marked done on the matrix
 * too, so every screen that counts open gaps agrees.
 */

export function getGapStates(host: EngineHost, request: PageIdRequest): Promise<GapStates> {
  const channel = 'gaps:getStates'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    return { pageId: request.pageId, states: listGapStates(opened.db, request.pageId) }
  })
}

export function updateGapDraft(
  host: EngineHost,
  request: UpdateGapDraftRequest
): Promise<GapStates> {
  const channel = 'gaps:updateDraft'
  return withProject(host, request.projectId, channel, (opened) => {
    requirePage(opened.db, request.pageId, request.projectId, channel)
    requireMatrixPrompt(opened.db, request.pageId, request.promptId)
    const faq = request.reset ? null : { question: request.question, answer: request.answer }
    writeGapState(opened.db, request.pageId, request.promptId, { faq }, host.now().toISOString())
    return { pageId: request.pageId, states: listGapStates(opened.db, request.pageId) }
  })
}

export function setGapStatus(host: EngineHost, request: SetGapStatusRequest): Promise<GapStates> {
  const channel = 'gaps:setStatus'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db } = opened
    requirePage(db, request.pageId, request.projectId, channel)
    const matrix = requireMatrix(db, request.pageId)
    const at = host.now().toISOString()
    db.transaction(() => {
      for (const promptId of request.promptIds) {
        const row = matrix.rows.find((item) => item.promptId === promptId)
        if (row === undefined) throw notInMatrix()
        const done = request.status !== 'open'
        if (row.done !== done) updateCoverageRow(db, { ...row, done })
        writeGapState(
          db,
          request.pageId,
          promptId,
          {
            status: request.status,
            ...(request.status === 'open'
              ? { publishedUrl: null }
              : request.publishedUrl !== undefined
                ? { publishedUrl: request.publishedUrl }
                : {})
          },
          at
        )
      }
    })()
    return { pageId: request.pageId, states: listGapStates(db, request.pageId) }
  })
}

function requireMatrix(
  db: SqliteDatabase,
  pageId: string
): NonNullable<ReturnType<typeof getLatestCoverage>> {
  const matrix = getLatestCoverage(db, pageId, getLatestSnapshot(db, pageId)?.contentHash ?? null)
  if (matrix === null) {
    throw new PipelineError('There is no coverage matrix yet.', {
      code: 'not_found',
      nextStep: 'Write the content gaps, then edit a row.'
    })
  }
  return matrix
}

function requireMatrixPrompt(db: SqliteDatabase, pageId: string, promptId: string): void {
  if (!requireMatrix(db, pageId).rows.some((row) => row.promptId === promptId)) throw notInMatrix()
}

function notInMatrix(): PipelineError {
  return new PipelineError('That prompt is not in this matrix.', {
    code: 'not_found',
    nextStep: 'Choose a prompt from this matrix.'
  })
}

// ---- request parsing ----

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

function record(
  value: unknown,
  channel: string,
  keys: readonly string[],
  optional: readonly string[]
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const out = value as Record<string, unknown>
  for (const key of Object.keys(out)) {
    if (!keys.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of keys) {
    if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(out, key)) {
      throw new IpcRequestError(channel)
    }
  }
  return out
}

function id(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}

function text(value: unknown, channel: string, max: number, allowEmpty: boolean): string {
  if (typeof value !== 'string') throw new IpcRequestError(channel)
  const trimmed = value.trim()
  if ((!allowEmpty && trimmed.length === 0) || trimmed.length > max) {
    throw new IpcRequestError(channel)
  }
  return trimmed
}

function httpUrl(value: unknown, channel: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2000) {
    throw new IpcRequestError(channel)
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new IpcRequestError(channel)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new IpcRequestError(channel)
  if (url.username !== '' || url.password !== '') throw new IpcRequestError(channel)
  return url.href
}

export function parseUpdateGapDraft(value: unknown): UpdateGapDraftRequest {
  const channel = 'gaps:updateDraft'
  const input = record(
    value,
    channel,
    ['projectId', 'pageId', 'promptId', 'question', 'answer', 'reset'],
    ['reset']
  )
  const reset = input.reset === undefined ? false : input.reset
  if (typeof reset !== 'boolean') throw new IpcRequestError(channel)
  return {
    projectId: id(input.projectId, channel),
    pageId: id(input.pageId, channel),
    promptId: id(input.promptId, channel),
    question: text(input.question, channel, GAP_FAQ_QUESTION_MAX, reset),
    answer: text(input.answer, channel, GAP_FAQ_ANSWER_MAX, reset),
    reset
  }
}

export function parseSetGapStatus(value: unknown): SetGapStatusRequest {
  const channel = 'gaps:setStatus'
  const input = record(
    value,
    channel,
    ['projectId', 'pageId', 'promptIds', 'status', 'publishedUrl'],
    ['publishedUrl']
  )
  if (!isGapStatus(input.status)) throw new IpcRequestError(channel)
  if (
    !Array.isArray(input.promptIds) ||
    input.promptIds.length === 0 ||
    input.promptIds.length > 1000
  ) {
    throw new IpcRequestError(channel)
  }
  const promptIds = [...new Set(input.promptIds.map((item: unknown) => id(item, channel)))]
  return {
    projectId: id(input.projectId, channel),
    pageId: id(input.pageId, channel),
    promptIds,
    status: input.status,
    ...(input.publishedUrl !== undefined
      ? { publishedUrl: httpUrl(input.publishedUrl, channel) }
      : {})
  }
}
