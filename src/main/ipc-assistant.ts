import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_ENTITY_KINDS,
  ASSISTANT_HISTORY_MAX,
  ASSISTANT_QUESTION_MAX,
  type AssistantActionKind,
  type AssistantAskRequest,
  type AssistantContextInput,
  type AssistantEntity,
  type AssistantEntityKind,
  type AssistantNumber,
  type AssistantTurn
} from '@shared/ipc'
import { IpcRequestError } from './ipc-request'

/**
 * The `assistant:ask` request parser. Same rules as `ipc-ai.ts`: an unknown
 * key, a wrong type or a bad id rejects the call naming the channel only.
 * Screen texts (labels, values, facts) are cleaned and capped rather than
 * rejected: they are copied from the screen and may hold line breaks.
 */

const CHANNEL = 'assistant:ask'
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/
const TEXT_MAX = 300
const LIST_MAX = 50

const CONTEXT_KEYS = [
  'screen',
  'screenLabel',
  'crumbs',
  'pageId',
  'topicId',
  'promptId',
  'marketId',
  'runId',
  'about',
  'entities',
  'selection',
  'filters',
  'numbers',
  'facts',
  'capabilities'
]

export function parseAssistantAsk(value: unknown): AssistantAskRequest {
  const record = plainObject(value)
  requireKeys(record, ['projectId', 'question', 'context', 'history'])
  const question = typeof record.question === 'string' ? record.question.trim() : ''
  if (question.length === 0 || question.length > ASSISTANT_QUESTION_MAX || hasControl(question)) {
    throw new IpcRequestError(CHANNEL, 'Ask a question of 1 to 500 characters.')
  }
  return {
    projectId: nullableId(record.projectId),
    question,
    context: readContext(record.context),
    history: readHistory(record.history)
  }
}

function readContext(value: unknown): AssistantContextInput {
  const record = plainObject(value)
  requireKeys(record, CONTEXT_KEYS)
  const screen = text(record.screen, 60)
  if (screen.length === 0 || !/^[a-z][a-z0-9.-]*$/.test(screen)) throw new IpcRequestError(CHANNEL)
  return {
    screen,
    screenLabel: text(record.screenLabel, 120),
    crumbs: list(record.crumbs, 8).map((item) => text(item, 120)),
    pageId: nullableId(record.pageId),
    topicId: nullableId(record.topicId),
    promptId: nullableId(record.promptId),
    marketId: nullableId(record.marketId),
    runId: nullableId(record.runId),
    about: record.about === null ? null : readEntity(record.about),
    entities: list(record.entities, LIST_MAX).map(readEntity),
    selection: list(record.selection, LIST_MAX).map(readEntity),
    filters: readFilters(record.filters),
    numbers: list(record.numbers, 30).map(readNumber),
    facts: list(record.facts, 12).map((item) => text(item, TEXT_MAX)),
    capabilities: list(record.capabilities, ASSISTANT_ACTION_KINDS.length).map(readCapability)
  }
}

function readEntity(value: unknown): AssistantEntity {
  const record = plainObject(value)
  requireKeys(record, ['kind', 'id', 'label', 'detail'])
  if (
    typeof record.kind !== 'string' ||
    !(ASSISTANT_ENTITY_KINDS as readonly string[]).includes(record.kind)
  ) {
    throw new IpcRequestError(CHANNEL)
  }
  return {
    kind: record.kind as AssistantEntityKind,
    id: nullableId(record.id),
    label: text(record.label, TEXT_MAX),
    detail: record.detail === null ? null : text(record.detail, TEXT_MAX)
  }
}

function readNumber(value: unknown): AssistantNumber {
  const record = plainObject(value)
  requireKeys(record, ['label', 'value', 'drill'])
  return {
    label: text(record.label, 120),
    value: text(record.value, 120),
    drill: record.drill === null ? null : text(record.drill, 200)
  }
}

function readCapability(value: unknown): AssistantActionKind {
  if (typeof value !== 'string' || !(ASSISTANT_ACTION_KINDS as readonly string[]).includes(value)) {
    throw new IpcRequestError(CHANNEL)
  }
  return value as AssistantActionKind
}

function readFilters(value: unknown): Record<string, string> {
  const record = plainObject(value)
  const entries = Object.entries(record)
  if (entries.length > 20) throw new IpcRequestError(CHANNEL)
  const out: Record<string, string> = {}
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,39}$/.test(key) || typeof item !== 'string') {
      throw new IpcRequestError(CHANNEL)
    }
    out[key] = text(item, 120)
  }
  return out
}

function readHistory(value: unknown): AssistantTurn[] {
  return list(value, ASSISTANT_HISTORY_MAX).map((item) => {
    const record = plainObject(item)
    requireKeys(record, ['question', 'answer'])
    return {
      question: text(record.question, ASSISTANT_QUESTION_MAX),
      answer: text(record.answer, 600)
    }
  })
}

function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new IpcRequestError(CHANNEL)
  return value
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new IpcRequestError(CHANNEL)

  const flat = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(CHANNEL)
  return value
}

function nullableId(value: unknown): string | null {
  return value === null ? null : readId(value)
}

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(CHANNEL)
  }
  return value as Record<string, unknown>
}

function requireKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new IpcRequestError(CHANNEL)
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new IpcRequestError(CHANNEL)
  }
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}
