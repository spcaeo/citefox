import { useCallback, useEffect, useState } from 'react'
import type { OverviewPeriod, VisibilityOverview } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useEngineRevision } from '../../shell/engineRevision'
import { useResultsRevision } from '../../shell/resultsRevision'
import type { OverviewClient } from '../client'

export type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: VisibilityOverview; refreshing: boolean }

interface Loaded {
  key: string
  data: VisibilityOverview | null
  error: string | null
}

export interface OverviewScope {
  period: OverviewPeriod
  /** Null: each page and topic in its default market. */
  marketId: string | null
  /** The compared check or day (`?vs=`). Null: each source's previous check. */
  vs: string | null
}

/**
 * Loads `visibility:overview` for the project, period, market and compared check,
 * again as a running check saves answers (`results:changed`, once a second at most)
 * and after a check finishes (the shell's engine revision). A scope change
 * keeps the last numbers on screen, marked busy, until the new ones arrive.
 */
export function useOverview(
  client: OverviewClient,
  projectId: string,
  scope: OverviewScope
): { state: OverviewState; reload: () => void } {
  const { period, marketId, vs } = scope
  const [attempt, setAttempt] = useState(0)
  const revision = useEngineRevision()
  const live = useResultsRevision({ projectId })
  const key = `${projectId}\0${period}\0${marketId ?? ''}\0${vs ?? ''}\0${attempt}\0${revision}\0${live}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    client['visibility:overview']({ projectId, period, marketId, vs })
      .then((data) => {
        if (!cancelled) setLoaded({ key, data, error: null })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoaded({ key, data: null, error: errorText(cause, 'Could not load the overview.') })
        }
      })
    return () => {
      cancelled = true
    }
  }, [client, projectId, period, marketId, vs, key])

  if (loaded === null) return { state: { status: 'loading' }, reload }
  const fresh = loaded.key === key
  if (loaded.error !== null) {
    return fresh
      ? { state: { status: 'error', message: loaded.error }, reload }
      : { state: { status: 'loading' }, reload }
  }
  const data = loaded.data
  if (data === null || data.projectId !== projectId) {
    return { state: { status: 'loading' }, reload }
  }
  return { state: { status: 'ready', data, refreshing: !fresh }, reload }
}
