import { isTopicStage, type TopicStage } from '@shared/domain'
import type {
  CreateEmptyTopicRequest,
  CreateFromDraftRequest,
  DuplicateTopicRequest,
  CreateTopicsRequest,
  MergeTopicRequest,
  MoveDestination,
  MoveQuestionsRequest,
  QuestionRef,
  SetQuestionStageRequest,
  SortCandidate,
  SortQuestionsRequest,
  SplitTopicRequest,
  SuggestTopicNameRequest,
  SuggestTopicsRequest,
  TopicIdeaQuestion
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { id, record, text } from '../parse'

/** Request parsers for the topics-and-clusters channels. Anything malformed is an `IpcRequestError`. */

/** More than any project tracks; a bigger list is a renderer bug, not a request. */
const MAX_ITEMS = 5_000
const MAX_TOPICS = 12
const MAX_IDEA_QUESTIONS = 40
const NAME_MAX = 120
const SITUATION_MAX = 500
const QUESTION_MAX = 500

type Raw = Record<string, unknown>

function only(raw: Raw, channel: string, keys: readonly string[]): void {
  for (const key of Object.keys(raw)) {
    if (!keys.includes(key)) throw new IpcRequestError(channel)
  }
}

export function parseRefs(value: unknown, channel: string, max = MAX_ITEMS): QuestionRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new IpcRequestError(channel, 'Select at least one question')
  }
  return value.map((item) => {
    const entry = record(item, channel)
    only(entry, channel, ['sourceId', 'promptId'])
    return { sourceId: id(entry, 'sourceId', channel), promptId: id(entry, 'promptId', channel) }
  })
}

function name(raw: Raw, key: string, channel: string): string {
  const value = text(raw, key, channel, 300, false).trim().replace(/\s+/gu, ' ')
  return value.slice(0, NAME_MAX).trimEnd()
}

function stage(value: unknown, channel: string): TopicStage {
  if (typeof value !== 'string' || !isTopicStage(value)) throw new IpcRequestError(channel)
  return value
}

function destination(value: unknown, channel: string): MoveDestination {
  const raw = record(value, channel)
  if (raw.kind === 'topic') {
    only(raw, channel, ['kind', 'topicId'])
    return { kind: 'topic', topicId: id(raw, 'topicId', channel) }
  }
  if (raw.kind === 'new') {
    only(raw, channel, ['kind', 'name'])
    return { kind: 'new', name: name(raw, 'name', channel) }
  }
  if (raw.kind === 'page') {
    only(raw, channel, ['kind'])
    return { kind: 'page' }
  }
  throw new IpcRequestError(channel)
}

export function parseMove(value: unknown): MoveQuestionsRequest {
  const channel = 'topics:moveQuestions'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'items', 'to'])
  return {
    projectId: id(raw, 'projectId', channel),
    items: parseRefs(raw.items, channel),
    to: destination(raw.to, channel)
  }
}

export function parseSetStage(value: unknown): SetQuestionStageRequest {
  const channel = 'topics:setQuestionStage'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'items', 'stage'])
  return {
    projectId: id(raw, 'projectId', channel),
    items: parseRefs(raw.items, channel),
    stage: raw.stage === null ? null : stage(raw.stage, channel)
  }
}

export function parseMerge(value: unknown): MergeTopicRequest {
  const channel = 'topics:merge'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'topicId', 'intoTopicId'])
  const request = {
    projectId: id(raw, 'projectId', channel),
    topicId: id(raw, 'topicId', channel),
    intoTopicId: id(raw, 'intoTopicId', channel)
  }
  if (request.topicId === request.intoTopicId) {
    throw new IpcRequestError(channel, 'Pick another topic to merge into')
  }
  return request
}

export function parseSplit(value: unknown): SplitTopicRequest {
  const channel = 'topics:split'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'topicId'])
  return { projectId: id(raw, 'projectId', channel), topicId: id(raw, 'topicId', channel) }
}

function ideaQuestions(value: unknown, channel: string): TopicIdeaQuestion[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IDEA_QUESTIONS) {
    throw new IpcRequestError(channel, 'A topic needs at least one question')
  }
  return value.map((item) => {
    const entry = record(item, channel)
    only(entry, channel, ['text', 'stage'])
    return {
      text: text(entry, 'text', channel, QUESTION_MAX, false).trim(),
      stage: stage(entry.stage, channel)
    }
  })
}

