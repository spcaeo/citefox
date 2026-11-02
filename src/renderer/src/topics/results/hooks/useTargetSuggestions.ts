import { useCallback, useEffect, useRef, useState } from 'react'
import type { SuggestTopicTargetResult, TopicTargetSuggestions } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import type { TopicResultsSource } from '../source'

/** The shipped estimate for ✦ Suggest with AI until `topics:describeStep` answers. */
const SHIPPED_SECONDS = 12

export type TargetAiState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: SuggestTopicTargetResult }
  | { phase: 'error'; message: string }

export interface TargetSuggestionsState {
  /** The ranked cited pages; null while they load. */
  cited: TopicTargetSuggestions | null
  citedError: string | null
  retryCited: () => void
  ai: TargetAiState
  /** Asks CiteFox AI (again). A reply after a newer ask or unmount is dropped. */
  askAi: () => void
  /** "about 12 s", from the step's recent calls. */
  seconds: number
}

/**
 * The target page drawer's suggestions: the free cited-pages ranking
 * (`topics:targetSuggestions`, loaded on open) and the CiteFox AI pick
 * (`topics:suggestTarget`, on ✦ Suggest with AI). Neither changes the topic.
 */
export function useTargetSuggestions(scope: {
  source: TopicResultsSource
  projectId: string
  topicId: string
  marketId: string | null
}): TargetSuggestionsState {
  const { source, projectId, topicId, marketId } = scope
  const [cited, setCited] = useState<TopicTargetSuggestions | null>(null)
  const [citedError, setCitedError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ai, setAi] = useState<TargetAiState>({ phase: 'idle' })
  const [seconds, setSeconds] = useState(SHIPPED_SECONDS)
  const ticket = useRef(0)

  useEffect(() => {
    let cancelled = false
    source.targetSuggestions({ projectId, topicId, marketId }).then(
      (result) => {
        if (cancelled) return
        setCited(result)
        setCitedError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setCitedError(errorText(cause, 'Could not read which pages are cited.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, topicId, marketId, attempt])

  useEffect(() => {
    let cancelled = false
    source.describeStep({ projectId, step: 'target_suggest' }).then(
      (described) => {
        if (!cancelled) setSeconds(described.label.expectedSeconds)
      },
      () => undefined
    )
    return () => {
      cancelled = true
      ticket.current += 1
    }
  }, [source, projectId])

  const askAi = useCallback(() => {
    const mine = ++ticket.current
    setAi({ phase: 'running' })
    source.suggestTarget({ projectId, topicId, marketId }).then(
      (result) => {
        if (mine === ticket.current) setAi({ phase: 'done', result })
      },
      (cause: unknown) => {
        if (mine === ticket.current)
          setAi({ phase: 'error', message: errorText(cause, 'CiteFox AI could not pick a page.') })
      }
    )
  }, [source, projectId, topicId, marketId])

  const retryCited = useCallback(() => {
    setCitedError(null)
    setAttempt((n) => n + 1)
  }, [])

  return { cited, citedError, retryCited, ai, askAi, seconds }
}
