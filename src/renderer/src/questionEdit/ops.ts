import type { IntentStage, PromptSource, TopicStage } from '@shared/domain'
import type {
  MoveDestination,
  QuestionDetail,
  QuestionRef,
  QuestionRestorePoint,
  QuestionUpdateAction
} from '@shared/ipc'
import { copyText } from '../components/clipboard'
import { errorText } from '../components/errorText'
import { notifyTopicsChanged } from '../topics/clusters'
import { showUndo } from '../ui'
import type { QuestionEditSource } from './source'

/** Most questions one `prompts:addQuestions` call takes (main `MAX_ADD_QUESTIONS`). */
export const COPY_CHUNK = 50

function count(n: number, one = 'question', many = 'questions'): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function reasonsLine(reasons: readonly string[]): string | null {
  const unique = [...new Set(reasons)]
  return unique.length === 0 ? null : unique.join(' ')
}

/** The Undo of a saved version: the earlier version becomes active again. */
export function restoreUndo(
  source: QuestionEditSource,
  projectId: string,
  points: readonly QuestionRestorePoint[]
): (() => Promise<void>) | undefined {
  if (points.length === 0) return undefined
  return async () => {
    const result = await source['questions:restore']({ projectId, points })
    notifyTopicsChanged()
    if (result.restored === 0) throw new Error(result.message)
  }
}

function fail(cause: unknown, fallback: string): null {
  showUndo({ message: errorText(cause, fallback, { sentence: true }) })
  return null
}

/**
 * Remove, pause or resume through `questions:update`, then the toast with Undo
 * (`questions:restore`). Every open screen reloads through the topics event.
 * Returns the changed count, or null when it failed (the toast says why).
 */
export async function updateQuestions(
  source: QuestionEditSource,
  projectId: string,
  action: QuestionUpdateAction,
  refs: readonly QuestionRef[]
): Promise<number | null> {
  if (refs.length === 0) return 0
  try {
    const result = await source['questions:update']({
      projectId,
      action,
      items: refs.map((ref) => ({ sourceId: ref.sourceId, promptId: ref.promptId }))
    })
    notifyTopicsChanged()
    const undo = result.changed > 0 ? restoreUndo(source, projectId, result.restore) : undefined
    showUndo({
      message: result.message,
      effect:
        reasonsLine(result.skipped.map((item) => item.reason)) ??
        (action === 'remove' ? 'Past results stay in History.' : null),
      ...(undo ? { undo } : {})
    })
    return result.changed
  } catch (cause) {
    return fail(cause, 'Could not change these questions.')
  }
}

/** One question to restage, with the stage it has now (for Undo). */
export interface StageItem extends QuestionRef {
  previous: TopicStage | null
}

/** Sets the topic stage; Undo puts each question's old stage back. */
export async function setStage(
  source: QuestionEditSource,
  projectId: string,
  items: readonly StageItem[],
  stage: TopicStage | null
): Promise<number | null> {
  if (items.length === 0) return 0
  try {
    const result = await source['topics:setQuestionStage']({
      projectId,
      items: items.map(({ sourceId, promptId }) => ({ sourceId, promptId })),
      stage
    })
    notifyTopicsChanged()
    const byPrevious = new Map<TopicStage | null, QuestionRef[]>()
    for (const item of items) {
      if (item.previous === stage) continue
      byPrevious.set(item.previous, [
        ...(byPrevious.get(item.previous) ?? []),
        { sourceId: item.sourceId, promptId: item.promptId }
      ])
    }
    showUndo({
      message: result.message,
      effect: reasonsLine(result.skipped.map((item) => item.reason)),
      ...(result.changed > 0 && byPrevious.size > 0
        ? {
            undo: async () => {
              for (const [previous, refs] of byPrevious) {
                await source['topics:setQuestionStage']({ projectId, items: refs, stage: previous })
              }
              notifyTopicsChanged()
            }
          }
        : {})
    })
    return result.changed
  } catch (cause) {
    return fail(cause, 'Could not set the stage.')
  }
}

/** A question to move, with where it is now (for Undo). */
export interface MoveItem extends QuestionRef {
  /** Topic it sits in, or null for a page's own question ("Not in a topic"). */
  fromTopicId: string | null
}

/**
 * Moves questions to a topic (or back to their pages). Undo moves each one back
 * to where it was: its topic, or its page.
 */
export async function moveQuestions(
  source: QuestionEditSource,
  projectId: string,
  items: readonly MoveItem[],
  to: MoveDestination
): Promise<number | null> {
  if (items.length === 0) return 0
  try {
    const result = await source['topics:moveQuestions']({
      projectId,
      items: items.map(({ sourceId, promptId }) => ({ sourceId, promptId })),
      to
    })
    notifyTopicsChanged()
    const moved = new Map(result.promptIds.map((pair) => [pair.from, pair.to]))
    const back = items.flatMap((item) => {
      const next = moved.get(item.promptId)
      return next === undefined ? [] : [{ item, promptId: next }]
    })
    showUndo({
      message: result.message,
      effect: reasonsLine(result.skipped.map((item) => item.reason)),
      ...(back.length > 0
        ? {
            undo: async () => {
              // Moved questions have new ids where they went; find where each one is now.
              const list = await source['questions:list']({ projectId })
              const where = new Map(list.rows.map((row) => [row.promptId, row.sourceId]))
              const groups = new Map<string, { to: MoveDestination; refs: QuestionRef[] }>()
              for (const { item, promptId } of back) {
                const sourceId = where.get(promptId)
                if (sourceId === undefined) continue
                const key = item.fromTopicId ?? 'page'
                const to: MoveDestination =
                  item.fromTopicId === null
                    ? { kind: 'page' }
                    : { kind: 'topic', topicId: item.fromTopicId }
                const group = groups.get(key) ?? { to, refs: [] as QuestionRef[] }
                group.refs.push({ sourceId, promptId })
                groups.set(key, group)
              }
              if (groups.size === 0) throw new Error('Those questions changed again since.')
              for (const group of groups.values()) {
                await source['topics:moveQuestions']({ projectId, items: group.refs, to: group.to })
              }
              notifyTopicsChanged()
            }
          }
        : {})
    })
    return result.moved
  } catch (cause) {
    return fail(cause, 'Could not move these questions.')
  }
}

