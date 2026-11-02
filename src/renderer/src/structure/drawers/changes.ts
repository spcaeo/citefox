import { useSyncExternalStore } from 'react'

/**
 * Pages, clusters and groups changed in a drawer that opens over any screen
 * (Move pages, Add pages, a cluster or group drawer). All pages and Site
 * structure list `usePagesRevision()` as a reload dependency, so the screen
 * under the drawer shows the change at once.
 */
let revision = 0
const listeners = new Set<() => void>()

export function notifyPagesChanged(): void {
  revision += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): number {
  return revision
}

export function usePagesRevision(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
