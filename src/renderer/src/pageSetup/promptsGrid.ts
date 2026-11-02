import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { nextRowIndex } from '../projects/gridModel'

/**
 * Keys for the Prompts list grid. Arrow keys, Home and End move between rows;
 * Enter on a row itself (not on a field, link or button inside it) calls
 * `onOpen` with that row's `data-prompt-id`. Keys in fields pass through.
 */
export function usePromptsGrid({
  count,
  resetKey,
  onOpen
}: {
  count: number
  /** Re-focuses the remembered row when this changes (the view mode). */
  resetKey: string
  onOpen: (promptId: string) => void
}): {
  gridRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
} {
  const [focusIndex, setFocusIndex] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const safeFocus = count === 0 ? 0 : Math.min(focusIndex, count - 1)

  useEffect(() => {
    if (!moved.current) return
    const row = gridRef.current?.querySelector<HTMLElement>(`[data-row="${safeFocus}"]`)
    row?.focus()
    row?.scrollIntoView({ block: 'nearest' })
    moved.current = false
  }, [safeFocus, resetKey])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
      return
    }
    const onGrid = event.currentTarget === event.target
    const row =
      event.target instanceof HTMLElement && event.target.getAttribute('role') === 'row'
        ? event.target
        : null
    if (!onGrid && !row) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const promptId = row?.dataset.promptId
      if (promptId) onOpen(promptId)
      return
    }
    if (onGrid && (event.key === 'ArrowDown' || event.key === 'Home')) {
      event.preventDefault()
      if (focusIndex !== 0 && event.key === 'Home') {
        moved.current = true
        setFocusIndex(0)
        return
      }
      gridRef.current?.querySelector<HTMLElement>(`[data-row="${safeFocus}"]`)?.focus()
      return
    }
    const next = nextRowIndex(safeFocus, count, event.key)
    if (next === null) return
    event.preventDefault()
    moved.current = true
    setFocusIndex(next)
  }

  return { gridRef, onKeyDown }
}
