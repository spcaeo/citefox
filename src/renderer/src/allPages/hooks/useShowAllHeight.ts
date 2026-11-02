import { useEffect, useState } from 'react'

/** The grid's toolbar, column header, footer and the gaps around them. */
export const GRID_CHROME = 56 + 40 + 56 + 32
/** Never smaller than about seven rows. */
const MIN_BODY = 320
const FALLBACK = 640

/**
 * With Show all, the grid body is as tall as the screen's scroll area minus
 * the grid's own toolbar and footer, so a grid scrolled to the top fills the
 * window and its one scrollbar is the only one in view (deep audit §7h).
 */
export function useShowAllHeight(): number {
  const [height, setHeight] = useState(() => measure())
  useEffect(() => {
    const update = (): void => setHeight(measure())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return height
}

function measure(): number {
  if (typeof document === 'undefined') return FALLBACK
  const main = document.getElementById('main')
  const viewport = main?.clientHeight || window.innerHeight || 0
  if (viewport <= 0) return FALLBACK
  return Math.max(MIN_BODY, viewport - GRID_CHROME)
}
