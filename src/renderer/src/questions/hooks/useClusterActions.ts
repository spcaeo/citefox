import { useCallback } from 'react'
import type { TopicStage } from '@shared/domain'
import type { MoveDestination, QuestionRow, QuestionSource, TopicTarget } from '@shared/ipc'
import { pathOf, refsOf, stageLabel } from '../../topics/clusters'
import { countText } from '../model'
import type { QuestionsSource } from '../source'
import type { Perform } from './useQuestionActions'

/** One destination of a move and the questions going there. */
export interface MoveBatch {
  to: MoveDestination
  rows: readonly Pick<QuestionRow, 'sourceId' | 'promptId'>[]
}

export interface ClusterActions {
  /** Moves each batch with `topics:moveQuestions`, one call per destination. */
  move: (batches: readonly MoveBatch[]) => Promise<boolean>
  setStage: (rows: readonly QuestionRow[], stage: TopicStage | null) => Promise<boolean>
  /** Sets the target page of the topic questions; page questions are skipped. */
  setTarget: (rows: readonly QuestionRow[], target: TopicTarget) => Promise<boolean>
}

/**
 * The grouping's moves (Docs/TOPICS-SPEC.md §8): move to a topic, to "Not in a topic"
 * or into a new topic, set the journey stage, and set the target page. Each runs
 * through the screen's `perform`, so it ends with one sentence, the skipped reasons,
 * a reload and the topics-changed event.
 */
export function useClusterActions(
  source: QuestionsSource,
  projectId: string,
  sources: ReadonlyMap<string, QuestionSource>,
  perform: Perform
): ClusterActions {
  const move = useCallback(
    async (batches: readonly MoveBatch[]): Promise<boolean> => {
      const work = batches.filter((batch) => batch.rows.length > 0)
      if (work.length === 0) return false
      return perform(async () => {
        const messages: string[] = []
        const reasons: string[] = []
        let moved = 0
        for (const batch of work) {
          const result = await source['topics:moveQuestions']({
            projectId,
            items: refsOf(batch.rows),
            to: batch.to
          })
          moved += result.moved
          messages.push(result.message)
          reasons.push(...result.skipped.map((item) => item.reason))
        }
        return {
          message: messages.join(' '),
          reasons,
          changed: moved > 0,
          topicsChanged: moved > 0
        }
      }, 'Could not move these questions.')
    },
    [source, projectId, perform]
  )

  const setStage = useCallback(
    async (rows: readonly QuestionRow[], stage: TopicStage | null): Promise<boolean> => {
      if (rows.length === 0) return false
      return perform(
        async () => {
          const result = await source['topics:setQuestionStage']({
            projectId,
            items: refsOf(rows),
            stage
          })
          return {
            message: result.message,
            reasons: result.skipped.map((item) => item.reason),
            changed: result.changed > 0,
            topicsChanged: result.changed > 0
          }
        },
        `Could not set the stage to ${stageLabel(stage)}.`
      )
    },
    [source, projectId, perform]
  )

  const setTarget = useCallback(
    async (rows: readonly QuestionRow[], target: TopicTarget): Promise<boolean> => {
      const byTopic = new Map<string, string[]>()
      let skipped = 0
      for (const row of rows) {
        if (sources.get(row.sourceId)?.kind !== 'topic') {
          skipped += 1
          continue
        }
        const ids = byTopic.get(row.sourceId) ?? []
        ids.push(row.promptId)
        byTopic.set(row.sourceId, ids)
      }
      const skippedText =
        skipped === 0
          ? []
          : [
              `${countText(skipped, 'page question')} skipped: a page question's target is its own page.`
            ]
      if (byTopic.size === 0) {
        return perform(
          async () => ({ message: 'No target page set.', reasons: skippedText, changed: false }),
          'Could not set the target page.'
        )
      }
      return perform(async () => {
        let set = 0
        for (const [topicId, promptIds] of byTopic) {
          await source['topics:setTarget']({ projectId, topicId, promptIds, target })
          set += promptIds.length
        }
        const where = target.url === null ? 'no page' : pathOf(target.url)
        return {
          message: `Set the target page of ${countText(set, 'question')} to ${where}.`,
          reasons: skippedText,
          changed: true,
          topicsChanged: true
        }
      }, 'Could not set the target page.')
    },
    [source, projectId, sources, perform]
  )

  return { move, setStage, setTarget }
}
