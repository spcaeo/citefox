import { navigateHash, replaceHash } from '../shell/routes'

/**
 * History for a drawer a screen keeps in its own URL value (`?panel=method`,
 * `?action=merge&topic=<id>`), the second way in Docs/DRAWER.md "Adding a
 * drawer". Opening is a new history entry, so Back closes it and a copied
 * link reopens it. Closing goes back through history when this window opened
 * it from exactly the screen it returns to, so the closed drawer is never one
 * Back step away; a drawer opened from a pasted link rewrites the URL instead.
 */

/** How long a close waits for its history step before rewriting the URL instead. */
const CLOSE_FALLBACK_MS = 600
/** Where the history entry an overlay opened remembers the screen it was opened from. */
const STATE_KEY = 'citefoxOverlay'

interface OverlayMark {
  /** The overlay's hash (normalised). */
  to: string
  /** The hash it was opened from (normalised). */
  from: string
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function entryMark(): OverlayMark | null {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null) return null
  const mark = (state as Record<string, unknown>)[STATE_KEY]
  if (typeof mark !== 'object' || mark === null) return null
  const { to, from } = mark as Record<string, unknown>
  return typeof to === 'string' && typeof from === 'string' ? { to, from } : null
}

/** `#/path?b=2&a=1` and `/path?a=1&b=2` compare equal. */
export function normalHash(hash: string): string {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  const path = (at < 0 ? plain : plain.slice(0, at)) || '/'
  const params = new URLSearchParams(at < 0 ? '' : plain.slice(at + 1))
  const sorted = [...params.entries()]
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = new URLSearchParams(sorted).toString()
  return query ? `${path}?${query}` : path
}

/**
 * Opens a screen's drawer at `next` as a new history entry, which remembers the
 * screen it was opened from (so Back and Forward keep working after a close).
 */
export function pushOverlayHash(next: string): void {
  const from = normalHash(currentHash())
  const to = normalHash(next)
  if (from === to) return
  navigateHash(next)
  const base: unknown = window.history.state
  window.history.replaceState(
    { ...(typeof base === 'object' && base !== null ? base : {}), [STATE_KEY]: { to, from } },
    ''
  )
}

/**
 * Closes a screen's drawer, landing on `next` (the screen without it): one
 * step back when this history entry opened it from `next`, else a rewrite in
 * place (a pasted link has nothing of its own to go back to).
 */
export function leaveOverlayHash(next: string): void {
  const here = normalHash(currentHash())
  const target = normalHash(next)
  if (here === target) return
  const mark = entryMark()
  if (mark !== null && mark.to === here && mark.from === target) {
    // Should the step never come, rewrite the entry instead. The first hash change
    // (the step landing) cancels that, so a quick reopen is never closed by it.
    const landed = (): void => {
      clearTimeout(timer)
      window.removeEventListener('hashchange', landed)
    }
    const timer = setTimeout(() => {
      window.removeEventListener('hashchange', landed)
      if (normalHash(currentHash()) === here) replaceHash(next)
    }, CLOSE_FALLBACK_MS)
    window.addEventListener('hashchange', landed)
    window.history.back()
    return
  }
  replaceHash(next)
}
