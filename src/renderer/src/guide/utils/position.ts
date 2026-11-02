/** Where a coachmark's popover sits beside the element it points at. */

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export type Side = 'bottom' | 'top' | 'right' | 'left' | 'center'

export interface Placement {
  top: number
  left: number
  side: Side
}

/** Space kept between the popover and the window's edge. */
export const EDGE = 16
/** Space between the element and the popover. */
export const GAP = 12
/** The spotlight's padding around the element. */
export const PAD = 6

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/**
 * Below the element when it fits, else above, else to the right, else to the left;
 * kept inside the window. No element (or one larger than the window on every side)
 * puts the popover in the middle.
 */
export function placePopover(
  anchor: Box | null,
  popover: { width: number; height: number },
  viewport: { width: number; height: number }
): Placement {
  const center: Placement = {
    top: Math.max(EDGE, (viewport.height - popover.height) / 2),
    left: Math.max(EDGE, (viewport.width - popover.width) / 2),
    side: 'center'
  }
  if (!anchor) return center
  const maxLeft = viewport.width - popover.width - EDGE
  const maxTop = viewport.height - popover.height - EDGE
  const alignedLeft = clamp(anchor.left, EDGE, maxLeft)
  const alignedTop = clamp(anchor.top, EDGE, maxTop)
  const below = anchor.top + anchor.height + PAD + GAP
  if (below + popover.height <= viewport.height - EDGE) {
    return { top: below, left: alignedLeft, side: 'bottom' }
  }
  const above = anchor.top - PAD - GAP - popover.height
  if (above >= EDGE) return { top: above, left: alignedLeft, side: 'top' }
  const right = anchor.left + anchor.width + PAD + GAP
  if (right + popover.width <= viewport.width - EDGE) {
    return { top: alignedTop, left: right, side: 'right' }
  }
  const left = anchor.left - PAD - GAP - popover.width
  if (left >= EDGE) return { top: alignedTop, left, side: 'left' }
  // A tall element (a whole list): sit inside its bottom edge, still in the window.
  if (anchor.height > viewport.height / 2) {
    return { top: maxTop, left: clamp(anchor.left + EDGE, EDGE, maxLeft), side: 'bottom' }
  }
  return center
}

/**
 * True when the element should be scrolled to: off screen, or a small one (a
 * button, a row) cut by the window's edge or tucked at its very bottom, where the
 * popover has no room.
 */
export function needsScroll(box: Box, viewport: { width: number; height: number }): boolean {
  if (!isOnScreen(box, viewport)) return true
  if (box.height > viewport.height / 2) return false
  return box.top < EDGE || box.top + box.height > viewport.height - EDGE * 6
}

/** True when part of `box` is inside the window. */
export function isOnScreen(box: Box, viewport: { width: number; height: number }): boolean {
  return (
    box.top + box.height > 0 &&
    box.left + box.width > 0 &&
    box.top < viewport.height &&
    box.left < viewport.width
  )
}

export type HintSide = Exclude<Side, 'center'>

export interface HintPlacement {
  top: number
  left: number
  side: HintSide
  /** Where the arrow sits along the bubble's edge that faces the element, in px. */
  arrow: number
}

/** Below and above first, then right and left: the order a hint falls back in. */
const HINT_SIDES: readonly HintSide[] = ['bottom', 'top', 'right', 'left']

/**
 * A hint bubble beside `anchor`: on `prefer` when it fits, else the first side
 * that does, kept inside the window. The arrow points at the element's middle,
 * or near the top of a tall one (a list).
 */
export function placeHint(
  anchor: Box,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: HintSide = 'bottom'
): HintPlacement {
  const maxLeft = viewport.width - bubble.width - EDGE
  const maxTop = viewport.height - bubble.height - EDGE
  // A wide or tall element is pointed at near its start, a small one at its middle.
  const pointX =
    anchor.width > bubble.width * 1.5 ? anchor.left + 40 : anchor.left + anchor.width / 2
  const pointY = anchor.height > 120 ? anchor.top + 28 : anchor.top + anchor.height / 2
  const across = clamp(pointX - bubble.width / 2, EDGE, maxLeft)
  const down = clamp(pointY - bubble.height / 2, EDGE, maxTop)
  const spots: Record<HintSide, { top: number; left: number; fits: boolean }> = {
    bottom: {
      top: anchor.top + anchor.height + GAP,
      left: across,
      fits: anchor.top + anchor.height + GAP + bubble.height <= viewport.height - EDGE
    },
    top: {
      top: anchor.top - GAP - bubble.height,
      left: across,
      fits: anchor.top - GAP - bubble.height >= EDGE
    },
    right: {
      top: down,
      left: anchor.left + anchor.width + GAP,
      fits: anchor.left + anchor.width + GAP + bubble.width <= viewport.width - EDGE
    },
    left: {
      top: down,
      left: anchor.left - GAP - bubble.width,
      fits: anchor.left - GAP - bubble.width >= EDGE
    }
  }
  const side = [prefer, ...HINT_SIDES].find((item) => spots[item].fits) ?? prefer
  const spot = spots[side]
  const top = clamp(spot.top, EDGE, maxTop)
  const left = clamp(spot.left, EDGE, maxLeft)
  const arrow =
    side === 'bottom' || side === 'top'
      ? clamp(pointX - left, 14, bubble.width - 14)
      : clamp(pointY - top, 14, bubble.height - 14)
  return { top, left, side, arrow }
}
