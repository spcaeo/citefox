import {
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type SyntheticEvent
} from 'react'
import type { ChartMarkup } from '@shared/charts'

interface Readout {
  x: number
  y: number
  lines: string[]
}

const MOVE_KEYS: Record<string, -1 | 1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1
}

/**
 * Draws one report chart from its shared SVG markup (src/shared/charts) and makes
 * it live: a hover or focus card from each mark's `data-tip`, Enter/Space or a
 * click on a mark calls `onDrill` with its `data-drill` id, and the arrow keys
 * (Home/End too) move focus between the chart's marks (one mark is in the Tab
 * order at a time, the rest are reached with the arrows). The markup is escaped by
 * the builders, so it goes in as HTML.
 */
export function ChartFrame({
  markup,
  onDrill,
  frameRef,
  className
}: {
  markup: ChartMarkup
  onDrill?: (id: string) => void
  /** The outer box, to measure the width the chart may use. */
  frameRef?: (node: HTMLDivElement | null) => void
  className?: string
}): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null)
  const [readout, setReadout] = useState<Readout | null>(null)
  /** Which mark is the one Tab reaches; it survives a redraw of the chart. */
  const tabStop = useRef(0)

  // Roving tabindex: the markup gives every drill mark tabindex 0 (a static export has no
  // script), so here only the current one keeps it.
  useLayoutEffect(() => {
    const marks = [...(box.current?.querySelectorAll<SVGGElement>('[data-drill]') ?? [])]
    if (tabStop.current >= marks.length) tabStop.current = 0
    marks.forEach((node, at) => node.setAttribute('tabindex', at === tabStop.current ? '0' : '-1'))
  }, [markup.svg])

  function setBox(node: HTMLDivElement | null): void {
    box.current = node
    frameRef?.(node)
  }

  function show(target: EventTarget | null): void {
    const frame = box.current
    const node = target instanceof Element ? target.closest('[data-tip]') : null
    if (!frame || !node || !frame.contains(node)) {
      setReadout(null)
      return
    }
    const outer = frame.getBoundingClientRect()
    const inner = node.getBoundingClientRect()
    const lines = (node.getAttribute('data-tip') ?? '').split('\n').filter(Boolean)
    if (lines.length === 0) {
      setReadout(null)
      return
    }
    setReadout({
      x: inner.left - outer.left + inner.width / 2,
      y: inner.top - outer.top - 6,
      lines
    })
  }

  function drillOf(target: EventTarget | null): string | null {
    const node = target instanceof Element ? target.closest('[data-drill]') : null
    if (!node || !box.current?.contains(node)) return null
    return node.getAttribute('data-drill')
  }

  function onClick(event: SyntheticEvent): void {
    const id = drillOf(event.target)
    if (id && onDrill) onDrill(id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const id = drillOf(event.target)
    if (!id) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onDrill?.(id)
      return
    }
    const marks = [...(box.current?.querySelectorAll<SVGGElement>('[data-drill]') ?? [])]
    const index = marks.findIndex(
      (node) => node === (event.target as Element).closest('[data-drill]')
    )
    let next: number | null = null
    const step = MOVE_KEYS[event.key]
    if (step !== undefined) next = (index + step + marks.length) % marks.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = marks.length - 1
    if (next === null) return
    event.preventDefault()
    marks[next]?.focus()
  }

  const [title, ...rest] = readout?.lines ?? []
  const side = !readout
    ? 'middle'
    : readout.x < 120
      ? 'start'
      : readout.x > markup.width - 120
        ? 'end'
        : 'middle'
  return (
    <div
      ref={setBox}
      className={`ui-rchart${className ? ` ${className}` : ''}`}
      onPointerOver={(event) => show(event.target)}
      onPointerLeave={() => setReadout(null)}
      onFocus={(event) => {
        show(event.target)
        const marks = [...(box.current?.querySelectorAll<SVGGElement>('[data-drill]') ?? [])]
        const at = marks.findIndex(
          (node) => node === (event.target as Element).closest('[data-drill]')
        )
        if (at < 0) return
        tabStop.current = at
        marks.forEach((node, index) => node.setAttribute('tabindex', index === at ? '0' : '-1'))
      }}
      onBlur={() => setReadout(null)}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="ui-rchart-plot" dangerouslySetInnerHTML={{ __html: markup.svg }} />
      {readout ? (
        <div
          className={`ui-chart-card ui-rchart-card ui-rchart-card-${side}`}
          style={{ left: readout.x, top: readout.y }}
          aria-hidden="true"
        >
          <p className="ui-chart-card-title">{title}</p>
          {rest.map((line, index) => (
            <p key={index} className="ui-chart-card-line">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
