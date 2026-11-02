import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { readQueryValue, writeQuery } from '../../../utils/queryState'
import { formatOpen, parseOpen, type OpenState } from './model'

/** The URL keys a tree grid with `urlKey` writes, besides `listUrlKeys` (a drawer lists both). */
export function treeUrlKeys(urlKey: string): readonly string[] {
  return [`${urlKey}.open`, `${urlKey}.more`]
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

function read(urlKey: string | undefined, name: 'open' | 'more'): string {
  if (!urlKey || typeof window === 'undefined') return ''
  return readQueryValue(window.location.hash, `${urlKey}.${name}`) ?? ''
}

export interface TreeState {
  open: OpenState
  /** Groups that show every leaf, past "Show N more". */
  more: ReadonlySet<string>
  setOpen: (next: OpenState) => void
  showMore: (id: string) => void
}

/**
 * Which groups are open and which show all their leaves. With a `urlKey` both
 * live in the hash URL (`<key>.open`, `<key>.more`, opaque ids only), so Back,
 * Forward and a copied link reopen the same groups; each click is a new
 * history entry. Without one they last while the grid is shown.
 */
export function useTreeState(urlKey: string | undefined): TreeState {
  const rawOpen = useSyncExternalStore(
    subscribe,
    () => read(urlKey, 'open'),
    () => ''
  )
  const rawMore = useSyncExternalStore(
    subscribe,
    () => read(urlKey, 'more'),
    () => ''
  )
  const [own, setOwn] = useState<{ open: OpenState; more: ReadonlySet<string> }>(() => ({
    open: { kind: 'default' },
    more: new Set()
  }))
  // A click redraws at once; the hash change confirms it a moment later.
  const [ahead, setAhead] = useState<{ from: string; open: string; more: string } | null>(null)
  const from = `${rawOpen}\u0000${rawMore}`
  if (ahead !== null && ahead.from !== from) setAhead(null)
  const openText = ahead?.open ?? rawOpen
  const moreText = ahead?.more ?? rawMore

  const fromUrl = useMemo(
    () => ({
      open: parseOpen(openText || null),
      more: new Set(moreText.split(',').filter((id) => /^[a-z0-9]+$/.test(id)))
    }),
    [openText, moreText]
  )
  const state = urlKey ? fromUrl : own

  const write = useCallback(
    (open: OpenState, more: ReadonlySet<string>) => {
      if (!urlKey) {
        setOwn({ open, more })
        return
      }
      const openValue = formatOpen(open)
      const moreValue = more.size > 0 ? [...more].join(',') : null
      setAhead({ from, open: openValue ?? '', more: moreValue ?? '' })
      writeQuery({ [`${urlKey}.open`]: openValue, [`${urlKey}.more`]: moreValue }, 'push')
    },
    [urlKey, from]
  )

  const setOpen = useCallback((next: OpenState) => write(next, state.more), [write, state.more])
  const showMore = useCallback(
    (id: string) => write(state.open, new Set([...state.more, id])),
    [write, state.open, state.more]
  )
  return { open: state.open, more: state.more, setOpen, showMore }
}
