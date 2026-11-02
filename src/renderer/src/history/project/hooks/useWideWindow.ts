import { useSyncExternalStore } from 'react'
import { WIDE_WINDOW } from '../model'

const QUERY = `(min-width: ${WIDE_WINDOW}px)`

function media(): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(QUERY)
}

function subscribe(listener: () => void): () => void {
  const list = media()
  if (list === null) return () => undefined
  list.addEventListener('change', listener)
  return () => list.removeEventListener('change', listener)
}

/** True in a window wide enough for every default column (Check history's grid). */
export function useWideWindow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false
  )
}
