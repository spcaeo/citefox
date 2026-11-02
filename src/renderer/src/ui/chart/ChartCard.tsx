import type { JSX, ReactNode } from 'react'
import { clampCard } from './scale'

const CARD_WIDTH = 260

/**
 * The floating card a chart shows on hover or focus: a check's values, or what a
 * marker stands for. `above` sits over `y`, centred on `x`; `beside` hangs from `y`
 * next to the hover line, on whichever side has room. Kept inside the chart. Not a
 * live region: the control that opened it carries the same words.
 */
export function ChartCard({
  x,
  y,
  width,
  side = 'above',
  pinned = false,
  id,
  children
}: {
  x: number
  y: number
  /** The chart's width, to keep the card inside it. */
  width: number
  side?: 'above' | 'beside'
  /** A clicked marker's card takes clicks (its Open buttons); a hover card does not. */
  pinned?: boolean
  id?: string
  children: ReactNode
}): JSX.Element {
  const cardWidth = Math.min(CARD_WIDTH, width)
  const left =
    side === 'above'
      ? clampCard(x, cardWidth, width)
      : x + 14 + cardWidth <= width
        ? x + 14
        : Math.max(0, x - 14 - cardWidth)
  const classes = [
    'ui-chart-card',
    side === 'beside' ? 'ui-chart-card-beside' : '',
    pinned ? 'ui-chart-card-pinned' : ''
  ]
  return (
    <div
      id={id}
      className={classes.filter(Boolean).join(' ')}
      style={{ left, top: y, width: cardWidth }}
      role={pinned ? 'dialog' : undefined}
      aria-label={pinned ? 'Markers on this day' : undefined}
      aria-hidden={pinned ? undefined : true}
    >
      {children}
    </div>
  )
}
