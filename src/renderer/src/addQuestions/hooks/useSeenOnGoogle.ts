import { useCallback, useEffect, useState } from 'react'
import type { QuestionTarget } from '@shared/ipc'
import type { AddQuestionsSource } from '../source'
import type { Suggestion } from '../types'

export interface SeenOnGoogle {
  items: readonly Suggestion[]
  /** Takes questions out of the list (added, or dismissed). */
  take: (ids: readonly string[]) => void
}

/**
 * "Seen on Google": the "People also ask" questions of the picked page's or topic's
 * latest check (`prompts:googleQuestions`), read from searches already stored, so
 * nothing is searched. Loads only while `enabled` (the Suggest tab is open). A new
 * page or topic loads its own; a failed read just shows none.
 */
export function useSeenOnGoogle(
  source: AddQuestionsSource,
  projectId: string,
  target: QuestionTarget | null,
  enabled: boolean
): SeenOnGoogle {
  const targetId = target?.id ?? null
  const [loaded, setLoaded] = useState<{ targetId: string; items: Suggestion[] } | null>(null)
  const read = source['prompts:googleQuestions']

  useEffect(() => {
    if (!enabled || targetId === null || read === undefined) return
    if (loaded?.targetId === targetId) return
    let live = true
    void Promise.resolve()
      .then(() => read({ projectId, pageId: targetId }))
      .then(
        (result) => {
          if (!live) return
          setLoaded({
            targetId,
            items: result.questions.map((text, index) => ({
              id: `google:${targetId}:${index}`,
              text,
              stage: ''
            }))
          })
        },
        () => {
          if (live) setLoaded({ targetId, items: [] })
        }
      )
    return () => {
      live = false
    }
  }, [enabled, targetId, read, projectId, loaded])

  const take = useCallback((ids: readonly string[]) => {
    const drop = new Set(ids)
    setLoaded((current) =>
      current === null
        ? null
        : { ...current, items: current.items.filter((item) => !drop.has(item.id)) }
    )
  }, [])

  return { items: loaded !== null && loaded.targetId === targetId ? loaded.items : [], take }
}
