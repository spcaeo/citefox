import { useCallback, useEffect, useState } from 'react'
import type { Market } from '@shared/domain'
import { checkError } from '../../m3/source'
import { useEngineRevision } from '../../shell/engineRevision'
import type { MarketsSource } from '../source'
import type { MarketResults } from '../types'

interface Loaded {
  key: string
  markets: readonly MarketResults[]
  searchesLeft: number | null
}

/**
 * `results:get` for each of the page's markets, latest finished run, plus
 * the capsule's searches left for the cost line. Reloads on engine pushes.
 */
export function useMarketResults(
  source: MarketsSource,
  projectId: string,
  pageId: string,
  markets: readonly Market[]
): {
  markets: readonly MarketResults[] | null
  searchesLeft: number | null
  reload: () => void
} {
  const [attempt, setAttempt] = useState(0)
  const key = `${projectId}\0${pageId}\0${markets.map((market) => market.id).join(',')}\0${attempt}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const revision = useEngineRevision()

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      Promise.all(
        markets.map(async (market): Promise<MarketResults> => {
          try {
            const results = await source['results:get']({
              projectId,
              pageId,
              marketId: market.id,
              runId: null
            })
            return { market, results, error: null }
          } catch (cause) {
            return { market, results: null, error: checkError(cause, 'Could not load results.') }
          }
        })
      ),
      // Only feeds the cost line under "Add market"; a failure leaves it blank.
      source['status:getCapsule']().then(
        (capsule) => capsule.searchesLeft,
        () => null
      )
    ]).then(([loadedMarkets, searchesLeft]) => {
      if (!cancelled) setLoaded({ key, markets: loadedMarkets, searchesLeft })
    })
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, markets, key, revision])

  if (!loaded || loaded.key !== key) return { markets: null, searchesLeft: null, reload }
  return { markets: loaded.markets, searchesLeft: loaded.searchesLeft, reload }
}
