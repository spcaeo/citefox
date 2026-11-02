/** Sideways scrolling for a one-row tab strip (page tabs). */

/** Room left beside a revealed tab, so the edge fade does not cover it. */
const REVEAL_MARGIN = 24

/**
 * Scrolls the tab strip sideways, and only the strip (never the page), so
 * `tab` is fully in view with a little room past it.
 */
export function revealTab(strip: HTMLElement, tab: HTMLElement): void {
  const start = tab.offsetLeft
  const end = start + tab.offsetWidth
  const viewStart = strip.scrollLeft
  const viewEnd = viewStart + strip.clientWidth
  if (start < viewStart) strip.scrollLeft = Math.max(0, start - REVEAL_MARGIN)
  else if (end > viewEnd) strip.scrollLeft = end - strip.clientWidth + REVEAL_MARGIN
}

/** Marks which edges of the strip hide tabs, for the fade that shows there is more. */
export function markOverflow(strip: HTMLElement): void {
  const more = strip.scrollWidth - strip.clientWidth
  strip.dataset.moreStart = String(more > 1 && strip.scrollLeft > 1)
  strip.dataset.moreEnd = String(more > 1 && strip.scrollLeft < more - 1)
}
