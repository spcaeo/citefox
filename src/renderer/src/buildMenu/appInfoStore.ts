import { useEffect, useSyncExternalStore } from 'react'
import type { AppInfo } from '@shared/ipc'
import { useBuildTools } from './buildClient'

/**
 * `app:getInfo` read once per window and shared: App.tsx asks first (it
 * reports a broken bridge), every build chip and Settings › About reuse it.
 * A failed read is not cached, so the next caller tries again.
 */

let cached: AppInfo | null = null
let pending: Promise<AppInfo> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): AppInfo | null {
  return cached
}

/** The app info, fetched with `fetch` the first time only. */
export function loadAppInfo(fetch: () => Promise<AppInfo>): Promise<AppInfo> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = fetch().then(
      (info) => {
        cached = info
        pending = null
        emit()
        return info
      },
      (cause: unknown) => {
        pending = null
        throw cause
      }
    )
  }
  return pending
}

/** Forgets the cached info (tests). */
export function resetAppInfoCache(): void {
  cached = null
  pending = null
  emit()
}

/**
 * The app's name, version, build and test-profile flag; null until read (or
 * when it cannot be read). `fetch` defaults to the build host's client.
 */
export function useAppInfo(fetch?: () => Promise<AppInfo>): AppInfo | null {
  const { client } = useBuildTools()
  const info = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (cached) return
    loadAppInfo(fetch ?? (() => client.getInfo())).catch(() => undefined)
  }, [fetch, client])
  return info
}
