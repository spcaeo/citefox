import { useCallback, useEffect, useMemo } from 'react'
import type { TopicPromptKind } from '@shared/domain'
import { replaceHash } from '../../../shell/routes'
import { useDrawerEntry, type DrawerEntryApi } from '../../../shell/drawers'
import { useHashQuery } from '../../../utils/hashQuery'
import type { SearchFilter, TreeMode } from '../model'
import {
  drawerDrill,
  drillDrawerHash,
  isDrillQuery,
  legacyDrillHash,
  parseViewQuery,
  SEARCH_DRILL,
  VIEW_QUERY_KEYS,
  type ViewQuery
} from '../url'

export interface ViewQueryState extends ViewQuery {
  isDrill: boolean
  /** The drill's drawer (`drawer=search-drill`): its depth and close, or null when closed. */
  drillDrawer: DrawerEntryApi | null
  setType: (type: TopicPromptKind | null) => void
  /** Typing replaces the history entry, so Back does not step through each letter. */
  setQ: (q: string) => void
  setTree: (tree: TreeMode) => void
  setSel: (ids: readonly string[]) => void
  /** The current URL with this drill's drawer open over the view. */
  drillHref: (filter: SearchFilter) => string
}

/**
 * The topic and Questions views' URL state (see `url.ts`), read and written in place.
 * The drill's filters are its drawer's values; `prefix` names them on a screen that
 * uses the plain names for itself. A link from before the drawer is rewritten in place.
 */
export function useViewQuery(prefix = ''): ViewQueryState {
  const [values, set] = useHashQuery(VIEW_QUERY_KEYS)
  const drillDrawer = useDrawerEntry(SEARCH_DRILL)
  const drillParams = drillDrawer?.entry.params
  const query = useMemo(() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value)
    return { ...parseViewQuery(params, prefix), drill: drawerDrill(drillParams, prefix) }
  }, [values, drillParams, prefix])
  useEffect(() => {
    function fix(): void {
      const next = legacyDrillHash(window.location.hash, prefix)
      if (next) replaceHash(next)
    }
    fix()
    window.addEventListener('hashchange', fix)
    return () => window.removeEventListener('hashchange', fix)
  }, [prefix])
  const setType = useCallback(
    (type: TopicPromptKind | null) => set({ type, p: null, sel: null }),
    [set]
  )
  const setQ = useCallback((q: string) => set({ q: q || null, p: null }, { replace: true }), [set])
  const setTree = useCallback(
    (tree: TreeMode) => set({ tree: tree === 'stage' ? null : tree }),
    [set]
  )
  const setSel = useCallback(
    (ids: readonly string[]) =>
      set({ sel: ids.length === 0 ? null : ids.join(',') }, { replace: true }),
    [set]
  )
  // Read the live hash so the links follow the rest of the URL (view, market, drawer).
  const drillHref = useCallback(
    (filter: SearchFilter) => drillDrawerHash(window.location.hash, filter, prefix),
    // `values` and the drawer change with the hash, so the links refresh with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values, drillParams, prefix]
  )
  return {
    ...query,
    isDrill: drillDrawer !== null && isDrillQuery(query),
    drillDrawer,
    setType,
    setQ,
    setTree,
    setSel,
    drillHref
  }
}
