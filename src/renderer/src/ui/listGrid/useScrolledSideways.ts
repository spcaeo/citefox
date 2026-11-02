import { useEffect } from 'react'

/** The attribute a grid's scroll box carries while it is scrolled sideways. */
export const SCROLLED_ATTR = 'data-scrolled-x'

/**
 * Marks the scroll box with `data-scrolled-x` while it is scrolled sideways,
 * so the pinned column's soft edge shadow shows only then (audit2 #6). It
 * sets the attribute on the node itself, so scrolling never re-renders the grid.
 */
export function useScrolledSideways(node: HTMLElement | null, on: boolean): void {
  useEffect(() => {
    if (!node || !on) return undefined
    const update = (): void => {
      node.toggleAttribute(SCROLLED_ATTR, node.scrollLeft > 0)
    }
    update()
    node.addEventListener('scroll', update, { passive: true })
    return () => {
      node.removeEventListener('scroll', update)
      node.removeAttribute(SCROLLED_ATTR)
    }
  }, [node, on])
}
