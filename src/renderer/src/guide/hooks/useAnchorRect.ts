import { useEffect, useState } from 'react'
import { ANCHOR_WAIT_MS } from '../constants'
import { needsScroll, type Box } from '../utils/position'

export interface AnchorState {
  /** The element's box in the window, or null while it is not found. */
  box: Box | null
  /** True once the wait is over and the element is not on the page. */
  missing: boolean
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The first element the selectors find, best first; a selector the browser rejects finds nothing. */
export function findFirst(selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector)
      if (element) return element
    } catch {
      // Not a valid selector here: try the next one.
    }
  }
  return null
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function same(a: Box | null, b: Box | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height)
  )
}

/**
 * Finds the element `selector` names (or the first of a list that is on the
 * page, best first) and follows its box as the page scrolls,
 * resizes or re-lays out. Screens load their data after they open, so it keeps
 * looking for `ANCHOR_WAIT_MS` before it calls the element missing. The first
 * time it is found off screen (or a small one at the window's edge), it is scrolled into view.
 */
export function useAnchorRect(selector: string | readonly string[] | null): AnchorState {
  // One key for the list, so a new array with the same selectors keeps the search.
  const key =
    selector === null ? null : typeof selector === 'string' ? selector : selector.join('\n')
  // Kept with the selector it was measured for, so a new step never shows the last box.
  const [state, setState] = useState<AnchorState & { key: string | null }>({
    key: null,
    box: null,
    missing: false
  })

  useEffect(() => {
    if (key === null) return
    const selectors = key.split('\n')
    const started = Date.now()
    let scrolled = false
    const measure = (): void => {
      const element = findFirst(selectors)
      const box = element ? boxOf(element) : null
      if (element && box && !scrolled) {
        scrolled = true
        if (needsScroll(box, viewport()) && typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'center', inline: 'nearest' })
          setState({ key, box: boxOf(element), missing: false })
          return
        }
      }
      const missing = box === null && Date.now() - started >= ANCHOR_WAIT_MS
      setState((current) =>
        current.key === key && same(current.box, box) && current.missing === missing
          ? current
          : { key, box, missing }
      )
    }
    measure()
    // A light poll catches data that loads late and layout that moves without a scroll.
    const timer = window.setInterval(measure, 250)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [key])

  return state.key === key
    ? { box: state.box, missing: state.missing }
    : { box: null, missing: false }
}
