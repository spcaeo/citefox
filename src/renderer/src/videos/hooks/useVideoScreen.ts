import { useCallback, useEffect, useState } from 'react'
import type { VideoIdea, VideoScreen } from '@shared/domain'
import { useEngineRevision } from '../../shell/engineRevision'
import type { VideosSource } from '../source'
import { plainError } from '../utils/model'

export interface VideoScreenState {
  screen: VideoScreen | null
  error: string | null
  loading: boolean
  reload: () => void
  /** Puts an idea an action returned into the screen at once, then reloads the counts. */
  applyIdea: (idea: VideoIdea) => void
}

/** Loads `videos:get` for the market and page picked, and again after a check finishes. */
export function useVideoScreen(
  source: VideosSource,
  projectId: string,
  pageId: string | null,
  marketId: string | null
): VideoScreenState {
  const revision = useEngineRevision()
  const [screen, setScreen] = useState<VideoScreen | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${projectId}\0${pageId ?? ''}\0${marketId ?? ''}`

  useEffect(() => {
    let cancelled = false
    void source['videos:get']({ projectId, pageId, marketId }).then(
      (payload) => {
        if (cancelled) return
        setScreen(payload)
        setError(null)
        setLoadedKey(key)
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(plainError(cause, 'Could not load the YouTube screen.'))
        setLoadedKey(key)
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, marketId, key, revision, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const applyIdea = useCallback((idea: VideoIdea) => {
    setScreen((current) =>
      current === null
        ? current
        : { ...current, ideas: current.ideas.map((item) => (item.id === idea.id ? idea : item)) }
    )
    setTick((value) => value + 1)
  }, [])

  return { screen, error, loading: loadedKey !== key, reload, applyIdea }
}
