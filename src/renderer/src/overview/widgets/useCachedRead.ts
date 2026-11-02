import { useEffect, useRef, useSyncExternalStore } from 'react'
import { errorText } from '../../components/errorText'

/**
 * One read shared by every widget that asks the same thing (two widgets on ChatGPT read
 * `reports:metrics` once). Keys carry the engine revision, so a finished check reads
 * again. Read-only channels only: nothing here spends a search.
 */
interface Entry {
  value?: unknown
  error?: string
  promise?: Promise<void>
}

const MAX_ENTRIES = 60
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function start(key: string, read: () => Promise<unknown>): void {
  if (cache.has(key)) return
  const pending: Entry = {}
  // Each finished read is a new entry object, so every widget showing it redraws.
  const settle = (next: Entry): void => {
    if (cache.get(key) !== pending) return
    cache.set(key, next)
    emit()
  }
  pending.promise = Promise.resolve()
    .then(read)
    .then(
      (value) => settle({ value }),
      (cause: unknown) => settle({ error: errorText(cause, 'Could not load this widget.') })
    )
  cache.set(key, pending)
  // Oldest reads go first, so memory stays small.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Forgets every cached read (tests). */
export function resetCachedReads(): void {
  cache.clear()
  emit()
}

export interface CachedRead<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** `read()` once per key. Null key: nothing to read (the widget has no source). */
export function useCachedRead<T>(key: string | null, read: () => Promise<T>): CachedRead<T> {
  const readRef = useRef(read)
  useEffect(() => {
    readRef.current = read
  })
  useEffect(() => {
    if (key !== null) start(key, () => readRef.current())
  }, [key])
  const entry = useSyncExternalStore(
    subscribe,
    () => (key === null ? undefined : cache.get(key)),
    () => undefined
  )
  if (key === null) return { data: null, error: null, loading: false }
  return {
    data: (entry?.value as T | undefined) ?? null,
    error: entry?.error ?? null,
    loading: entry === undefined || entry.promise !== undefined
  }
}
