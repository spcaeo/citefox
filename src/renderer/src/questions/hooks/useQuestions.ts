import { useCallback, useEffect, useState } from 'react'
import type { QuestionsList } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useEngineRevision } from '../../shell/engineRevision'
import { useResultsRevision } from '../../shell/resultsRevision'
import { onTopicsChanged } from '../../topics/clusters'
import type { QuestionsSource } from '../source'

export type QuestionsState =
  | { status: 'loading'; data: QuestionsList | null }
  | { status: 'error'; message: string; data: QuestionsList | null }
  | { status: 'ready'; data: QuestionsList }

interface Loaded {
  /** The request the result answers. */
  key: string
  data: QuestionsList | null
  error: string | null
}

/**
 * Loads `questions:list` for the project and market. It loads again when the market
 * changes, after `reload`, when a check finishes elsewhere (engine revision), and when
 * topics change anywhere (a move, here or on the Topics screen). The
 * last list stays on screen while the next one loads, so a reload does not flash.
 */
export function useQuestions(
  source: QuestionsSource,
  projectId: string,
  marketId: string | null
): { state: QuestionsState; reload: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ key: '', data: null, error: null })
  const revision = useEngineRevision()
  // Answers a running check saves show at once (re-read once a second at most).
  const live = useResultsRevision({ projectId })
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const key = `${projectId}\n${marketId ?? ''}\n${attempt}\n${revision}\n${live}`

  useEffect(() => onTopicsChanged(reload), [reload])

  useEffect(() => {
    let cancelled = false
    source['questions:list']({ projectId, marketId }).then(
      (data) => {
        if (!cancelled) setLoaded({ key, data, error: null })
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoaded((shown) => ({
            key,
            data: shown.data,
            error: errorText(cause, 'Could not load the questions.')
          }))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, marketId, key])

  let state: QuestionsState
  if (loaded.key !== key) state = { status: 'loading', data: loaded.data }
  else if (loaded.error !== null)
    state = { status: 'error', message: loaded.error, data: loaded.data }
  else if (loaded.data !== null) state = { status: 'ready', data: loaded.data }
  else state = { status: 'loading', data: null }
  return { state, reload }
}
