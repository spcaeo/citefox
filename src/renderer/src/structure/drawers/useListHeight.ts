import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

function windowHeight(): number {
  return typeof window === 'undefined' ? 900 : window.innerHeight
}

/**
 * A picker list's height that leaves `reserve` pixels of window for the
 * drawer's header, footer and other sections, between `min` and `max`, so the
 * drawer body does not scroll around a scrolling list.
 */
export function useListHeight(reserve: number, max: number, min = 200): number {
  const height = useSyncExternalStore(subscribe, windowHeight, () => 900)
  return Math.max(min, Math.min(max, height - reserve))
}
