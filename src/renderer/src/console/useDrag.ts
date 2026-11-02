import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { ConsolePosition } from './types'

/** Keeps at least this much of the window on screen. */
const MARGIN = 8

/** `position` kept inside the viewport for a window of `width` × `height`. */
export function clampPosition(
  position: ConsolePosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): ConsolePosition {
  const maxX = Math.max(MARGIN, viewport.width - size.width - MARGIN)
  const maxY = Math.max(MARGIN, viewport.height - size.height - MARGIN)
  return {
    x: Math.round(Math.min(Math.max(MARGIN, position.x), maxX)),
    y: Math.round(Math.min(Math.max(MARGIN, position.y), maxY))
  }
}

/**
 * Drag the console by its title bar (pointer events, so mouse, pen and touch).
 * Buttons in the bar keep working: a press on a button never starts a drag.
 * `onMove` gets the new top-left corner, kept on screen.
 */
export function useDrag(
  target: RefObject<HTMLElement | null>,
  onMove: (position: ConsolePosition) => void
): (event: ReactPointerEvent<HTMLElement>) => void {
  const start = useRef<{ dx: number; dy: number } | null>(null)
  return useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('button, a, input, label')) return
      const node = target.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      start.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
      const handle = event.currentTarget
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        // Not every environment supports capture; moves still arrive on the window.
      }
      event.preventDefault()
      const move = (next: PointerEvent): void => {
        if (!start.current) return
        onMove(
          clampPosition(
            { x: next.clientX - start.current.dx, y: next.clientY - start.current.dy },
            { width: rect.width, height: rect.height },
            { width: window.innerWidth, height: window.innerHeight }
          )
        )
      }
      const up = (): void => {
        start.current = null
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [target, onMove]
  )
}
