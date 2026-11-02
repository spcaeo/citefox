import { useCallback, useEffect, useRef, useState } from 'react'
import { normaliseQuestion } from '@shared/question-text'
import type { QuestionTarget } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { promptFromItem } from '../../pageSetup/assistMapping'
import type { AddQuestionsSource } from '../source'
import type { Suggestion } from '../types'
import { INTENT_TO_TOPIC } from '../utils/rows'

export interface SuggestionsState {
  items: readonly Suggestion[]
  busy: boolean
  error: string | null
}

export interface SuggestionsActions {
  /** Asks Claude (`prompts.more`) for `count` questions; `instruction` steers it (thin stages). */
  suggest: (count: number, instruction?: string | null) => Promise<void>
  /** Takes suggestions out of the list (added, or dismissed). */
  take: (ids: readonly string[]) => void
}

/**
 * AI suggestions for the picked page or topic through the `prompts.more` assist,
 * which reads the buyer profile and competitors and leaves out what is tracked.
 * Nothing runs until asked. A new page or topic clears the list.
 */
export function useSuggestions(
  source: AddQuestionsSource,
  projectId: string,
  target: QuestionTarget | null
): [SuggestionsState, SuggestionsActions] {
  const [items, setItems] = useState<Suggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const targetId = target?.id ?? null
  const [shownFor, setShownFor] = useState(targetId)
  if (shownFor !== targetId) {
    setShownFor(targetId)
    setItems([])
    setError(null)
  }

  const suggest = useCallback(
    async (count: number, instruction: string | null = null) => {
      if (target === null || busy) return
      setBusy(true)
      setError(null)
      try {
        const result = await source['assist:run']({
          assistId: 'prompts.more',
          projectId,
          pageId: target.id,
          marketId: target.marketIds[0] ?? null,
          promptId: null,
          inputs: { count },
          instruction
        })
        if (!live.current) return
        const incoming = result.items.map((item): Suggestion => {
          const mapped = promptFromItem(item)
          return {
            id: `${result.runId}:${item.id}`,
            text: mapped.text,
            stage: INTENT_TO_TOPIC[mapped.intentStage]
          }
        })
        setItems((shown) => {
          const seen = new Set(shown.map((item) => normaliseQuestion(item.text)))
          return [...shown, ...incoming.filter((item) => !seen.has(normaliseQuestion(item.text)))]
        })
        if (incoming.length === 0) setError('CiteFox AI had nothing new to suggest. Try again.')
      } catch (cause) {
        if (live.current) setError(errorText(cause, 'Could not get suggestions.'))
      } finally {
        if (live.current) setBusy(false)
      }
    },
    [source, projectId, target, busy]
  )

  const take = useCallback((ids: readonly string[]) => {
    const drop = new Set(ids)
    setItems((shown) => shown.filter((item) => !drop.has(item.id)))
  }, [])

  return [
    { items, busy, error },
    { suggest, take }
  ]
}
