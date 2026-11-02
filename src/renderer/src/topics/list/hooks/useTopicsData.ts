import { useCallback, useEffect, useState } from 'react'
import type { TopicSummary } from '@shared/domain'
import type { QuestionsList, TopicFolder } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import { useEngineRevision } from '../../../shell/engineRevision'
import { onTopicsChanged, type ClustersSource } from '../../clusters'

export interface TopicsData {
  topics: readonly TopicSummary[]
  list: QuestionsList
  /** The user's topic folders (the dashboard's Folder › Topic tree). */
  folders: readonly TopicFolder[]
}

export type TopicsState =
  | { status: 'loading'; data: TopicsData | null }
  | { status: 'error'; message: string; data: TopicsData | null }
  | { status: 'ready'; data: TopicsData }

interface Loaded {
  key: string
  data: TopicsData | null
  error: string | null
}

/**
 * Loads the topics (`topics:list`), every tracked question (`questions:list`, the
 * default market) and the topic folders (`topics:folders`) for the Topics screen. It loads again after `reload`, when a check
 * finishes (engine revision) and when topics change anywhere (moves, New topic). The
 * last data stays on screen while the next loads.
 */
export function useTopicsData(
  source: ClustersSource,
  projectId: string
): { state: TopicsState; reload: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ key: '', data: null, error: null })
  const revision = useEngineRevision()
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const key = `${projectId}\n${attempt}\n${revision}`

  useEffect(() => onTopicsChanged(reload), [reload])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      source['topics:list']({ projectId }),
      source['questions:list']({ projectId, marketId: null }),
      source['topics:folders']({ projectId })
    ]).then(
      ([topics, list, folders]) => {
        if (!cancelled)
          setLoaded({
            key,
            data: { topics: topics.topics, list, folders: folders.folders },
            error: null
          })
      },
      (cause: unknown) => {
        if (!cancelled) {
          setLoaded((shown) => ({
            key,
            data: shown.data,
            error: errorText(cause, 'Could not load the topics.')
          }))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, key])

  let state: TopicsState
  if (loaded.key !== key) state = { status: 'loading', data: loaded.data }
  else if (loaded.error !== null)
    state = { status: 'error', message: loaded.error, data: loaded.data }
  else if (loaded.data !== null) state = { status: 'ready', data: loaded.data }
  else state = { status: 'loading', data: null }
  return { state, reload }
}
