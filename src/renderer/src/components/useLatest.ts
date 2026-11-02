import { useEffect, useRef, type RefObject } from 'react'

/**
 * A ref that always holds the latest `value`. Effects that should run once
 * (or only when their real inputs change) read callbacks through it, so a
 * parent passing a new inline function does not re-run them.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
