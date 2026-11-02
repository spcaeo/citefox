import { useEffect, useMemo, useState } from 'react'
import type { HistoryEvent, PageResults } from '@shared/domain'
import type { GetResultsRequest } from '@shared/ipc'
import { LATEST } from './historyDrills'

/**
 * The one results channel History reads, so a check's numbers can open the
 * prompts behind them. Production uses the preload bridge; tests pass a fake.
 */
export interface RunResultsSource {
  'results:get'(request: GetResultsRequest): Promise<PageResults>
}

/** The preload bridge's `results:get`, or null when there is no bridge (harness, tests). */
export function bridgeResultsSource(): RunResultsSource | null {
  if (typeof window === 'undefined' || !window.citefox) return null
  const api = window.citefox
  return { 'results:get': (request) => api['results:get'](request) }
}

/** Run ids of the check events, newest first, without repeats. */
export function checkRunIds(events: readonly HistoryEvent[]): string[] {
  const ids: string[] = []
  for (const event of events) {
    const runId = event.check?.runId
    if (runId && !ids.includes(runId)) ids.push(runId)
  }
  return ids
}

/**
 * `results:get` for every check on the page's History in one market, plus the
 * latest check (`LATEST`). Each run loads once; a run that fails to load stays
 * missing and its numbers stay plain text.
 */
export function useRunResults(
  source: RunResultsSource | null,
  projectId: string,
  pageId: string,
  marketId: string | null,
  runIds: readonly string[],
  revision: number
): ReadonlyMap<string, PageResults> {
  const key = runIds.join('\n')
  const ids = useMemo(() => (key ? key.split('\n') : []), [key])
  const [loaded, setLoaded] = useState<{ scope: string; runs: ReadonlyMap<string, PageResults> }>(
    () => ({ scope: '', runs: new Map() })
  )
  const scope = `${projectId}\0${pageId}\0${marketId ?? ''}\0${revision}`

  useEffect(() => {
    if (!source || !marketId) return
    let cancelled = false
    const wanted: (string | null)[] = [null, ...ids]
    void Promise.all(
      wanted.map((runId) =>
        source['results:get']({ projectId, pageId, marketId, runId }).then(
          (results) => [runId ?? LATEST, results] as const,
          () => null
        )
      )
    ).then((pairs) => {
      if (cancelled) return
      const runs = new Map<string, PageResults>()
      for (const pair of pairs) if (pair) runs.set(pair[0], pair[1])
      setLoaded({ scope, runs })
    })
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, marketId, ids, scope])

  return loaded.scope === scope ? loaded.runs : EMPTY
}

const EMPTY: ReadonlyMap<string, PageResults> = new Map()
