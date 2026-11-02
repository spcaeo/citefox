import type { JSX, ReactNode } from 'react'
import type { MetricResult } from '@shared/metrics'
import type { Num, Part } from '@shared/report/review'
import { openReportDrill } from './drill'

/**
 * A number that opens exactly what it counts (NFR-14): a button with the number, or
 * plain text for zero (nothing to open). `data-rd` is the drill id tests look for.
 */
export function Fig({
  num,
  label,
  children,
  className
}: {
  num: Num
  /** What the drawer is about, for the accessible name: "3 questions: Started citing you". */
  label?: string
  children?: ReactNode
  className?: string
}): JSX.Element {
  const text = children ?? num.n.toLocaleString('en-US')
  if (num.n === 0) {
    return <span className={`drill-num-zero ${className ?? ''}`.trim()}>{text}</span>
  }
  return (
    <button
      type="button"
      className={`drill-num rv-fig ${className ?? ''}`.trim()}
      data-rd={num.drill}
      aria-label={label ? `${num.n}: ${label}` : undefined}
      onClick={() => openReportDrill(num.drill)}
    >
      {text}
    </button>
  )
}

/** A sentence with clickable numbers. */
export function Parts({ parts }: { parts: readonly Part[] }): JSX.Element {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === 'string' ? <span key={index}>{part}</span> : <Fig key={index} num={part} />
      )}
    </>
  )
}

const RESULT_WORDS: Readonly<Record<MetricResult, string>> = {
  target: 'Right page cited',
  other: 'Your other page',
  not_cited: 'Not cited',
  no_answer: 'No AI answer',
  failed: 'Search failed'
}

/** A result with its colour dot; "Not checked" when there is none. */
export function ResultTag({ result }: { result: MetricResult | null }): JSX.Element {
  if (result === null) return <span className="rv-res rv-res-missing">Not checked</span>
  return (
    <span className={`rv-res rv-res-${result}`}>
      <i aria-hidden="true" />
      {RESULT_WORDS[result]}
    </span>
  )
}

/** "▲ +3", "▼ −2" or "0" in the change colours. */
export function Change({ value }: { value: number | null }): JSX.Element {
  if (value === null) return <span className="rv-muted">—</span>
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const text = value > 0 ? `▲ +${value}` : value < 0 ? `▼ −${Math.abs(value)}` : '0'
  return <span className={`rv-change rv-change-${tone} num`}>{text}</span>
}
