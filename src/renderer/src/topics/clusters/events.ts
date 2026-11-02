/**
 * A window event for "the project's topics changed" (created, renamed, merged, moved
 * into, removed), so the sidebar's Topics list and open screens reload at once
 * instead of waiting for the next finished check.
 */
const EVENT = 'citefox:topics-changed'

export function notifyTopicsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(EVENT))
}

/** Calls `listener` on each change; returns the unsubscribe. */
export function onTopicsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
