import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type UIEvent
} from 'react'

const OVERSCAN = 6
/** Lists at or under this many lines render every line. Longer lists render a window (NFR-12). */
export const VIRTUAL_THRESHOLD = 80

export interface RowWindow {
  scrollRef: RefObject<HTMLDivElement | null>
  /** The element holding the drawn lines; its size changes when any line's does. */
  bodyRef: RefObject<HTMLDivElement | null>
  start: number
  end: number
  padTop: number
  padBottom: number
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  focusIndex: number
  setFocusIndex: (index: number) => void
  /** Records a line that got focus some other way (click, script) without moving focus. */
  syncFocus: (index: number) => void
  /** Arrow keys, Home, End, Page Up and Page Down on the list or a line (FR-21.7). */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => boolean
}

/** The index of the last line whose top is at or above `y` (`tops` is ascending). */
function lineAt(tops: readonly number[], y: number): number {
  let low = 0
  let high = tops.length - 2
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((tops[mid] ?? 0) <= y) low = mid
    else high = mid - 1
  }
  return Math.max(0, low)
}

/**
 * Line windowing with measured heights, plus a roving focus. Every line
 * starts at `estimate` px; each drawn line is measured after render (and again
 * when the body resizes: a wrapped cell after a width change, an expanded
 * detail, a late font), so rows taller than the estimate never skip or overlap
 * while scrolling. Heights are kept per line key, so a sort keeps them. Keys
 * are handled only when the list itself or a line has focus, so buttons,
 * links and checkboxes inside a line keep their own keys.
 */
export function useRowWindow(options: {
  /** One stable key per line, in display order. */
  keys: readonly string[]
  /** Height of a line not measured yet. */
  estimate: number
  viewport: number
  /** Height above the first line inside the scroller, such as a sticky header. */
  offset?: number
  /** False draws every line (no window); focus and scrolling still work. */
  virtualize?: boolean
}): RowWindow {
  const { keys, estimate, viewport } = options
  const count = keys.length
  const offset = options.offset ?? 0
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [scrollTop, setScrollTop] = useState(0)
  const [focusIndex, setFocus] = useState(0)
  const moved = useRef(false)
  const virtual = options.virtualize !== false && count > VIRTUAL_THRESHOLD

  // Top of each line from the first line's top; tops[count] is the total height.
  const tops = useMemo(() => {
    const out = new Array<number>(count + 1)
    let y = 0
    for (let at = 0; at < count; at += 1) {
      out[at] = y
      y += heights.get(keys[at] ?? '') ?? estimate
    }
    out[count] = y
    return out
  }, [keys, count, estimate, heights])
  const total = tops[count] ?? 0

  const top = Math.max(0, scrollTop - offset)
  const first = count === 0 ? 0 : lineAt(tops, top)
  const last = count === 0 ? 0 : lineAt(tops, top + viewport)
  const start = virtual ? Math.max(0, first - OVERSCAN) : 0
  const end = virtual ? Math.min(count, last + 1 + OVERSCAN) : count
  const visible = Math.max(1, Math.ceil(viewport / estimate))
  const safeFocus = count === 0 ? 0 : Math.min(focusIndex, count - 1)

  /** Reads the drawn lines' heights; a change redraws with the new tops. */
  const measure = useCallback(() => {
    const body = bodyRef.current
    if (!body) return
    const found: [string, number][] = []
    for (const node of body.querySelectorAll<HTMLElement>(':scope > [data-line]')) {
      const key = node.dataset.lineKey
      const height = node.offsetHeight
      // Zero is a line not laid out (a test DOM, a hidden panel): keep the estimate.
      if (key !== undefined && height > 0) found.push([key, height])
    }
    setHeights((current) => {
      const changed = found.filter(
        ([key, height]) => Math.abs((current.get(key) ?? estimate) - height) >= 0.5
      )
      if (changed.length === 0) return current
      const next = new Map(current)
      for (const [key, height] of changed) next.set(key, height)
      return next
    })
  }, [estimate])

  // Every render may draw new lines or change one's content.
  useLayoutEffect(measure)

  useEffect(() => {
    const body = bodyRef.current
    if (!body || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(body)
    return () => observer.disconnect()
  }, [measure])

  useLayoutEffect(() => {
    if (!moved.current) return
    const node = scrollRef.current
    if (!node) return
    const lineTop = offset + (tops[safeFocus] ?? 0)
    const lineHeight = (tops[safeFocus + 1] ?? lineTop) - (tops[safeFocus] ?? 0)
    let next = node.scrollTop
    if (lineTop < node.scrollTop + offset) next = Math.max(0, lineTop - offset)
    else if (lineTop + lineHeight > node.scrollTop + node.clientHeight) {
      next = lineTop + lineHeight - node.clientHeight
    }
    if (next !== node.scrollTop) {
      node.scrollTop = next
      setScrollTop(next)
    }
  }, [safeFocus, tops, offset])

  useEffect(() => {
    if (!moved.current) return
    const line = scrollRef.current?.querySelector<HTMLElement>(`[data-line="${safeFocus}"]`)
    if (line) {
      line.focus()
      moved.current = false
    }
  }, [safeFocus, start, end])

  const focusRef = useRef(safeFocus)
  useLayoutEffect(() => {
    focusRef.current = safeFocus
  }, [safeFocus])
  const setFocusIndex = useCallback((index: number) => {
    moved.current = true
    if (index === focusRef.current) {
      const line = scrollRef.current?.querySelector<HTMLElement>(`[data-line="${index}"]`)
      if (line) {
        line.focus()
        moved.current = false
        return
      }
    }
    setFocus(index)
  }, [])

  const syncFocus = useCallback((index: number) => {
    setFocus(index)
  }, [])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): boolean => {
      const target = event.target as HTMLElement
      const onList = target === event.currentTarget
      const onLine = target.dataset.line !== undefined
      if ((!onList && !onLine) || count === 0) return false
      const page = Math.max(1, visible - 1)
      let next: number | null = null
      if (event.key === 'ArrowDown') next = onList ? safeFocus : Math.min(count - 1, safeFocus + 1)
      else if (event.key === 'ArrowUp') next = Math.max(0, safeFocus - 1)
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = count - 1
      else if (event.key === 'PageDown') next = Math.min(count - 1, safeFocus + page)
      else if (event.key === 'PageUp') next = Math.max(0, safeFocus - page)
      if (next === null) return false
      event.preventDefault()
      setFocusIndex(next)
      return true
    },
    [count, safeFocus, visible, setFocusIndex]
  )

  return {
    scrollRef,
    bodyRef,
    start,
    end,
    padTop: tops[start] ?? 0,
    padBottom: Math.max(0, total - (tops[end] ?? total)),
    onScroll,
    focusIndex: safeFocus,
    setFocusIndex,
    syncFocus,
    onKeyDown
  }
}
