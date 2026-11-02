import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { GridSortKey } from '@shared/domain'
import { patchHashQuery } from '../../utils/hashQuery'
import { formatSort, parseSort, readQueryValue, writeQuery } from '../../utils/queryState'

/**
 * A ListGrid's own state in the hash URL under one key (grid audit R5), so a
 * copied link opens the same sort, search and page, and Back and Forward step
 * through them. `<key>.q` is the search, `<key>.sort` the sort (`pos:asc`),
 * `<key>.p` the page (left out on page 1) and `<key>.n=all` Show all. The
 * names match `useGridQueryState`, so a screen that already keeps its search
 * and sort there can hand the grid the same key. Values are column ids and
 * numbers only, never row text. A grid inside a drawer lists
 * `listUrlKeys(key)` in its drawer's params so they close with it.
 */
export interface ListUrlState {
  search: string | null
  sort: readonly GridSortKey[]
  /** 1-based. */
  page: number
  all: boolean
}

export interface ListUrlPatch {
  search?: string | null
  sort?: readonly GridSortKey[]
  page?: number
  all?: boolean
}

/** The URL keys a grid with `urlKey` writes. */
export function listUrlKeys(urlKey: string): readonly string[] {
  return [`${urlKey}.q`, `${urlKey}.sort`, `${urlKey}.p`, `${urlKey}.n`]
}

const SEPARATOR = '\u0000'

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function snapshot(urlKey: string | undefined, hash?: string): string {
  if (!urlKey || typeof window === 'undefined') return ''
  const from = hash ?? window.location.hash
  return listUrlKeys(urlKey)
    .map((key) => readQueryValue(from, key) ?? '')
    .join(SEPARATOR)
}

/** The grid state that `snapshot` packed into one string. */
export function parseListUrl(raw: string): ListUrlState {
  const [search = '', sort = '', page = '', all = ''] = raw.split(SEPARATOR)
  const pageNumber = Number.parseInt(page, 10)
  return {
    search: search || null,
    sort: parseSort(sort || null),
    page: Number.isFinite(pageNumber) && pageNumber > 1 ? pageNumber : 1,
    all: all === 'all'
  }
}

/** The URL values for a patch: null drops a key, so the defaults leave no trace. */
export function listUrlValues(urlKey: string, patch: ListUrlPatch): Record<string, string | null> {
  const [q, sort, p, n] = listUrlKeys(urlKey) as [string, string, string, string]
  const out: Record<string, string | null> = {}
  if (patch.search !== undefined) out[q] = patch.search ? patch.search : null
  if (patch.sort !== undefined) out[sort] = formatSort(patch.sort)
  if (patch.page !== undefined) out[p] = patch.page > 1 ? String(patch.page) : null
  if (patch.all !== undefined) out[n] = patch.all ? 'all' : null
  return out
}

/**
 * The grid's URL state, or null without a key. `write` pushes a history entry
 * for a click (sort, page, Show all) and replaces the current one for typing.
 */
export function useListUrl(urlKey: string | undefined): {
  state: ListUrlState | null
  write: (patch: ListUrlPatch, history?: 'push' | 'replace') => void
} {
  const raw = useSyncExternalStore(
    subscribe,
    () => snapshot(urlKey),
    () => ''
  )
  // A pushed hash reaches listeners a moment later; until then the grid shows
  // what was written, so a click redraws at once. It lapses when the URL moves.
  const [ahead, setAhead] = useState<{ from: string; raw: string } | null>(null)
  // Once the URL catches up (or moves on), the URL alone says what shows.
  if (ahead !== null && ahead.from !== raw) setAhead(null)
  const shown = ahead !== null && ahead.from === raw ? ahead.raw : raw
  const state = useMemo(() => (urlKey ? parseListUrl(shown) : null), [urlKey, shown])
  const write = useCallback(
    (patch: ListUrlPatch, history: 'push' | 'replace' = 'push') => {
      if (!urlKey) return
      const values = listUrlValues(urlKey, patch)
      setAhead({
        from: snapshot(urlKey),
        raw: snapshot(urlKey, patchHashQuery(window.location.hash, values))
      })
      writeQuery(values, history)
    },
    [urlKey]
  )
  return { state, write }
}
