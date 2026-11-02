import type {
  CreatedTopicResult,
  CreateEmptyTopicRequest,
  DuplicateTopicRequest
} from '@shared/ipc'
import { getPage, listPageMarkets, listPagesOfKind } from '../../storage/pages'
import { getMarket } from '../../storage/project-profile'
import { createDraft, saveDraft, TopicInputError } from '../drafts'
import type { OpenedProject, TopicEnv } from '../env'
import { getTopic } from '../records'
import { holdIntervalCheck, writeTopic } from '../start'
import { questionsWord } from './transfer'

/**
 * Topics made from nothing or from another topic (feat/crud): "+ New empty
 * topic" and "Duplicate". Both are written the way Start writes a topic
 * (`writeTopic`) with the interval check held one interval out, so nothing
 * spends a search until Check now. An empty topic is never scheduled until it
 * has a question (scheduler `isOpenForSchedule`).
 */

const NAME_MAX = 120

function deps(env: TopicEnv): { now: () => Date; createId: () => string } {
  return { now: () => env.host.now(), createId: () => env.host.createId() }
}

/** `topics:createEmpty`. */
export function createEmptyTopic(
  env: TopicEnv,
  opened: OpenedProject,
  request: CreateEmptyTopicRequest
): CreatedTopicResult {
  const { db, project } = opened
  const name = request.name.trim().slice(0, NAME_MAX)
  if (name.length === 0) throw new TopicInputError('Give the topic a name.')
  let topicId = ''
  db.transaction(() => {
    const draft = createDraft(
      db,
      project,
      { projectId: project.id, path: 'seed', name, seed: name },
      deps(env)
    )
    const marketIds =
      request.marketIds === undefined
        ? draft.marketIds
        : request.marketIds.filter((marketId) => getMarket(db, marketId) !== null)
    if (request.marketIds !== undefined && marketIds.length === 0) {
      throw new TopicInputError('Those markets are not in this project.')
    }
    const filled = { ...draft, name, marketIds }
    const written = writeTopic(env, opened, filled, [], filled.intervalDays, { allowEmpty: true })
    const now = env.host.now()
    holdIntervalCheck(db, written.topicId, now, filled.intervalDays)
    saveDraft(
      db,
      { ...filled, topicId: written.topicId, startedAt: now.toISOString(), step: 'estimate' },
      now
    )
    topicId = written.topicId
  })()
  return {
    topicId,
    name,
    questions: 0,
    message: `Created ${name}. Add its questions next; nothing is checked until it has some.`
  }
}

/** "Alerts" → "Alerts (copy)", "Alerts (copy 2)", … not taken by another topic. */
function copyName(opened: OpenedProject, base: string): string {
  const taken = new Set(
    listPagesOfKind(opened.db, opened.project.id, 'topic')
      .filter((page) => page.status !== 'removed')
      .map((page) => (page.title ?? '').toLowerCase())
  )
  const stem = base.slice(0, NAME_MAX - 10).trimEnd()
  for (let n = 1; n < 100; n += 1) {
    const candidate = n === 1 ? `${stem} (copy)` : `${stem} (copy ${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${stem} (copy)`
}

/** `topics:duplicate`. */
export function duplicateTopic(
  env: TopicEnv,
  opened: OpenedProject,
  request: DuplicateTopicRequest
): CreatedTopicResult {
  const { db, project } = opened
  const page = getPage(db, request.topicId, project.id)
  if (page === null || page.kind !== 'topic' || getTopic(db, request.topicId) === null) {
    throw new TopicInputError('That topic was not found.')
  }
  if (page.status === 'removed') throw new TopicInputError('That topic was deleted.')
  const name = (request.name ?? copyName(opened, page.title ?? 'Topic')).trim().slice(0, NAME_MAX)
  let topicId = ''
  let questions = 0
  db.transaction(() => {
    // The draft is filled from the topic (Edit topic does the same), then
    // made a new one: no topic id, fresh keys for every question.
    const source = createDraft(
      db,
      project,
      { projectId: project.id, path: 'seed', topicId: request.topicId },
      deps(env)
    )
    const marketIds = listPageMarkets(db, request.topicId).map((market) => market.marketId)
    const prompts = source.prompts.map((prompt) => ({
      ...prompt,
      id: `tp-${env.host.createId()}`,
      included: true
    }))
    const filled = { ...source, topicId: null, name, marketIds, prompts }
    const written = writeTopic(env, opened, filled, prompts, filled.intervalDays, {
      allowEmpty: true
    })
    const now = env.host.now()
    holdIntervalCheck(db, written.topicId, now, filled.intervalDays)
    saveDraft(
      db,
      { ...filled, topicId: written.topicId, startedAt: now.toISOString(), step: 'estimate' },
      now
    )
    topicId = written.topicId
    questions = prompts.length
  })()
  return {
    topicId,
    name,
    questions,
    message: `Made ${name} with ${questionsWord(questions)}. Nothing is checked until you press Check now.`
  }
}
