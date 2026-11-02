import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { GridSortKey } from '@shared/domain'
import { navigateHash, replaceHash } from '../shell/routes'
import { patchHashQuery } from './hashQuery'

/**
 * One value of a screen's (or a drawer's) state in the hash query, so every
 * grid state has a URL: its search, filter, sort and selection survive a
 * copied link, and Back steps through the changes that push. Typing writes in
 * place (`replace`, the default) so Back is not a keystroke undo; a filter or
 * tab change can `push`. Docs/DRAWER.md "Grid state in the URL".
 *
 *   const [q, setQ] = useQueryState('drill.q')
 *   const grid = useGridQueryState('drill')   // drill.q, drill.f, drill.sort, drill.pick
 *   <ListGrid {...grid.listProps} … />
 */

export type QueryHistory = 'replace' | 'push'

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** The value of `key` in `hash`'s query, or null when it is missing or empty. */
export function readQueryValue(hash: string, key: string): string | null {
  const at = hash.indexOf('?')
  if (at < 0) return null
  return new URLSearchParams(hash.slice(at + 1)).get(key) || null
}

/** Writes `patch` (null removes a key) into the URL, in place or as a new entry. */
export function writeQuery(
  patch: Readonly<Record<string, string | null>>,
  history: QueryHistory = 'replace'
): void {
  const hash = currentHash()
  const next = patchHashQuery(hash, patch)
  if (next === hash) return
  if (history === 'push') navigateHash(next)
  else replaceHash(next)
}

/** A comma list (`a,b,c`): empty items are dropped. */
export function parseList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function formatList(items: readonly string[]): string | null {
  return items.length > 0 ? items.join(',') : null
}

/** A grid sort (`pos:asc,odds:desc`). Unknown directions are dropped. */
export function parseSort(value: string | null): GridSortKey[] {
  return parseList(value).flatMap((item) => {
    const [key, dir] = item.split(':')
    return key && (dir === 'asc' || dir === 'desc') ? [{ key, dir }] : []
  })
}

export function formatSort(sort: readonly GridSortKey[]): string | null {
  return formatList(sort.map((item) => `${item.key}:${item.dir}`))
}

/** One string value of the hash query, following Back, Forward and other writers. */
export function useQueryState(
  key: string,
  options: { history?: QueryHistory } = {}
): [string | null, (value: string | null) => void] {
  const history = options.history ?? 'replace'
  const value = useSyncExternalStore(
    subscribe,
    () => readQueryValue(currentHash(), key),
    () => null
  )
  const set = useCallback(
    (next: string | null) => writeQuery({ [key]: next === '' ? null : next }, history),
    [key, history]
  )
  return [value, set]
}

/** A comma list in the hash query, such as the picked rows of a grid. */
export function useQueryList(
  key: string,
  options: { history?: QueryHistory } = {}
): [readonly string[], (items: readonly string[]) => void] {
  const [raw, setRaw] = useQueryState(key, options)
  const items = useMemo(() => parseList(raw), [raw])
  const set = useCallback((next: readonly string[]) => setRaw(formatList(next)), [setRaw])
  return [items, set]
}

/** A grid sort in the hash query. */
export function useQuerySort(
  key: string,
  options: { history?: QueryHistory } = {}
): [readonly GridSortKey[], (sort: readonly GridSortKey[]) => void] {
  const [raw, setRaw] = useQueryState(key, options)
  const sort = useMemo(() => parseSort(raw), [raw])
  const set = useCallback((next: readonly GridSortKey[]) => setRaw(formatSort(next)), [setRaw])
  return [sort, set]
}

export interface GridQueryState {
  /** `<prefix>.q`: the search box. */
  search: string
  setSearch: (value: string) => void
  /** `<prefix>.f`: the picked filter (a tile, a segment). Null is "all". */
  filter: string | null
  setFilter: (value: string | null) => void
  /** `<prefix>.sort`: column sort, empty for the grid's default. */
  sort: readonly GridSortKey[]
  setSort: (sort: readonly GridSortKey[]) => void
  /** `<prefix>.pick`: ids of the picked rows. */
  selection: readonly string[]
  setSelection: (ids: readonly string[]) => void
  /** Spread on a ListGrid for a URL-backed search and sort. */
  listProps: {
    searchValue: string
    onSearchChange: (value: string) => void
    sort?: readonly GridSortKey[]
    onSortChange: (sort: readonly GridSortKey[]) => void
  }
}

/**
 * A grid's search, filter, sort and selection under one prefix, so two grids
 * (a screen's and its drawer's) never share keys. A drawer passes its own id
 * (`drill`) and lists those keys in shell/drawerUrl so they close with it.
 */
export function useGridQueryState(prefix: string): GridQueryState {
  const [search, setSearchRaw] = useQueryState(`${prefix}.q`)
  const [filter, setFilter] = useQueryState(`${prefix}.f`, { history: 'push' })
  const [sort, setSort] = useQuerySort(`${prefix}.sort`)
  const [selection, setSelection] = useQueryList(`${prefix}.pick`)
  const setSearch = useCallback((value: string) => setSearchRaw(value || null), [setSearchRaw])
  return {
    search: search ?? '',
    setSearch,
    filter,
    setFilter,
    sort,
    setSort,
    selection,
    setSelection,
    listProps: {
      searchValue: search ?? '',
      onSearchChange: setSearch,
      ...(sort.length > 0 ? { sort } : {}),
      onSortChange: setSort
    }
  }
}
