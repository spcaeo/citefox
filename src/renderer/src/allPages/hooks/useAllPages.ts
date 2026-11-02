import { useCallback, useEffect, useState } from 'react'
import type { AllPagesData, CitationReview } from '@shared/ipc'
import { messageOf } from '../../grid/hooks/useSavedViews'
import type { AllPagesSource } from '../source'

export interface AllPagesState {
  data: AllPagesData | null
  review: CitationReview | null
  error: string | null
  /** Reloads the rows and the citation review. */
  reload: () => void
  /**
   * Reloads the rows and tiles only. The citation lists keep their rows, so a
   * Track or Point it here stays on screen with its Undo.
   */
  reloadRows: () => void
}

/**
 * Loads `allpages:list` and then `allpages:citations` for the project. The
 * review reads every tracked page's latest checks, so it arrives second and
 * never holds up the grid.
 */
export function useAllPages(
  source: AllPagesSource,
  projectId: string | null,
  revision: unknown
): AllPagesState {
  const [data, setData] = useState<AllPagesData | null>(null)
  const [review, setReview] = useState<CitationReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [rowsTick, setRowsTick] = useState(0)

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    source.citations(projectId).then(
      (loaded) => {
        if (!cancelled) setReview(loaded)
      },
      () => {
        if (!cancelled) setReview({ wrongPage: [], wrongPagePages: 0, untracked: [] })
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, revision, tick])

  useEffect(() => {
    if (projectId === null) return
    let cancelled = false
    source.list(projectId).then(
      (loaded) => {
        if (cancelled) return
        setData(loaded)
        setError(null)
      },
      (cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, 'Could not load the pages.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, revision, tick, rowsTick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const reloadRows = useCallback(() => setRowsTick((value) => value + 1), [])
  return { data: projectId === null ? null : data, review, error, reload, reloadRows }
}
