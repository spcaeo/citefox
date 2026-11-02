import { useCallback, useState } from 'react'
import { isTopicStage } from '@shared/domain'
import type { HelpFillResult, QuestionTarget } from '@shared/ipc'
import { normaliseQuestion } from '@shared/question-text'
import type { Suggestion } from '../types'

/** Two answers can reuse a row id; the list keys stay unique. */
let nextKey = 0

export interface HelpRowsActions {
  /** Rows from ✦ Help me write (either way), after main merged and set aside. A new answer from Describe replaces the last draft. */
  receive: (result: HelpFillResult, replace: boolean) => void
  /** Takes rows out of the list (added, or dismissed). */
  take: (ids: readonly string[]) => void
}

/**
 * The drafted questions waiting for review under ✦ Help me write. They are
 * ticked and moved into the rows below, where they are checked like typed ones.
 * A new page or topic clears the list.
 */
export function useHelpRows(
  target: QuestionTarget | null
): [readonly Suggestion[], HelpRowsActions] {
  const [items, setItems] = useState<Suggestion[]>([])
  const targetId = target?.id ?? null
  const [shownFor, setShownFor] = useState(targetId)
  if (shownFor !== targetId) {
    setShownFor(targetId)
    setItems([])
  }

  const receive = useCallback((result: HelpFillResult, replace: boolean) => {
    const incoming = result.rows.map((row): Suggestion => {
      const stage = row.values.stage ?? ''
      return {
        id: `hf:${(nextKey += 1)}:${row.id}`,
        text: row.values.question ?? '',
        stage: isTopicStage(stage) ? stage : '',
        page: row.values.page ?? ''
      }
    })
    setItems((shown) => {
      const kept = replace ? [] : shown
      const seen = new Set(kept.map((item) => normaliseQuestion(item.text)))
      return [
        ...kept,
        ...incoming.filter((item) => item.text !== '' && !seen.has(normaliseQuestion(item.text)))
      ]
    })
  }, [])

  const take = useCallback((ids: readonly string[]) => {
    const drop = new Set(ids)
    setItems((shown) => shown.filter((item) => !drop.has(item.id)))
  }, [])

  return [items, { receive, take }]
}
