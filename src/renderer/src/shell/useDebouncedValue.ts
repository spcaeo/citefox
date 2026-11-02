import { useEffect, useState } from 'react'

/** Pause in typing before the sidebar page search calls `pages:search`. */
export const SEARCH_DEBOUNCE_MS = 200

/** `value`, once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}
