import { useCallback, useEffect, useRef, useState } from 'react'
import { navigateHash, replaceHash } from '../../../shell/routes'
import { leaveOverlayHash, pushOverlayHash } from '../../../utils/screenOverlay'
import { parseTopicsView, topicsViewQuery, type TopicsView } from '../model'

function currentQuery(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return at < 0 ? '' : hash.slice(at + 1)
}

function currentPath(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  const path = at < 0 ? hash : hash.slice(0, at)
  return path === '' || path === '#' || path === '#/' ? '#/topics' : path
}

/** The hash for a view of this screen, keeping keys it does not own (such as `dialog`). */
export function topicsViewHash(view: TopicsView): string {
  const query = topicsViewQuery(view, currentQuery())
  return query ? `${currentPath()}?${query}` : currentPath()
}

/** The current hash with extra values, such as `drawer=add-questions&target=<id>`. */
export function topicsHashWith(view: TopicsView, extra: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams(topicsViewQuery(view, currentQuery()))
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return `${currentPath()}?${params.toString()}`
}

/**
 * The Topics screen's state lives in its URL (`#/topics?results=stage&action=rename&
 * topic=<id>`), so the results grouping, an open row action and the marked row can be
 * copied, and Back and Forward step through them.
 */
export function useTopicsUrl(): {
  view: TopicsView
  update: (patch: Partial<TopicsView>, replace?: boolean) => void
  /** Opens a row action's drawer or confirm (`action`, `topic`): a new entry Back closes. */
  openAction: (action: TopicsView['action'], topic: string) => void
  /** Closes it: one step back when this window opened it, else the URL is rewritten. */
  closeAction: () => void
} {
  const [view, setView] = useState<TopicsView>(() => parseTopicsView(currentQuery()))
  const viewRef = useRef(view)

  useEffect(() => {
    function follow(): void {
      const next = parseTopicsView(currentQuery())
      viewRef.current = next
      setView(next)
    }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  const update = useCallback((patch: Partial<TopicsView>, replace = false) => {
    const next = { ...viewRef.current, ...patch }
    viewRef.current = next
    setView(next)
    const hash = topicsViewHash(next)
    if (replace) replaceHash(hash)
    else navigateHash(hash)
  }, [])

  const openAction = useCallback((action: TopicsView['action'], topic: string) => {
    const next = { ...viewRef.current, action, topic }
    viewRef.current = next
    setView(next)
    pushOverlayHash(topicsViewHash(next))
  }, [])

  const closeAction = useCallback(() => {
    const next = { ...viewRef.current, action: null, topic: null }
    viewRef.current = next
    setView(next)
    leaveOverlayHash(topicsViewHash(next))
  }, [])

  return { view, update, openAction, closeAction }
}
