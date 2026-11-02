import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { ChartCard } from './ChartCard'
import { MarkerDot } from './MarkerDot'
import {
  MARKER_WHO,
  eventDay,
  finishedText,
  soleOpenable,
  type ChartEvent,
  type MarkerStack
} from './markers'

export interface PlacedStack {
  stack: MarkerStack
  x: number
}

/**
 * The row of markers along a trend chart's baseline. Hover or focus shows what a
 * marker stands for; a click on a single fix opens that fix and on a single page
 * change opens what changed (`onOpen`); a click
 * on a day with several events pins its card with an Open button per fix and a
 * "See what changed" per page change (`onOpen` opens its diff drawer).
 */
export function ChartMarkers({
  placed,
  y,
  width,
  onOpen
}: {
  placed: readonly PlacedStack[]
  /** The baseline the circles sit on. */
  y: number
  width: number
  onOpen?: (event: ChartEvent) => void
}): JSX.Element {
  const [hover, setHover] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const card = useRef<HTMLDivElement>(null)

  // A pinned card takes focus, and closes on a click outside it.
  useEffect(() => {
    if (pinned === null) return undefined
    card.current?.querySelector<HTMLElement>('button, a')?.focus()
    const close = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target && card.current?.contains(target)) return
      if (target && buttons.current.get(pinned)?.contains(target)) return
      setPinned(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [pinned])

  const unpin = (): void => {
    const key = pinned
    setPinned(null)
    if (key) buttons.current.get(key)?.focus()
  }

  const activate = (stack: MarkerStack): void => {
    const fix = soleOpenable(stack)
    if (fix && onOpen) {
      setHover(null)
      onOpen(fix)
      return
    }
    setPinned((current) => (current === stack.key ? null : stack.key))
  }

  const shown = pinned ?? hover
  const active = placed.find((item) => item.stack.key === shown) ?? null

  return (
    <>
      {placed.map(({ stack, x }) => (
        <button
          key={stack.key}
          ref={(node) => {
            if (node) buttons.current.set(stack.key, node)
            else buttons.current.delete(stack.key)
          }}
          type="button"
          className="ui-chart-marker"
          style={{ left: x, top: y }}
          aria-label={stack.name}
          aria-expanded={soleOpenable(stack) && onOpen ? undefined : pinned === stack.key}
          data-marker-kind={stack.kind}
          onMouseEnter={() => setHover(stack.key)}
          onMouseLeave={() => setHover((key) => (key === stack.key ? null : key))}
          onFocus={() => setHover(stack.key)}
          onBlur={() => setHover((key) => (key === stack.key ? null : key))}
          onClick={() => activate(stack)}
        >
          <MarkerDot kind={stack.kind} label={stack.label} />
        </button>
      ))}
      {active ? (
        <div
          ref={card}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              unpin()
            }
          }}
        >
          <ChartCard x={active.x} y={y - 18} width={width} pinned={pinned === active.stack.key}>
            {active.stack.events.map((event, index) => (
              <MarkerCardItem
                key={event.id}
                event={event}
                divided={index > 0}
                pinned={pinned === active.stack.key}
                onOpen={onOpen}
              />
            ))}
          </ChartCard>
        </div>
      ) : null}
    </>
  )
}

function MarkerCardItem({
  event,
  divided,
  pinned,
  onOpen
}: {
  event: ChartEvent
  divided: boolean
  pinned: boolean
  onOpen?: (event: ChartEvent) => void
}): JSX.Element {
  return (
    <div className={divided ? 'ui-chart-card-item ui-chart-card-divided' : 'ui-chart-card-item'}>
      <p className="ui-chart-card-date">
        {eventDay(event)} · {MARKER_WHO[event.kind]}
        {event.planned ? ' · planned' : ''}
      </p>
      <p className="ui-chart-card-title">{event.title}</p>
      {event.line ? <p className="ui-chart-card-line">{event.line}</p> : null}
      {event.span ? <p className="ui-chart-card-line">{finishedText(event.span)}</p> : null}
      {event.beforeNow ? (
        <p className="ui-chart-card-row">
          <span>Before → now</span>
          <strong className="num">{event.beforeNow}</strong>
        </p>
      ) : null}
      {event.verdict ? (
        <span className={`ui-chart-verdict ui-chart-verdict-${event.verdictTone ?? 'wait'}`}>
          {event.verdict}
        </span>
      ) : null}
      {pinned && event.kind === 'fix' && onOpen ? (
        <button type="button" className="ui-chart-card-action" onClick={() => onOpen(event)}>
          Open fix{event.number === undefined ? '' : ` ${event.number}`}
        </button>
      ) : null}
      {pinned && event.kind === 'page' && onOpen ? (
        <button type="button" className="ui-chart-card-action" onClick={() => onOpen(event)}>
          See what changed
        </button>
      ) : null}
      {pinned && event.url ? (
        <a
          className="ui-chart-card-action"
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn more on Google
        </a>
      ) : null}
    </div>
  )
}
