import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnswerEngineId } from '@shared/domain'
import { errorText } from '../../../components/errorText'
import { currentClientMode } from '../../../onboarding/flags'
import { useEngineRevision } from '../../../shell/engineRevision'
import { useResultsRevision } from '../../../shell/resultsRevision'
import { onTopicsChanged } from '../../clusters/events'
import { topicResultsSource, type TopicResultsSource } from '../source'
import type { TopicResults } from '../types'

export interface TopicResultsState {
  results: TopicResults | null
  /** True while the first load (or a market switch) is in flight. */
  loading: boolean
  error: string | null
  reload: () => void
  source: TopicResultsSource
}

/**
 * Loads one topic's results in a market and check. Reloads in place as a running
 * check saves each answer (`results:changed`), after a check finishes (engine
 * revision) and when `reload` is called; a reply for an older request is dropped.
 */
export function useTopicResults(options: {
  projectId: string
  topicId: string
  marketId: string | null
  runId: string | null
  source?: TopicResultsSource
  /** An answer engine's results instead of Google's (audit #4). */
  engine?: AnswerEngineId | null
}): TopicResultsState {
  const { projectId, topicId, marketId, runId } = options
  const engine = options.engine ?? null
  const source = useMemo(
    () => options.source ?? topicResultsSource(currentClientMode()),
    [options.source]
  )
  const pushed = useEngineRevision()
  // Each answer a running check saves for this topic re-reads it (batched to once a second).
  const live = useResultsRevision({ projectId, pageId: topicId })
  const [revision, setRevision] = useState(0)
  const key = `${projectId}\u0000${topicId}\u0000${marketId ?? ''}\u0000${runId ?? ''}\u0000${engine ?? ''}`
  const [state, setState] = useState<{
    key: string
    results: TopicResults | null
    error: string | null
  }>({ key: '', results: null, error: null })

  useEffect(() => {
    let cancelled = false
    // Google's request stays as it was; another engine names itself.
    source.results({ projectId, topicId, marketId, runId, ...(engine ? { engine } : {}) }).then(
      (results) => {
        if (!cancelled) setState({ key, results, error: null })
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState((current) => ({
            key,
            results: current.key === key ? current.results : null,
            error: errorText(cause, 'Could not load this topic.')
          }))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, topicId, marketId, runId, engine, key, revision, pushed, live])

  const reload = useCallback(() => setRevision((current) => current + 1), [])
  // Renamed, paused or deleted from Topic settings or the list, or a question
  // edited, moved or removed anywhere: reload the topic in place.
  useEffect(() => onTopicsChanged(reload), [reload])
  const fresh = state.key === key
  return {
    // Keep the previous market's results on screen while the next one loads.
    results: state.results,
    loading: !fresh,
    error: fresh ? state.error : null,
    reload,
    source
  }
}
