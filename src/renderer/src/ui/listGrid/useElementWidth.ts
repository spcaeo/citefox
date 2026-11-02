import { useEffect, useState, type RefObject } from 'react'

/** The element's inner width, kept current as the window or layout changes; 0 until measured. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const update = (): void => setWidth(node.clientWidth)
    update()
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update)
      observer.observe(node)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [ref])
  return width
}

/**
 * `useElementWidth` for an element that may mount later (pass it from a
 * callback ref's state): re-measures whenever the node changes.
 */
export function useNodeWidth(node: HTMLElement | null): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return undefined
    const update = (): void => setWidth(node.clientWidth)
    update()
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update)
      observer.observe(node)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [node])
  return width
}
