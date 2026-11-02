import { useCallback, useEffect, useState } from 'react'
import { navigateHash } from './routes'

/** The `?tab=` value of a hash such as `#/projects?tab=usage`, or null. */
export function hashTab(hash: string, key = 'tab'): string | null {
  const at = hash.indexOf('?')
  if (at < 0) return null
  return new URLSearchParams(hash.slice(at + 1)).get(key)
}

/** `hash` with `?tab=` set to `value`, or removed when `value` is null. Other params stay. */
export function withHashTab(hash: string, value: string | null, key = 'tab'): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const at = raw.indexOf('?')
  const path = at < 0 ? raw : raw.slice(0, at)
  const params = new URLSearchParams(at < 0 ? '' : raw.slice(at + 1))
  if (value === null) params.delete(key)
  else params.set(key, value)
  const query = params.toString()
  return `#${path}${query ? `?${query}` : ''}`
}

function current<T extends string>(ids: readonly T[], fallback: T, key: string): T {
  if (typeof window === 'undefined') return fallback
  const value = hashTab(window.location.hash, key)
  return ids.find((id) => id === value) ?? fallback
}

/**
 * A screen's selected tab kept in the route (`?tab=<id>`, the first tab has
 * none), so every tab has a copyable URL and Back and Forward step through
 * tab changes. Unknown values open the first tab.
 */
export function useHashTab<T extends string>(
  ids: readonly T[],
  fallback: T,
  key = 'tab'
): [T, (tab: T) => void] {
  const [tab, setTab] = useState<T>(() => current(ids, fallback, key))
  useEffect(() => {
    const sync = (): void => setTab(current(ids, fallback, key))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [ids, fallback, key])
  const select = useCallback(
    (next: T) => {
      setTab(next)
      const hash = withHashTab(window.location.hash, next === fallback ? null : next, key)
      if (hash !== (window.location.hash || '#')) navigateHash(hash)
    },
    [fallback, key]
  )
  return [tab, select]
}
