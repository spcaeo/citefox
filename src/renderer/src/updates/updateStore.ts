import { useEffect, useSyncExternalStore } from 'react'
import type { UpdateStatus } from '@shared/ipc'
import { ipcUpdatesClient, NO_UPDATE, type UpdatesClient } from '../account/client'

/**
 * The newest-release status, read once per window and shared by the banner,
 * the footer dot and "Check for updates" in the ⚙ menu.
 */

let cached: UpdateStatus = NO_UPDATE
let loaded = false
let client: UpdatesClient | null | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): UpdateStatus {
  return cached
}

function currentClient(): UpdatesClient | null {
  // Read the bridge each time: a test may install or remove it between renders.
  return client === undefined ? ipcUpdatesClient() : client
}

function set(next: UpdateStatus): UpdateStatus {
  cached = next
  emit()
  return next
}

/** Tests: use this client (or none) and forget what was read. */
export function resetUpdateStore(next?: UpdatesClient | null): void {
  client = next
  cached = NO_UPDATE
  loaded = false
  emit()
}

/** True when this window can ask main (false in tests and the mock). */
export function canCheckForUpdates(): boolean {
  return currentClient() !== null
}

/** "Check for updates": reads GitHub now. Null when this window cannot check. */
export async function checkForUpdates(): Promise<UpdateStatus | null> {
  const c = currentClient()
  if (!c) return null
  return set(await c.check())
}

/** Closes the banner until the next release. */
export async function dismissUpdate(): Promise<void> {
  const c = currentClient()
  const latest = cached.latest
  if (!c || !latest) return
  set({ ...cached, dismissed: true })
  try {
    set(await c.dismiss({ version: latest.version, build: latest.build }))
  } catch {
    // Stays closed for this window.
  }
}

/** The shared status; the first caller asks main (which may read GitHub when due). */
export function useUpdateStatus(): UpdateStatus {
  const status = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (loaded) return
    const c = currentClient()
    if (!c) return
    loaded = true
    c.get().then(set, () => {
      loaded = false
    })
  }, [])
  return status
}
