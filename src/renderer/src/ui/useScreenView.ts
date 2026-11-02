import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { navigateHash, replaceHash } from '../shell/routes'
import { patchHashQuery, readHashQuery } from '../utils/hashQuery'

/**
 * Where a screen's last view is kept: per project and per screen key, in the
 * project file's `saved_views` (`grid:getScreenView` / `grid:setScreenView`).
 */
export interface ScreenViewStore {
  get: (projectId: string, screen: string) => Promise<string | null>
  set: (projectId: string, screen: string, view: string) => Promise<void>
}

let ipcStore: { api: Window['citefox']; store: ScreenViewStore } | null = null

/** The store over IPC (one per bridge), or null outside the app (tests, a browser preview). */
export function ipcScreenViewStore(): ScreenViewStore | null {
  if (typeof window === 'undefined' || !window.citefox) return null
  const api = window.citefox
  if (ipcStore?.api === api) return ipcStore.store
  const store: ScreenViewStore = {
    get: async (projectId, screen) => (await api['grid:getScreenView']({ projectId, screen })).view,
    set: async (projectId, screen, view) => {
      await api['grid:setScreenView']({ projectId, screen, view })
    }
  }
  ipcStore = { api, store }
  return store
}

export interface ScreenViewOptions {
  /** The open project. Null: the view lives in the URL only. */
  projectId: string | null
  /** The URL key. Default `view`. */
  param?: string
  /** Default: the IPC store. Null keeps nothing. */
  store?: ScreenViewStore | null
}

export interface ScreenViewState<V extends string> {
  view: V
  /** Shows a view: a new history entry (Back returns), and remembered. */
  setView: (view: V) => void
  /** The current URL with `view` swapped, for a tab's link. */
  hrefFor: (view: V) => string
  /** False until the remembered view has loaded (the default shows meanwhile). */
  ready: boolean
}

/**
 * The last view per project and screen, so a second visit opens at once; ''
 * is "loaded, none stored". Every screen showing it redraws on a change.
 */
const remembered = new Map<string, string>()
const memoryListeners = new Set<() => void>()

function subscribeMemory(listener: () => void): () => void {
  memoryListeners.add(listener)
  return () => memoryListeners.delete(listener)
}

function setMemory(key: string, view: string): void {
  remembered.set(key, view)
  for (const listener of memoryListeners) listener()
}

/** Forgets every remembered view held in memory (tests). */
export function resetScreenViewMemory(): void {
  remembered.clear()
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

/** The route part of a hash, without its query: `#/topics/t1`. */
function routeOf(hash: string): string {
  return hash.split('?')[0] ?? ''
}

/**
 * The view a screen shows (Tree, Grid, List, Pages, Progress). The URL says
 * first (`?view=grid`, so Back, Forward and a copied link work); without one,
 * the view last shown on this screen in this project; else `defaultView`. A
 * view picked or opened from a link is remembered in `saved_views`. A
 * remembered view other than the default is written into the URL in place
 * (no new history entry), so the address always says what shows.
 */
export function useScreenView<V extends string>(
  screenKey: string,
  allowedViews: readonly V[],
  defaultView: V,
  options: ScreenViewOptions
): ScreenViewState<V> {
  const { projectId } = options
  const param = options.param ?? 'view'
  const store = options.store === undefined ? ipcScreenViewStore() : options.store
  const memoryKey = projectId === null ? null : `${projectId}\u0000${screenKey}`
  const allowedKey = allowedViews.join('|')
  const isAllowed = useCallback(
    (value: string | null | undefined): value is V =>
      value !== null && value !== undefined && allowedKey.split('|').includes(value),
    [allowedKey]
  )

  const hash = useSyncExternalStore(subscribe, currentHash, () => '')
  // The screen's own route: a remembered view is only written there, never onto
  // the route a click just moved to while this screen is still mounted.
  const [route] = useState(() => routeOf(currentHash()))
  const urlValue = readHashQuery([param], hash)[param]
  const urlView = isAllowed(urlValue) ? urlValue : null

  const known = useSyncExternalStore(
    subscribeMemory,
    () => (memoryKey === null ? undefined : remembered.get(memoryKey)),
    () => undefined
  )
  const savedView = isAllowed(known) ? known : null
  const ready = memoryKey === null || store === null || known !== undefined
  // A pick shows at once, before the hash change reaches listeners.
  const [ahead, setAhead] = useState<{ from: string; view: V } | null>(null)
  if (ahead !== null && ahead.from !== hash) setAhead(null)

  useEffect(() => {
    if (memoryKey === null || projectId === null || store === null) return
    if (remembered.has(memoryKey)) return
    let live = true
    store
      .get(projectId, screenKey)
      .catch(() => null)
      .then((value) => {
        // A view picked meanwhile wins over the stored one.
        if (live && !remembered.has(memoryKey)) setMemory(memoryKey, value ?? '')
      })
    return () => {
      live = false
    }
  }, [memoryKey, projectId, screenKey, store])

  const remember = useCallback(
    (next: V) => {
      if (memoryKey === null || projectId === null) return
      if (remembered.get(memoryKey) === next) return
      setMemory(memoryKey, next)
      store?.set(projectId, screenKey, next).catch(() => undefined)
    },
    [memoryKey, projectId, screenKey, store]
  )

  // A view opened from the URL (a link, Back, Forward) becomes the remembered
  // one, and wins over a stored one still loading.
  useEffect(() => {
    if (urlView !== null) remember(urlView)
  }, [urlView, remember])

  // No view in the URL: put the remembered one there, replacing this entry.
  useEffect(() => {
    if (urlView !== null || !ready || savedView === null || savedView === defaultView) return
    if (routeOf(currentHash()) !== route) return
    replaceHash(patchHashQuery(currentHash(), { [param]: savedView }))
  }, [urlView, ready, savedView, defaultView, param, route])

  const hrefFor = useCallback(
    (next: V) => patchHashQuery(hash || '#/', { [param]: next }),
    [hash, param]
  )

  const setView = useCallback(
    (next: V) => {
      remember(next)
      const target = patchHashQuery(currentHash() || '#/', { [param]: next })
      if (target === currentHash()) return
      setAhead({ from: currentHash(), view: next })
      navigateHash(target)
    },
    [remember, param]
  )

  const view = ahead?.view ?? urlView ?? savedView ?? defaultView
  return useMemo(() => ({ view, setView, hrefFor, ready }), [view, setView, hrefFor, ready])
}
