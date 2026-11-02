import { useLayoutEffect, useRef, type CSSProperties, type JSX, type ReactNode } from 'react'
import { useAiSlot } from './aiSlot'
import { GoalBar, type GoalBarProps } from './GoalBar'
import { UiIcon } from './UiIcon'

/** A change since an earlier check, such as "+3 since Sep 28". */
export interface KpiTrend {
  direction: 'up' | 'down' | 'flat'
  text: string
  /** Colour by meaning, not by direction. Default: up is good, down is bad. */
  tone?: 'ok' | 'bad' | 'neutral'
}

export interface KpiTileProps {
  /** Title, such as "Buyer questions cited". */
  label: string
  /**
   * The number (22/28 600, tabular). Pass a `DrillNumber` so the number opens
   * the rows behind it; it gets the dotted underline.
   */
  value: ReactNode
  /** Muted text after the number, such as "/ 28" or "cited questions". */
  suffix?: ReactNode
  /**
   * One line under the number, such as "11 of 26 · goal 50–70%". Cut to one
   * line. The line is always reserved, so every tile is the same 88px height
   * with or without it.
   */
  sub?: ReactNode
  trend?: KpiTrend
  /**
   * Wraps the trend chip, such as in a drill button that opens what moved. The
   * chip is passed drawn; return it inside the control.
   */
  renderTrend?: (chip: ReactNode) => ReactNode
  /** A small goal bar beside the number (always `sm`, no ticks). */
  goal?: Omit<GoalBarProps, 'size' | 'ticks' | 'label'>
  /** A chip at the right of the number row, such as "In band". */
  chip?: ReactNode
  /** A small sparkline or other figure at the right of the number row. */
  spark?: ReactNode
  className?: string
}

function trendTone(trend: KpiTrend): 'ok' | 'bad' | 'neutral' {
  if (trend.tone) return trend.tone
  if (trend.direction === 'up') return 'ok'
  if (trend.direction === 'down') return 'bad'
  return 'neutral'
}

function trendChip(trend: KpiTrend): JSX.Element {
  return (
    <span className={`ui-kpi-trend ui-kpi-trend-${trendTone(trend)} num`}>
      {trend.direction !== 'flat' ? (
        <UiIcon name={trend.direction === 'up' ? 'trend' : 'trend-down'} size={14} />
      ) : null}
      {trend.text}
    </span>
  )
}

/** The visible text of an element: screen-reader-only parts left out. */
function visibleText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.sr-only').forEach((node) => node.remove())
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * A KPI tile (Theme.dc.html "Data", Topic-Overview.png), compact: the label
 * with the trend at its right, the drillable number with its goal bar,
 * sparkline and chip beside it, and one sub line cut to one line (the whole
 * line shows on hover). Every tile is 88px tall (--h-kpi): the sub line is
 * reserved even when there is none. A row of tiles goes in a `KpiStrip`; on
 * its own a tile is a slim card.
 */
export function KpiTile({
  label,
  value,
  suffix,
  sub,
  trend,
  renderTrend,
  goal,
  chip,
  spark,
  className
}: KpiTileProps): JSX.Element {
  const subRef = useRef<HTMLParagraphElement>(null)
  const valueRef = useRef<HTMLParagraphElement>(null)
  // The shell's ✦ menu: questions about this number (assistant/AiSlotProvider).
  const KpiAsk = useAiSlot()?.Kpi
  // The sub line is cut to one line, so its title carries the whole line.
  useLayoutEffect(() => {
    const node = subRef.current
    if (!node) return
    const text = visibleText(node)
    if (text) node.title = text
    else node.removeAttribute('title')
  })
  return (
    <section className={className ? `ui-kpi ${className}` : 'ui-kpi'} aria-label={label}>
      <div className="ui-kpi-head">
        <p className="ui-kpi-label" title={label}>
          {label}
        </p>
        {trend ? (renderTrend ? renderTrend(trendChip(trend)) : trendChip(trend)) : null}
        {KpiAsk ? (
          <KpiAsk
            label={label}
            valueRef={valueRef}
            trend={trend?.text ?? null}
            goal={goal !== undefined}
          />
        ) : null}
      </div>
      <div className="ui-kpi-row">
        <p ref={valueRef} className="ui-kpi-value num">
          {value}
          {suffix ? <span className="ui-kpi-suffix">{suffix}</span> : null}
        </p>
        {goal ? (
          <div className="ui-kpi-goal">
            <GoalBar {...goal} size="sm" ticks={false} />
          </div>
        ) : null}
        {spark || chip ? (
          <div className="ui-kpi-side">
            {spark ? <span className="ui-kpi-spark">{spark}</span> : null}
            {chip}
          </div>
        ) : null}
      </div>
      {sub ? (
        <p ref={subRef} className="ui-kpi-sub num">
          {sub}
        </p>
      ) : (
        <p ref={subRef} className="ui-kpi-sub ui-kpi-sub-empty" aria-hidden="true" />
      )}
    </section>
  )
}

/**
 * A row of KPI tiles as one bordered strip split by thin dividers. It holds
 * at most four tiles: they share the width equally on one row (one column
 * per tile; screen-reader-only extras take no column) and wrap two by two on
 * a narrow window. More than four still fit as one row on a wide window, but
 * a screen should pick its four headline numbers. `label` names the strip as
 * a region, such as "Headline numbers".
 */
export function KpiStrip({
  label,
  className,
  columns,
  children
}: {
  label?: string
  className?: string
  /** Columns on a wide window, such as 2 for a 2 × 2 block. Default: one per tile. */
  columns?: number
  children: ReactNode
}): JSX.Element {
  const name = className ? `ui-kpis ${className}` : 'ui-kpis'
  const fixed =
    columns === undefined
      ? {}
      : { style: { '--kpi-cols': Math.max(1, columns) } as CSSProperties, 'data-cols': '' }
  return label ? (
    <section className={name} aria-label={label} {...fixed}>
      {children}
    </section>
  ) : (
    <div className={name} {...fixed}>
      {children}
    </div>
  )
}
