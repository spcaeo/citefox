import type { JSX } from 'react'
import { MEASURE_DAYS } from '../ui'
import { allPromptsPhrase } from './trends'

/** Chart key for the citation-rate chart. Each swatch matches the mark the chart draws. */
export function ChartKey({ total }: { total: number }): JSX.Element {
  return (
    <ul className="vis-legend" aria-label="Chart key">
      <li>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <line
            x1="1"
            y1="5"
            x2="21"
            y2="5"
            stroke="var(--chart-cited)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        Full check · {allPromptsPhrase(total)}
      </li>
      <li>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle
            cx="7"
            cy="7"
            r="4.5"
            fill="var(--surface)"
            stroke="var(--chart-cited)"
            strokeWidth="2"
          />
        </svg>
        Partial check · left out of the line
      </li>
      <li>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <rect width="22" height="10" rx="3" fill="var(--chart-measure)" />
        </svg>
        Measuring a fix ({MEASURE_DAYS} days)
      </li>
      <li>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
          <defs>
            <pattern
              id="chart-key-rollout"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--chart-rollout)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--chart-rollout-line)"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          <rect width="22" height="10" rx="3" fill="url(#chart-key-rollout)" />
        </svg>
        Google update rolling out
      </li>
      <li>Under each date: questions checked of {total}</li>
    </ul>
  )
}

/** Key for the page-cited / not-page-cited bar beside the chart. */
export function SegmentKey(): JSX.Element {
  return (
    <ul className="vis-stack-key" aria-hidden="true">
      <li>
        <span className="vis-swatch vis-this" />
        Page cited
      </li>
      <li>
        <span className="vis-swatch vis-other" />
        Not page cited
      </li>
    </ul>
  )
}
