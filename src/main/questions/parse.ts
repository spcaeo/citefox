import { isIntentStage, isPromptSource, TOPIC_STAGES, type TopicStage } from '@shared/domain'
import { QUESTION_UPDATE_ACTIONS, type QuestionUpdateAction } from '@shared/ipc'
import type {
  QuestionEditRequest,
  QuestionGetRequest,
  QuestionsListRequest,
  QuestionsRestoreRequest,
  QuestionsUpdateRequest
} from '@shared/ipc'
import { plain, readId, requireKeys } from '../engine/grid/parse'
import { IpcRequestError } from '../ipc-request'

/** More than any project tracks; a bigger list is a renderer bug, not a request. */
const MAX_ITEMS = 5_000

export function parseQuestionsList(value: unknown): QuestionsListRequest {
  const channel = 'questions:list'
  const record = plain(value, channel)
  for (const key of Object.keys(record)) {
    if (key !== 'projectId' && key !== 'marketId') throw new IpcRequestError(channel)
  }
  const marketId = record.marketId
  return {
    projectId: readId(record.projectId, channel),
    marketId: marketId === undefined || marketId === null ? null : readId(marketId, channel)
  }
}

export function parseQuestionsUpdate(value: unknown): QuestionsUpdateRequest {
  const channel = 'questions:update'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'action', 'items'])
  const action = record.action
  if (
    typeof action !== 'string' ||
    !(QUESTION_UPDATE_ACTIONS as readonly string[]).includes(action)
  ) {
    throw new IpcRequestError(channel)
  }
  const items = record.items
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw new IpcRequestError(channel, 'Select at least one question')
  }
  return {
    projectId: readId(record.projectId, channel),
    action: action as QuestionUpdateAction,
    items: items.map((item) => {
      const entry = plain(item, channel)
      requireKeys(entry, channel, ['sourceId', 'promptId'])
      return {
        sourceId: readId(entry.sourceId, channel),
        promptId: readId(entry.promptId, channel)
      }
    })
  }
}

function optionalKeys(
  record: Record<string, unknown>,
  channel: string,
  required: readonly string[],
  optional: readonly string[]
): void {
  for (const key of Object.keys(record)) {
    if (!required.includes(key) && !optional.includes(key)) throw new IpcRequestError(channel)
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new IpcRequestError(channel)
  }
}

function readText(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) {
    throw new IpcRequestError(channel)
  }
  return value
}

export function parseQuestionGet(value: unknown): QuestionGetRequest {
  const channel = 'questions:get'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'sourceId', 'promptId'])
  return {
    projectId: readId(record.projectId, channel),
    sourceId: readId(record.sourceId, channel),
    promptId: readId(record.promptId, channel)
  }
}

export function parseQuestionEdit(value: unknown): QuestionEditRequest {
  const channel = 'questions:edit'
  const record = plain(value, channel)
  optionalKeys(
    record,
    channel,
    ['projectId', 'sourceId', 'promptId'],
    ['texts', 'label', 'source', 'intentStage', 'topicStage', 'enabled']
  )
  const request: QuestionEditRequest = {
    projectId: readId(record.projectId, channel),
    sourceId: readId(record.sourceId, channel),
    promptId: readId(record.promptId, channel)
  }
  const out = request as {
    -readonly [K in keyof QuestionEditRequest]: QuestionEditRequest[K]
  }
  if (record.texts !== undefined) {
    const texts = record.texts
    if (!Array.isArray(texts) || texts.length > 50) throw new IpcRequestError(channel)
    out.texts = texts.map((item) => {
      const entry = plain(item, channel)
      requireKeys(entry, channel, ['marketId', 'text'])
      return {
        marketId: readId(entry.marketId, channel),
        text: readText(entry.text, channel, 2000)
      }
    })
  }
  if (record.label !== undefined) out.label = readText(record.label, channel, 400)
  if (record.source !== undefined) {
    if (typeof record.source !== 'string' || !isPromptSource(record.source)) {
      throw new IpcRequestError(channel)
    }
    out.source = record.source
  }
  if (record.intentStage !== undefined) {
    if (typeof record.intentStage !== 'string' || !isIntentStage(record.intentStage)) {
      throw new IpcRequestError(channel)
    }
    out.intentStage = record.intentStage
  }
  if (record.topicStage !== undefined) {
    const stage = record.topicStage
    if (stage !== null && !(TOPIC_STAGES as readonly unknown[]).includes(stage)) {
      throw new IpcRequestError(channel)
    }
    out.topicStage = stage as TopicStage | null
  }
  if (record.enabled !== undefined) {
    if (typeof record.enabled !== 'boolean') throw new IpcRequestError(channel)
    out.enabled = record.enabled
  }
  return request
}

export function parseQuestionsRestore(value: unknown): QuestionsRestoreRequest {
  const channel = 'questions:restore'
  const record = plain(value, channel)
  requireKeys(record, channel, ['projectId', 'points'])
  const points = record.points
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_ITEMS) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: readId(record.projectId, channel),
    points: points.map((item) => {
      const entry = plain(item, channel)
      requireKeys(entry, channel, ['sourceId', 'promptSetId', 'replacedBy'])
      return {
        sourceId: readId(entry.sourceId, channel),
        promptSetId: readId(entry.promptSetId, channel),
        replacedBy: readId(entry.replacedBy, channel)
      }
    })
  }
}
