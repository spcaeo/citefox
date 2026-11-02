import { useRef, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './useColumnLayout'

/** One arrow-key press moves a column edge this far. */
export const RESIZE_STEP = 16

/**
 * The drag edge at the right of a column header (grid audit R6): drag to
 * resize, double-click to go back to the column's own width. With focus,
 * Left and Right arrows resize by 16 px and Enter resets. Each drag frame
 * resizes the columns live; the new width is saved when the drag ends.
 */
export function ResizeHandle({
  label,
  width,
  onResize,
  onReset,
  onDragging
}: {
  /** The column's name, for "Resize Market column". */
  label: string
  /** The column's width now, in pixels. */
  width: number
  onResize: (width: number, commit: boolean) => void
  onReset: () => void
  /** True while a drag is under way (the grid shows the resize cursor everywhere). */
  onDragging: (dragging: boolean) => void
}): JSX.Element {
  const drag = useRef<{ x: number; width: number; frame: number; next: number } | null>(null)

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const header = event.currentTarget.parentElement
    const start = header ? header.getBoundingClientRect().width : width
    drag.current = { x: event.clientX, width: start || width, frame: 0, next: start || width }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (!current) return
    current.next = current.width + event.clientX - current.x
    // One resize per frame keeps a long grid smooth while the pointer moves fast.
    if (current.frame === 0) {
      current.frame = requestAnimationFrame(() => {
        current.frame = 0
        onResize(current.next, false)
      })
    }
  }

  function end(event: PointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (!current) return
    if (current.frame !== 0) cancelAnimationFrame(current.frame)
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onDragging(false)
    if (current.next !== current.width) onResize(current.next, true)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      onResize(width + (event.key === 'ArrowRight' ? RESIZE_STEP : -RESIZE_STEP), true)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onReset()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      title="Drag to resize. Double-click to reset."
      tabIndex={0}
      className="ui-lg-resize"
      data-no-row-open=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={onKeyDown}
    />
  )
}
