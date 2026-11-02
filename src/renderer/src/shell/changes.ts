import { useSyncExternalStore } from 'react'

/**
 * A window-wide "this data changed" signal. A window-wide drawer (Edit competitor,
 * Log a fix) saves over whatever screen is open, and that screen may not be the one
 * that opened it (a pasted link opens the drawer alone). The drawer calls
 * `notifyChanged`; a screen that shows the data reloads when `useChangeVersion` moves.
 */
export type ChangeArea = 'competitors' | 'fixes' | 'pageChanges' | 'siteTypes'

const versions = new Map<ChangeArea, number>()
const listeners = new Set<() => void>()

export function notifyChanged(area: ChangeArea): void {
  versions.set(area, (versions.get(area) ?? 0) + 1)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Bumps each time `area` changes; 0 until the first change. */
export function useChangeVersion(area: ChangeArea): number {
  return useSyncExternalStore(
    subscribe,
    () => versions.get(area) ?? 0,
    () => 0
  )
}
