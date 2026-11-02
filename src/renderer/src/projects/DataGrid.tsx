import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import { clickedRow } from '../components/rowActivation'
import { nextRowIndex, rowWindow } from './gridModel'

const OVERSCAN = 4

export function VirtualWindow({
  count,
  rowHeight,
  viewport,
  focusIndex,
  onFocusIndex,
  onActivate,
  label,
  role = 'grid',
  children
}: {
  count: number
  rowHeight: number
  viewport: number
  focusIndex: number
  onFocusIndex: (index: number) => void
  onActivate?: (index: number) => void
  label: string
  role?: 'grid' | 'region'
  children: (start: number, end: number, paddingTop: number, paddingBottom: number) => ReactNode
}): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const [scrollTop, setScrollTop] = useState(0)
  const { start, end, paddingTop, paddingBottom } = rowWindow(
    count,
    scrollTop,
    viewport,
    rowHeight,
    OVERSCAN
  )

  useEffect(() => {
    const node = scroller.current
    if (!node || !moved.current) return
    const top = focusIndex * rowHeight
    let nextScroll = node.scrollTop
    if (top < node.scrollTop) nextScroll = top
    else if (top + rowHeight > node.scrollTop + viewport) {
      nextScroll = top + rowHeight - viewport
    }
    if (nextScroll !== node.scrollTop) {
      node.scrollTop = nextScroll
      setScrollTop(nextScroll)
      return
    }
    const row = node.querySelector<HTMLElement>(`[data-row="${focusIndex}"]`)
    row?.focus()
    moved.current = false
  }, [focusIndex, rowHeight, viewport, start, end])

  /**
   * Keys act only on the list itself or on a row (`data-row`). Links, buttons,
   * fields and header controls inside keep their own Enter and arrow keys.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement
    const onGrid = event.currentTarget === target
    const rowAttr = target.dataset?.row
    const onRow = rowAttr !== undefined
    if (!onGrid && !onRow) return
    if (event.key === 'Enter') {
      if (!onRow || !onActivate) return
      event.preventDefault()
      onActivate(Number(rowAttr))
      return
    }
    if (onGrid && (event.key === 'ArrowDown' || event.key === 'Home')) {
      event.preventDefault()
      moved.current = true
      if (focusIndex !== 0 && event.key === 'Home') onFocusIndex(0)
      else {
        scroller.current?.querySelector<HTMLElement>(`[data-row="${focusIndex}"]`)?.focus()
        moved.current = false
      }
      return
    }
    const from = onRow ? Number(rowAttr) : focusIndex
    const next = nextRowIndex(from, count, event.key)
    if (next === null) return
    event.preventDefault()
    if (next === focusIndex) {
      scroller.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus()
      return
    }
    moved.current = true
    onFocusIndex(next)
  }

  /** A row that gets focus by click or Tab becomes the arrow keys' starting point. */
  function onFocus(event: FocusEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-row]')
    const at = row?.dataset.row
    if (at === undefined) return
    const index = Number(at)
    if (index !== focusIndex) onFocusIndex(index)
  }

  /** A click on a row (not on a control inside it) opens it, the same as Enter. */
  function onClick(event: MouseEvent<HTMLDivElement>): void {
    if (!onActivate) return
    const row = clickedRow(event.target, 'data-row')
    const at = row?.dataset.row
    if (at === undefined) return
    onActivate(Number(at))
  }

  return (
    <div
      ref={scroller}
      className="vscroll"
      style={{ maxHeight: viewport }}
      tabIndex={0}
      role={role}
      aria-label={label}
      aria-rowcount={role === 'grid' ? count : undefined}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onClick={onClick}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {children(start, end, paddingTop, paddingBottom)}
    </div>
  )
}
