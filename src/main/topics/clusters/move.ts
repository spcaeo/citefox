import { DEFAULT_TOPIC_BANDS, TOPIC_STAGES, TOPIC_STAGE_LABEL } from '@shared/domain'
import type { PageSummary, TopicStage } from '@shared/domain'
import type {
  MergeTopicRequest,
  MoveQuestionsRequest,
  MoveQuestionsResult,
  QuestionRef,
  SetQuestionStageRequest,
  SetQuestionStageResult,
  SkippedQuestion,
  SplitTopicRequest,
  SplitTopicResult
} from '@shared/ipc'
import { getLatestPromptSet } from '../../storage/content-records'
import { getPage, listPageMarkets, updateStoredPage } from '../../storage/pages'
import { TopicInputError } from '../drafts'
import type { OpenedProject, TopicEnv } from '../env'
import { cancelPendingTopicBatches, getTopic, listTopicPrompts } from '../records'
import { TopicNotFoundError } from '../results'
import {
  brandsOf,
  nameOf,
  questionsWord,
  transfer,
  type ResolvedDestination,
  type TopicLike,
  type TransferResult
} from './transfer'

/** A tracked or paused topic of this project, else TopicNotFoundError. */
function requireTopic(opened: OpenedProject, topicId: string): PageSummary {
  const page = getPage(opened.db, topicId, opened.project.id)
  if (page === null || page.kind !== 'topic' || getTopic(opened.db, topicId) === null) {
    throw new TopicNotFoundError()
  }
  return page
}

function requireLive(page: PageSummary): PageSummary {
  if (page.status === 'removed') {
    throw new TopicInputError(
      `${nameOf(page)} was deleted.`,
      'Pick another topic, or undo the delete on Topics.'
    )
  }
  return page
}

/** The settings a topic made from this one copies (split). */
function likeOf(opened: OpenedProject, page: PageSummary): TopicLike {
  const topic = getTopic(opened.db, page.id)
  return {
    seed: topic?.seed ?? nameOf(page),
    marketIds: listPageMarkets(opened.db, page.id).map((market) => market.marketId),
    intervalDays: page.intervalDays as TopicLike['intervalDays'],
    bands: topic?.bands ?? DEFAULT_TOPIC_BANDS
  }
}

function skippedLine(skipped: readonly SkippedQuestion[]): string {
  if (skipped.length === 0) return ''
  return ` ${questionsWord(skipped.length)} stayed where ${skipped.length === 1 ? 'it was' : 'they were'}.`
}

function moveMessage(moved: TransferResult, where: string): string {
  const done =
    moved.moved === 0 ? 'Nothing moved.' : `Moved ${questionsWord(moved.moved)} ${where}.`
  return `${done}${skippedLine(moved.skipped)}`
}

function toResult(moved: TransferResult, message: string): MoveQuestionsResult {
  return {
    moved: moved.moved,
    topicId: moved.topicId,
    promptIds: moved.promptIds,
    skipped: moved.skipped,
    message
  }
}

/** `topics:moveQuestions` (Docs/TOPICS-SPEC.md §8.4). */
export function moveQuestions(
  env: TopicEnv,
  opened: OpenedProject,
  request: MoveQuestionsRequest
): MoveQuestionsResult {
  const { to } = request
  let destination: ResolvedDestination
  let where: string
  if (to.kind === 'topic') {
    const page = requireLive(requireTopic(opened, to.topicId))
    destination = { kind: 'topic', page }
    where = `to ${nameOf(page)}`
  } else if (to.kind === 'new') {
    const name = to.name.trim()
    if (name.length === 0) throw new TopicInputError('Give the new topic a name.')
    destination = { kind: 'new', name, seed: name, like: null }
    where = `to the new topic ${name}`
  } else {
    destination = { kind: 'page' }
    where = 'out of their topics'
  }
  const moved = transfer(env, opened, request.items, destination)
  return toResult(moved, moveMessage(moved, where))
}

/**
 * `topics:setQuestionStage`. The stage is a label on the topic's row for the question,
 * set on every version of it (same stable key), so history groups the same way.
 * A page's question has no topic row and is skipped.
 */
export function setQuestionStage(
  _env: TopicEnv,
  opened: OpenedProject,
  request: SetQuestionStageRequest
): SetQuestionStageResult {
  const { db, project } = opened
  const brands = brandsOf(db)
  const skipped: SkippedQuestion[] = []
  const bySource = new Map<string, QuestionRef[]>()
  for (const item of request.items) {
    bySource.set(item.sourceId, [...(bySource.get(item.sourceId) ?? []), item])
  }
  const update = db.prepare(
    'UPDATE topic_prompts SET stage = ? WHERE page_id = ? AND stable_key = ?'
  )
  let changed = 0
  db.transaction(() => {
    for (const [sourceId, refs] of bySource) {
      const page = getPage(db, sourceId, project.id)
      const skipAll = (reason: string): void => {
        for (const ref of refs) skipped.push({ promptId: ref.promptId, reason })
      }
      if (page === null) {
        skipAll('That page or topic was not found.')
        continue
      }
      if (page.kind !== 'topic') {
        skipAll('Only a question in a topic has a stage. Move it into a topic first.')
        continue
      }
      const active = getLatestPromptSet(db, sourceId, brands)
      const rows = new Map(
        (active?.promptSetId ? listTopicPrompts(db, active.promptSetId) : []).map((row) => [
          row.promptId,
          row
        ])
      )
      for (const ref of refs) {
        const row = rows.get(ref.promptId)
        if (row === undefined) {
          skipped.push({
            promptId: ref.promptId,
            reason: 'That question is an older version. Reload and try again.'
          })
          continue
        }
        if (row.stage === request.stage) continue
        update.run(request.stage, sourceId, row.stableKey)
        changed += 1
      }
    }
  })()
  const label = request.stage === null ? 'No stage' : TOPIC_STAGE_LABEL[request.stage]
  const done = changed === 0 ? 'Nothing changed.' : `Set ${questionsWord(changed)} to ${label}.`
  return { changed, skipped, message: `${done}${skippedLine(skipped)}` }
}

