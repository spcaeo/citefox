import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageResults } from '@shared/domain'
import type { ProjectCheck } from '@shared/ipc'
import { errorText } from '../../../components/errorText'
import type { ProjectHistorySource } from '../../client'

export type LoadRunResults = (check: ProjectCheck) => Promise<PageResults>

/**
 * `results:get` pinned to one check, kept per run while the screen is open: a
 * finished check's results never change, so a drill and Compare share one load.
 * A running check is read again every time.
 */
export function useRunResultsLoader(
  source: ProjectHistorySource,
  projectId: string
): LoadRunResults {
  const cache = useRef(new Map<string, Promise<PageResults>>())
  useEffect(() => {
    cache.current = new Map()
  }, [source, projectId])
  return useCallback(
    (check: ProjectCheck) => {
      const cached = cache.current.get(check.runId)
      if (cached !== undefined) return cached
      const loading = Promise.resolve().then(() =>
        source['results:get']({
          projectId,
          pageId: check.pageId,
          marketId: check.marketId,
          runId: check.runId
        })
      )
      if (check.status !== 'running') {
        cache.current.set(check.runId, loading)
        // A failed load is tried again next time.
        loading.catch(() => cache.current.delete(check.runId))
      }
      return loading
    },
    [source, projectId]
  )
}

export interface PairResults {
  before: PageResults | null
  after: PageResults | null
  error: string | null
  retry: () => void
}

/** Both checks' results for the Compare drawer. */
export function usePairResults(
  load: LoadRunResults,
  pair: readonly [ProjectCheck, ProjectCheck] | null
): PairResults {
  const [state, setState] = useState<{
    key: string
    before: PageResults | null
    after: PageResults | null
    error: string | null
  }>({ key: '', before: null, after: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const key = pair === null ? '' : `${pair[0].runId}|${pair[1].runId}|${attempt}`
  // Keyed by the run ids: a reload of the list (new objects) must not load again.
  const latest = useRef(pair)
  useEffect(() => {
    latest.current = pair
  })

  useEffect(() => {
    const current = latest.current
    if (current === null || key === '') return
    let live = true
    Promise.all([load(current[0]), load(current[1])]).then(
      ([older, newer]) => {
        if (live) setState({ key, before: older, after: newer, error: null })
      },
      (cause: unknown) => {
        if (live) {
          setState({
            key,
            before: null,
            after: null,
            error: errorText(cause, 'Could not load the results of these checks.')
          })
        }
      }
    )
    return () => {
      live = false
    }
  }, [key, load])

  const current = state.key === key
  return {
    before: current ? state.before : null,
    after: current ? state.after : null,
    error: current ? state.error : null,
    retry: () => setAttempt((value) => value + 1)
  }
}
