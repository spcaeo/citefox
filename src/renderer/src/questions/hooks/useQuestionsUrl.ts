import { useCallback, useEffect, useRef, useState } from 'react'
import { navigateHash, replaceHash } from '../../shell/routes'
import { leaveOverlayHash, pushOverlayHash } from '../../utils/screenOverlay'
import { parseView, viewQuery, type QuestionsView } from '../model'

/** Search text reaches the URL this long after the last key, so Back is not one step per letter. */
const SEARCH_DELAY_MS = 250

function currentQuery(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return at < 0 ? '' : hash.slice(at + 1)
}

/** The route part of the hash (`#/questions`, or `#/p/<id>/questions` before the switch). */
function currentPath(): string {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  const path = at < 0 ? hash : hash.slice(0, at)
  return path === '' || path === '#' || path === '#/' ? '#/questions' : path
}

/** The hash for a view on this screen, keeping query keys it does not own (such as `dialog`). */
export function questionsHash(view: QuestionsView): string {
  const query = viewQuery(view, currentQuery())
  return query ? `${currentPath()}?${query}` : currentPath()
}

/** The current hash with extra query values, such as `drawer=add-questions`. */
export function withParams(view: QuestionsView, extra: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams(viewQuery(view, currentQuery()))
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return `${currentPath()}?${params.toString()}`
}

export interface QuestionsUrl {
  view: QuestionsView
  /** The search box text, ahead of the URL while typing. */
  search: string
  setSearch: (text: string) => void
  /** Changes the view. A filter, sort or grouping is a new history entry; `replace` is not. */
  update: (patch: Partial<QuestionsView>, replace?: boolean) => void
  /** Opens a drawer or confirm kept in the view (`panel`, `confirm`): a new entry Back closes. */
  openOverlay: (patch: Partial<QuestionsView>) => void
  /** Closes it: one step back when this window opened it, else the URL is rewritten. */
  closeOverlay: () => void
}

/**
 * The screen's state lives in its URL (`#/questions?…`), so every filter, sort, grouping,
 * search and the marked row can be copied and pasted, and Back and Forward step through
 * them. The hash is the source of truth; this hook follows `hashchange`.
 */
export function useQuestionsUrl(): QuestionsUrl {
  const [view, setView] = useState<QuestionsView>(() => parseView(currentQuery()))
  const [search, setSearchText] = useState(view.q)
  const viewRef = useRef(view)
  const searchRef = useRef(view.q)
  /** The search text this hook last wrote, to tell its own writes from Back and Forward. */
  const written = useRef(view.q)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    function follow(): void {
      const next = parseView(currentQuery())
      viewRef.current = next
      setView(next)
      if (next.q !== written.current) {
        written.current = next.q
        searchRef.current = next.q
        setSearchText(next.q)
      }
    }
    window.addEventListener('hashchange', follow)
    return () => {
      window.removeEventListener('hashchange', follow)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const update = useCallback((patch: Partial<QuestionsView>, replace = false) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const next = { ...viewRef.current, q: searchRef.current, ...patch }
    written.current = next.q
    viewRef.current = next
    setView(next)
    const hash = questionsHash(next)
    if (replace) replaceHash(hash)
    else navigateHash(hash)
  }, [])

  const setSearch = useCallback(
    (text: string) => {
      searchRef.current = text
      setSearchText(text)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        update({ q: text }, true)
      }, SEARCH_DELAY_MS)
    },
    [update]
  )

  const openOverlay = useCallback((patch: Partial<QuestionsView>) => {
    const next = { ...viewRef.current, q: searchRef.current, ...patch }
    written.current = next.q
    viewRef.current = next
    setView(next)
    pushOverlayHash(questionsHash(next))
  }, [])

  const closeOverlay = useCallback(() => {
    const next: QuestionsView = {
      ...viewRef.current,
      q: searchRef.current,
      panel: null,
      confirm: null,
      pick: []
    }
    written.current = next.q
    viewRef.current = next
    setView(next)
    leaveOverlayHash(questionsHash(next))
  }, [])

  return { view, search, setSearch, update, openOverlay, closeOverlay }
}