function stageRefs(opened: OpenedProject, topicId: string, stage: TopicStage): QuestionRef[] {
  const active = getLatestPromptSet(opened.db, topicId, brandsOf(opened.db))
  if (!active?.promptSetId) return []
  return listTopicPrompts(opened.db, active.promptSetId)
    .filter((row) => row.stage === stage)
    .map((row) => ({ sourceId: topicId, promptId: row.promptId }))
}

function activeRefs(opened: OpenedProject, page: PageSummary): QuestionRef[] {
  const active = getLatestPromptSet(opened.db, page.id, brandsOf(opened.db))
  return (active?.prompts ?? []).map((prompt) => ({ sourceId: page.id, promptId: prompt.id }))
}

function removeTopic(env: TopicEnv, opened: OpenedProject, page: PageSummary): void {
  const current = getPage(opened.db, page.id, opened.project.id)
  if (current === null || current.status === 'removed') return
  updateStoredPage(opened.db, page.id, opened.project.id, { status: 'removed' })
  cancelPendingTopicBatches(opened.db, page.id, env.host.now().toISOString())
}

/**
 * `topics:merge`: every question of the topic moves into the other one, then the
 * topic is removed (a question already in the other topic is not copied twice).
 */
export function mergeTopic(
  env: TopicEnv,
  opened: OpenedProject,
  request: MergeTopicRequest
): MoveQuestionsResult {
  if (request.topicId === request.intoTopicId) {
    throw new TopicInputError('Pick a different topic to merge into.')
  }
  const from = requireTopic(opened, request.topicId)
  const into = requireLive(requireTopic(opened, request.intoTopicId))
  const moved = transfer(env, opened, activeRefs(opened, from), { kind: 'topic', page: into })
  const duplicates = moved.skipped.filter((item) => item.reason.startsWith('The same question'))
  const stuck = moved.skipped.length - duplicates.length
  if (stuck === 0) removeTopic(env, opened, from)
  const done = `Merged ${nameOf(from)} into ${nameOf(into)}: moved ${questionsWord(moved.moved)}.`
  const extra =
    duplicates.length === 0
      ? ''
      : ` ${questionsWord(duplicates.length)} ${duplicates.length === 1 ? 'was' : 'were'} already there.`
  const left =
    stuck === 0 ? '' : ` ${questionsWord(stuck)} could not move, so ${nameOf(from)} stays.`
  return toResult(moved, `${done}${extra}${left}`)
}

/**
 * `topics:split`: one new topic per journey stage, except the stage with most
 * questions (ties go to the earlier stage), which stays with the questions that have
 * no stage. New topics copy the markets, interval, bands and seed.
 */
export function splitTopic(
  env: TopicEnv,
  opened: OpenedProject,
  request: SplitTopicRequest
): SplitTopicResult {
  const page = requireLive(requireTopic(opened, request.topicId))
  const active = getLatestPromptSet(opened.db, page.id, brandsOf(opened.db))
  const rows = active?.promptSetId ? listTopicPrompts(opened.db, active.promptSetId) : []
  const byStage = new Map<TopicStage, number>()
  for (const row of rows) {
    if (row.stage !== null) byStage.set(row.stage, (byStage.get(row.stage) ?? 0) + 1)
  }
  if (byStage.size < 2) {
    throw new TopicInputError(
      'This topic has questions in fewer than two stages, so there is nothing to split.',
      'Set a stage on its questions first.'
    )
  }
  const ordered = TOPIC_STAGES.filter((stage) => byStage.has(stage))
  const keep = ordered.reduce((best, stage) =>
    (byStage.get(stage) ?? 0) > (byStage.get(best) ?? 0) ? stage : best
  )
  const like = likeOf(opened, page)
  const base = nameOf(page)
  const topics: SplitTopicResult['topics'][number][] = []
  for (const stage of ordered) {
    if (stage === keep) continue
    const name = `${base} · ${TOPIC_STAGE_LABEL[stage]}`.slice(0, 120)
    // Each move saves a new version of the topic, so read its current prompt ids again.
    const refs = stageRefs(opened, page.id, stage)
    const moved = transfer(env, opened, refs, { kind: 'new', name, seed: like.seed, like })
    if (moved.topicId !== null)
      topics.push({ topicId: moved.topicId, name, questions: moved.moved })
  }
  const kept = rows.length - topics.reduce((sum, topic) => sum + topic.questions, 0)
  return {
    topics,
    kept,
    message: `Split ${base} into ${topics.length + 1} topics. ${questionsWord(kept)} stayed in ${base}.`
  }
}