export function parseCreateTopics(value: unknown): CreateTopicsRequest {
  const channel = 'topics:createTopics'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'topics'])
  const topics = raw.topics
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > MAX_TOPICS) {
    throw new IpcRequestError(channel, 'Pick at least one topic')
  }
  return {
    projectId: id(raw, 'projectId', channel),
    topics: topics.map((item) => {
      const entry = record(item, channel)
      only(entry, channel, ['name', 'situation', 'questions', 'targetUrl'])
      const target = entry.targetUrl
      if (target !== null && target !== undefined && typeof target !== 'string') {
        throw new IpcRequestError(channel)
      }
      return {
        name: name(entry, 'name', channel),
        situation: text(entry, 'situation', channel, SITUATION_MAX).trim(),
        questions: ideaQuestions(entry.questions, channel),
        targetUrl:
          typeof target === 'string' && target.trim().length > 0
            ? text(entry, 'targetUrl', channel, 2000).trim()
            : null
      }
    })
  }
}

export function parseCreateFromDraft(value: unknown): CreateFromDraftRequest {
  const channel = 'topics:createFromDraft'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'draftId', 'moveIn'])
  return {
    projectId: id(raw, 'projectId', channel),
    draftId: id(raw, 'draftId', channel),
    ...(raw.moveIn === undefined || (Array.isArray(raw.moveIn) && raw.moveIn.length === 0)
      ? {}
      : { moveIn: parseRefs(raw.moveIn, channel) })
  }
}

export function parseSuggestTopics(value: unknown): SuggestTopicsRequest {
  const channel = 'topics:suggestTopics'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'avoid'])
  const avoid = raw.avoid
  if (avoid !== undefined && (!Array.isArray(avoid) || avoid.length > 50)) {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: id(raw, 'projectId', channel),
    ...(Array.isArray(avoid)
      ? {
          avoid: avoid.map((item) => {
            if (typeof item !== 'string' || item.length > 300) throw new IpcRequestError(channel)
            return item.trim()
          })
        }
      : {})
  }
}

function candidates(value: unknown, channel: string): SortCandidate[] {
  if (!Array.isArray(value) || value.length > 200) throw new IpcRequestError(channel)
  return value.map((item) => {
    const entry = record(item, channel)
    only(entry, channel, ['id', 'name', 'situation'])
    return {
      id: id(entry, 'id', channel),
      name: name(entry, 'name', channel),
      situation: text(entry, 'situation', channel, SITUATION_MAX).trim()
    }
  })
}

export function parseSortQuestions(value: unknown): SortQuestionsRequest {
  const channel = 'topics:sortQuestions'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'items', 'candidates', 'allowNew'])
  if (raw.allowNew !== undefined && typeof raw.allowNew !== 'boolean') {
    throw new IpcRequestError(channel)
  }
  return {
    projectId: id(raw, 'projectId', channel),
    items: parseRefs(raw.items, channel, 300),
    ...(raw.candidates === undefined ? {} : { candidates: candidates(raw.candidates, channel) }),
    ...(raw.allowNew === undefined ? {} : { allowNew: raw.allowNew })
  }
}

export function parseSuggestName(value: unknown): SuggestTopicNameRequest {
  const channel = 'topics:suggestName'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'items'])
  return { projectId: id(raw, 'projectId', channel), items: parseRefs(raw.items, channel, 300) }
}

function marketIdList(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new IpcRequestError(channel, 'Pick at least one market')
  }
  return [...new Set(value.map((item, index) => id({ [index]: item }, String(index), channel)))]
}

export function parseCreateEmpty(value: unknown): CreateEmptyTopicRequest {
  const channel = 'topics:createEmpty'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'name', 'marketIds'])
  if (typeof raw.name === 'string' && raw.name.trim().length === 0) {
    throw new IpcRequestError(channel, 'Give the topic a name')
  }
  const topicName = name(raw, 'name', channel)
  if (topicName.length === 0) throw new IpcRequestError(channel, 'Give the topic a name')
  return {
    projectId: id(raw, 'projectId', channel),
    name: topicName,
    ...(raw.marketIds === undefined ? {} : { marketIds: marketIdList(raw.marketIds, channel) })
  }
}

export function parseDuplicate(value: unknown): DuplicateTopicRequest {
  const channel = 'topics:duplicate'
  const raw = record(value, channel)
  only(raw, channel, ['projectId', 'topicId', 'name'])
  const topicName = raw.name === undefined ? undefined : name(raw, 'name', channel)
  return {
    projectId: id(raw, 'projectId', channel),
    topicId: id(raw, 'topicId', channel),
    ...(topicName === undefined || topicName.length === 0 ? {} : { name: topicName })
  }
}
