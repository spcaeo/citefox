import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuestionRow, QuestionUpdateAction } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { checkError, checkStartMessage } from '../../m3/source'
import { notifyTopicsChanged } from '../../topics/clusters'
import { countText, type RecheckPlan } from '../model'
import type { QuestionsSource } from '../source'

/** What one action ends with: the sentence to show, and what to reload. */
export interface ActionOutcome {
  message: string
  /** Plain reasons for questions left as they were, shown after the message once each. */
  reasons?: readonly string[]
  changed: boolean
  /** True tells the sidebar and every open screen, this one included, that topics changed. */
  topicsChanged?: boolean
}

/** Runs one action with the busy state and status line; false when nothing changed. */
export type Perform = (work: () => Promise<ActionOutcome>, failText: string) => Promise<boolean>

export interface QuestionActions {
  /** A bulk action or re-check is running. */
  busy: boolean
  /** The last outcome, for the screen's status line. */
  message: string | null
  dismiss: () => void
  update: (action: QuestionUpdateAction, rows: readonly QuestionRow[]) => Promise<boolean>
  recheck: (plan: RecheckPlan, marketId: string, marketLabel: string) => Promise<boolean>
  /** Searches left this month, from the status capsule. Null when unknown. */
  searchesLeft: () => Promise<number | null>
  perform: Perform
}

/**
 * Pause, Resume and Remove through `questions:update`, and "Check now"
 * through the same `checks:start` follow-up as "Check now" on a prompt. Each
 * ends with one plain sentence and a reload. `perform` runs the topic moves the
 * same way (useClusterActions).
 */
export function useQuestionActions(
  source: QuestionsSource,
  projectId: string,
  onChanged: () => void
): QuestionActions {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const show = useCallback((text: string | null) => {
    if (mounted.current) setMessage(text)
  }, [])
  const settle = useCallback(() => {
    if (mounted.current) setBusy(false)
  }, [])

  const perform = useCallback<Perform>(
    async (work, failText) => {
      setBusy(true)
      try {
        const outcome = await work()
        const reasons = [...new Set(outcome.reasons ?? [])]
        show([outcome.message, ...reasons].join(' '))
        // The topics event reloads this screen too (useQuestions), so one reload each way.
        if (outcome.topicsChanged) notifyTopicsChanged()
        else if (outcome.changed) onChanged()
        return outcome.changed
      } catch (cause) {
        show(errorText(cause, failText, { sentence: true }))
        return false
      } finally {
        settle()
      }
    },
    [onChanged, show, settle]
  )

  const update = useCallback(
    async (action: QuestionUpdateAction, rows: readonly QuestionRow[]): Promise<boolean> => {
      if (rows.length === 0) return false
      return perform(async () => {
        const result = await source['questions:update']({
          projectId,
          action,
          items: rows.map((row) => ({ sourceId: row.sourceId, promptId: row.promptId }))
        })
        return {
          message: result.message,
          reasons: result.skipped.map((item) => item.reason),
          changed: result.changed > 0
        }
      }, 'Could not change these questions.')
    },
    [source, projectId, perform]
  )

  const recheck = useCallback(
    async (plan: RecheckPlan, marketId: string, marketLabel: string): Promise<boolean> => {
      const [first, ...rest] = plan.pageIds
      if (first === undefined) return false
      setBusy(true)
      const what = countText(plan.promptIds.length, 'question')
      show(`Checking ${what} in ${marketLabel}…`)
      try {
        const job = await source['checks:start']({
          projectId,
          pageIds: [first, ...rest],
          marketIds: [marketId],
          promptIds: plan.promptIds
        })
        if (job.status !== 'finished') {
          show(checkStartMessage(job))
          return false
        }
        show(
          `Checked ${what} in ${marketLabel}. Used ${countText(job.searchesUsed, 'search', 'searches')}.`
        )
        onChanged()
        return true
      } catch (cause) {
        show(checkError(cause, 'Could not start the re-check.'))
        return false
      } finally {
        settle()
      }
    },
    [source, projectId, onChanged, show, settle]
  )

  const searchesLeft = useCallback(async (): Promise<number | null> => {
    try {
      return (await source['status:getCapsule']()).searchesLeft
    } catch {
      return null
    }
  }, [source])

  return { busy, message, dismiss: () => show(null), update, recheck, searchesLeft, perform }
}
