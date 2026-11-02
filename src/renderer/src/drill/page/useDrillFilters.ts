import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { navigateHash } from '../../shell/routes'
import { drillHref, readDrillFilters, withoutDrillFilter, withoutDrillFilters } from './drillUrl'

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

export interface DrillFiltersState<N extends string> {
  /** Each filter's value in the URL, or null. */
  values: Readonly<Record<N, string | null>>
  /** True when any of the names is set: the screen shows its drill page. */
  active: boolean
  /** The current URL with these filters set (a count's link). */
  hrefWith: (filters: Partial<Record<N, string | null>>) => string
  /** The current URL without one filter (a chip's ✕). */
  hrefWithout: (name: N) => string
  /** The current URL with no filters ("Back to all N"). */
  allHref: string
  /** Sets filters as a new history entry. */
  set: (filters: Partial<Record<N, string | null>>) => void
}

/** A screen's drill filters (`f.<name>` in the hash), kept in step with the URL. */
export function useDrillFilters<N extends string>(names: readonly N[]): DrillFiltersState<N> {
  const hash = useSyncExternalStore(subscribe, currentHash, () => '')
  const signature = names.join('|')
  const values = useMemo(
    () => readDrillFilters(hash, signature.split('|') as N[]),
    [hash, signature]
  )
  const active = Object.values<string | null>(values).some((value) => value !== null)
  const hrefWith = useCallback(
    (filters: Partial<Record<N, string | null>>) => drillHref(hash, filters),
    [hash]
  )
  const hrefWithout = useCallback((name: N) => withoutDrillFilter(hash, name), [hash])
  const set = useCallback((filters: Partial<Record<N, string | null>>) => {
    const next = drillHref(currentHash(), filters)
    if (next !== currentHash()) navigateHash(next)
  }, [])
  return {
    values,
    active,
    hrefWith,
    hrefWithout,
    allHref: withoutDrillFilters(hash),
    set
  }
}
