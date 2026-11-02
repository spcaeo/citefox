import { useCallback, useEffect, useState } from 'react'
import type { OverviewPeriod } from '@shared/ipc'
import { useHashQuery, type HashQuery } from '../../utils/hashQuery'
import { OVERVIEW_QUERY } from '../compare'
import { PERIOD_PARAM, periodFromHash, withQueryParam } from '../model'

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

export type OverviewQuery = HashQuery<(typeof OVERVIEW_QUERY)[number]>

/**
 * The Overview's URL state: the period (`?period=30d`), the market, the compared
 * check (`vs`), the questions filter (`change`) and the open panel all live in the
 * address, so a link opens the same view and Back and Forward step through them.
 * `hash` is the current address, for links that keep the route (a dialog).
 */
export function useOverviewRoute(): {
  period: OverviewPeriod
  hash: string
  query: OverviewQuery
  setPeriod: (period: OverviewPeriod) => void
  setQuery: (patch: Partial<OverviewQuery>, options?: { replace?: boolean }) => void
} {
  const [hash, setHash] = useState(currentHash)
  const [query, setQuery] = useHashQuery(OVERVIEW_QUERY)
  useEffect(() => {
    const update = (): void => setHash(currentHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  const setPeriod = useCallback((period: OverviewPeriod) => {
    // Pushes a history entry; the hashchange listener reads it back.
    window.location.hash = withQueryParam(currentHash(), PERIOD_PARAM, period)
  }, [])
  return { period: periodFromHash(hash), hash, query, setPeriod, setQuery }
}