/** A question to copy: its wording and facts. */
export interface CopyItem {
  text: string
  intentStage?: IntentStage
  source?: PromptSource
}

/**
 * Copies questions into another page or topic as new questions (saved at once, a
 * new prompt-set version there). Exact repeats of a question already there are
 * skipped. Undo removes the copies again. `verb` words the toast: "Copied", or
 * "Added" when the questions are new to the project (Track from "People also ask").
 */
export async function copyQuestions(
  source: QuestionEditSource,
  projectId: string,
  items: readonly CopyItem[],
  destination: { id: string; name: string },
  verb: 'Copied' | 'Added' = 'Copied'
): Promise<number | null> {
  if (items.length === 0) return 0
  try {
    const added: string[] = []
    const skipped: string[] = []
    for (let start = 0; start < items.length; start += COPY_CHUNK) {
      const chunk = items.slice(start, start + COPY_CHUNK)
      const result = await source['prompts:addQuestions']({
        projectId,
        pageId: destination.id,
        questions: chunk.map((item) => ({
          text: item.text,
          ...(item.intentStage ? { intentStage: item.intentStage } : {}),
          ...(item.source ? { source: item.source } : {})
        }))
      })
      added.push(...result.promptIds)
      skipped.push(...result.skipped)
    }
    notifyTopicsChanged()
    showUndo({
      message: `${verb} ${count(added.length)} to ${destination.name}.`,
      effect: skipped.length === 0 ? null : `${count(skipped.length)} already there, so left out.`,
      ...(added.length > 0
        ? {
            undo: async () => {
              const result = await source['questions:update']({
                projectId,
                action: 'remove',
                items: added.map((promptId) => ({ sourceId: destination.id, promptId }))
              })
              notifyTopicsChanged()
              if (result.changed === 0) {
                throw new Error(result.skipped[0]?.reason ?? 'The copies changed since.')
              }
            }
          }
        : {})
    })
    return added.length
  } catch (cause) {
    return fail(cause, 'Could not copy these questions.')
  }
}

/** Copies the wording to the clipboard and says so. */
export async function copyQuestionText(text: string): Promise<void> {
  const ok = await copyText(text)
  showUndo({ message: ok ? 'Copied the question.' : 'Could not copy the question.' })
}

/** Copies several questions, one per line. */
export async function copyQuestionTexts(texts: readonly string[]): Promise<void> {
  const ok = await copyText(texts.join('\n'))
  showUndo({ message: ok ? `Copied ${count(texts.length)}.` : 'Could not copy the questions.' })
}

/** The active version of each picked question, and how many were not found. */
export async function resolveQuestions(
  source: QuestionEditSource,
  projectId: string,
  refs: readonly QuestionRef[]
): Promise<{ found: QuestionDetail[]; missing: number }> {
  const settled = await Promise.allSettled(
    refs.map((ref) => source['questions:get']({ projectId, ...ref }))
  )
  const found: QuestionDetail[] = []
  const seen = new Set<string>()
  for (const item of settled) {
    if (item.status !== 'fulfilled') continue
    const key = `${item.value.sourceId}~${item.value.promptId}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push(item.value)
  }
  return { found, missing: refs.length - found.length }
}

/**
 * Sets a page question's buyer stage, one saved version per question. Undo puts
 * the versions back newest first, so each step finds the one it replaced.
 */
export async function setBuyerStage(
  source: QuestionEditSource,
  projectId: string,
  questions: readonly QuestionDetail[],
  stage: IntentStage
): Promise<number | null> {
  const todo = questions.filter((question) => question.intentStage !== stage)
  if (todo.length === 0) {
    showUndo({ message: 'They have that stage already.' })
    return 0
  }
  const points: QuestionRestorePoint[] = []
  try {
    for (const question of todo) {
      const result = await source['questions:edit']({
        projectId,
        sourceId: question.sourceId,
        promptId: question.promptId,
        intentStage: stage
      })
      if (result.restore) points.push(result.restore)
    }
  } catch (cause) {
    if (points.length === 0) return fail(cause, 'Could not set the stage.')
  }
  notifyTopicsChanged()
  const undo = restoreUndo(source, projectId, [...points].reverse())
  showUndo({
    message: `Set the stage of ${count(points.length)}.`,
    effect: points.length < todo.length ? 'Some could not be changed.' : null,
    ...(undo ? { undo } : {})
  })
  return points.length
}
