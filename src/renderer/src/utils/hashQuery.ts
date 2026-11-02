import { useCallback, useEffect, useState } from 'react'
import { navigateHash, replaceHash } from '../shell/routes'

/**
 * A screen's own state in the route's query (`#/competitors?period=7&site=s1f…`), so
 * every state has a URL: copy it, open it later, and Back and Forward step through it.
 * The path (and a `#/p/<projectId>/` prefix) is kept; only the named keys change.
 */

export type HashQuery<K extends string> = Readonly<Record<K, string | null>>

/** The named query values of `hash`. Missing or empty values are null. */
export function readHashQuery<K extends string>(keys: readonly K[], hash: string): HashQuery<K> {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const out = {} as Record<K, string | null>
  for (const key of keys) out[key] = params.get(key) || null
  return out
}

/** `hash` with `patch` applied: null removes a key, other keys stay as they are. */
export function patchHashQuery(
  hash: string,
  patch: Readonly<Record<string, string | null | undefined>>
): string {
  const at = hash.indexOf('?')
  const path = at === -1 ? hash : hash.slice(0, at)
  const params = new URLSearchParams(at === -1 ? '' : hash.slice(at + 1))
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
  }
  const text = params.toString()
  const base = path.length === 0 ? '#/' : path
  return text ? `${base}?${text}` : base
}

/**
 * The named query values, kept in step with the route. `set` writes a new history
 * entry (Back undoes it); `replace: true` rewrites the current one instead.
 */
export function useHashQuery<K extends string>(
  keys: readonly K[]
): [
  HashQuery<K>,
  (patch: Partial<Record<K, string | null>>, options?: { replace?: boolean }) => void
] {
  const signature = keys.join('|')
  const [values, setValues] = useState<HashQuery<K>>(() => readHashQuery(keys, currentHash()))

  useEffect(() => {
    const names = signature.split('|') as K[]
    function onHash(): void {
      const next = readHashQuery(names, currentHash())
      setValues((current) => (sameValues(names, current, next) ? current : next))
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [signature])

  const set = useCallback(
    (patch: Partial<Record<K, string | null>>, options: { replace?: boolean } = {}) => {
      const next = patchHashQuery(currentHash(), patch)
      if (next === currentHash()) return
      if (options.replace) replaceHash(next)
      else navigateHash(next)
      // Update now; the hashchange event confirms it.
      setValues(readHashQuery(signature.split('|') as K[], next))
    },
    [signature]
  )

  return [values, set]
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

function sameValues<K extends string>(
  keys: readonly K[],
  left: HashQuery<K>,
  right: HashQuery<K>
): boolean {
  return keys.every((key) => left[key] === right[key])
}
