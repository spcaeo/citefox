import { useCallback, useEffect, useState } from 'react'
import type { CompetitorPeriod, CompetitorsOverview } from '@shared/ipc'
import { errorText } from '../../components/errorText'
import { useChangeVersion } from '../../shell/changes'
import { useEngineRevision } from '../../shell/engineRevision'
import type { CompetitorsSource } from '../source'

export interface CompetitorsScope {
  period: CompetitorPeriod
  marketId: string | null
  productId: string | null
}

export interface CompetitorsState {
  /** The last loaded overview, kept while the next one loads. */
  data: CompetitorsOverview | null
  /** True until the overview for the current scope is in. */
  loading: boolean
  error: string | null
  reload: () => void
}

/** `competitors:overview` for a scope, reloaded when a check finishes or a competitor changes. */
export function useCompetitorsOverview(
  source: CompetitorsSource,
  projectId: string,
  scope: CompetitorsScope
): CompetitorsState {
  const revision = useEngineRevision()
  const changes = useChangeVersion('competitors')
  const [data, setData] = useState<CompetitorsOverview | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const { period, marketId, productId } = scope
  const key = `${projectId}\0${period}\0${marketId ?? ''}\0${productId ?? ''}\0${reloads}`

  useEffect(() => {
    let live = true
    void Promise.resolve()
      .then(() => source['competitors:overview']({ projectId, period, marketId, productId }))
      .then(
        (next) => {
          if (!live) return
          setData(next)
          setError(null)
          setLoadedKey(key)
        },
        (cause: unknown) => {
          if (!live) return
          setError(errorText(cause, 'Could not load who the AI Overviews cite.'))
          setLoadedKey(key)
        }
      )
    return () => {
      live = false
    }
  }, [source, projectId, period, marketId, productId, key, revision, changes])

  const reload = useCallback(() => setReloads((value) => value + 1), [])
  return { data, loading: loadedKey !== key, error: loadedKey === key ? error : null, reload }
}
