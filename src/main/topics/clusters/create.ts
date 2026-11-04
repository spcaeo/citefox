import { setTopicTargetPage } from '../records'
import type { TopicDraftPrompt } from '@shared/domain'
import type {
  CreateFromDraftRequest,
  CreateFromDraftResult,
  CreateTopicsRequest,
  CreateTopicsResult
} from '@shared/ipc'
import { getPageByUrl } from '../../storage/pages'
import { createDraft, newDraftPrompt, requireDraft, saveDraft, TopicInputError } from '../drafts'
import type { OpenedProject, TopicEnv } from '../env'
import { holdIntervalCheck, promptsInScope, writeTopic } from '../start'
import { moveQuestions } from './move'
import { brandsOf, questionsWord } from './transfer'

/**
 * Topics made without a check (Docs/TOPICS-SPEC.md §8.2 and §8.3). Each is written the
 * way Start writes a topic (`writeTopic`), and its interval check is held one interval
 * out, so nothing spends a search until Check now.
 */

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** `topics:createTopics`: one topic per ticked Suggest topics idea. */
export function createTopics(
  env: TopicEnv,
  opened: OpenedProject,
  request: CreateTopicsRequest
): CreateTopicsResult {
  const { db, project } = opened
  const brands = brandsOf(db)
  const deps = { now: () => env.host.now(), createId: () => env.host.createId() }
  const topicIds: string[] = []
  let questions = 0
  db.transaction(() => {
    for (const idea of request.topics) {
      const draft = createDraft(
        db,
        project,
        { projectId: project.id, path: 'seed', name: idea.name, seed: idea.situation || idea.name },
        deps
      )
      const target = idea.targetUrl === null ? null : getPageByUrl(db, idea.targetUrl, project.id)
      const seen = new Set<string>()
      const prompts: TopicDraftPrompt[] = []
      for (const question of idea.questions) {
        const prompt = newDraftPrompt(
          { kind: 'question', text: question.text, stage: question.stage, source: 'claude' },
          `tp-${env.host.createId()}`,
          brands
        )
        const key = prompt.text.toLowerCase()
        if (prompt.text.length === 0 || seen.has(key) || prompt.flags.includes('brand')) continue
        seen.add(key)
        prompts.push(
          target === null || target.kind === 'topic' || target.url === null
            ? prompt
            : {
                ...prompt,
                targetPageId: target.id,
                targetUrl: target.url,
                matchStatus: 'suggested',
                matchReason: 'CiteFox AI suggested this page for the topic.'
              }
        )
      }
      if (prompts.length === 0) {
        throw new TopicInputError(`${idea.name} has no question to save.`)
      }
      const filled = { ...draft, prompts }
      const written = writeTopic(env, opened, filled, prompts, filled.intervalDays)
      const now = env.host.now()
      // The idea's page is the topic's target page: the yardstick for "Right page".
      if (target !== null && target.kind !== 'topic' && target.url !== null) {
        setTopicTargetPage(db, written.topicId, target.url, now.toISOString())
      }
      holdIntervalCheck(db, written.topicId, now, filled.intervalDays)
      saveDraft(
        db,
        { ...filled, topicId: written.topicId, startedAt: now.toISOString(), step: 'estimate' },
        now
      )
      topicIds.push(written.topicId)
      questions += prompts.length
    }
  })()
  return {
    topicIds,
    questions,
    message: `Created ${plural(topicIds.length, 'topic', 'topics')} with ${questionsWord(questions)}. Nothing is checked until you press Check now.`
  }
}

/**
 * `topics:createFromDraft`: the New topic dialog's last step saves the draft as a
 * topic without a check, then moves in the tracked questions picked for it.
 */
export function createFromDraft(
  env: TopicEnv,
  opened: OpenedProject,
  request: CreateFromDraftRequest
): CreateFromDraftResult {
  const { db, project } = opened
  const draft = requireDraft(db, project.id, request.draftId)
  if (draft.startedAt !== null && draft.topicId !== null) {
    throw new TopicInputError('This topic is already saved.', 'Open it from Topics.')
  }
  const prompts = promptsInScope(draft, draft.generate)
  const moveIn = request.moveIn ?? []
  if (prompts.length === 0 && moveIn.length === 0) {
    throw new TopicInputError('Include at least one question.')
  }
  if (prompts.length === 0) {
    // Only tracked questions: the topic is made by moving them in.
    const name = (draft.name || draft.seed).trim()
    if (name.length === 0) throw new TopicInputError('Give the topic a name.')
    const moved = moveQuestions(env, opened, {
      projectId: project.id,
      items: moveIn,
      to: { kind: 'new', name }
    })
    if (moved.topicId === null) {
      throw new TopicInputError(moved.skipped[0]?.reason ?? 'None of those questions could move.')
    }
    saveDraft(
      db,
      { ...draft, topicId: moved.topicId, startedAt: env.host.now().toISOString() },
      env.host.now()
    )
    return {
      topicId: moved.topicId,
      questions: 0,
      moved: moved.moved,
      message: `Saved ${name} with ${questionsWord(moved.moved)} moved in. Nothing is checked until you press Check now.`
    }
  }
  const written = writeTopic(env, opened, draft, prompts, draft.intervalDays)
  const now = env.host.now()
  holdIntervalCheck(db, written.topicId, now, draft.intervalDays)
  saveDraft(
    db,
    { ...draft, topicId: written.topicId, startedAt: now.toISOString(), step: 'estimate' },
    now
  )
  let moved = 0
  if (moveIn.length > 0) {
    moved = moveQuestions(env, opened, {
      projectId: project.id,
      items: moveIn,
      to: { kind: 'topic', topicId: written.topicId }
    }).moved
  }
  const name = (draft.name || draft.seed).trim()
  const extra = moved === 0 ? '' : ` and ${questionsWord(moved)} moved in`
  return {
    topicId: written.topicId,
    questions: prompts.length,
    moved,
    message: `Saved ${name} with ${questionsWord(prompts.length)}${extra}. Nothing is checked until you press Check now.`
  }
}
