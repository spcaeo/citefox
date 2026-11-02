import type { JSX } from 'react'
import {
  bucketLegend,
  RESULT_BUCKETS,
  resultBarText,
  resultBucket,
  totalResults,
  type ResultBucket,
  type ResultBucketInfo,
  type ResultCounts
} from './resultTones'
import { useResultWords } from './resultWords'

export interface ResultBarProps {
  counts: ResultCounts
  /**
   * `row`: the 120 × 8 px bar in a grid cell. `header`: a full-width 10 px
   * bar with a legend under it ("96 not cited · 38 your other page …").
   */
  size?: 'row' | 'header'
  /** What the bar counts, for its name: "Problem searches". Default "searches". */
  label?: string
  /**
   * Header only: each legend count opens the searches it counts (every
   * number drills). A link when it returns a hash, else plain text.
   */
  hrefFor?: (bucket: ResultBucket) => string | null
  className?: string
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

function segments(counts: ResultCounts): { bucket: ResultBucketInfo; share: number }[] {
  const total = totalResults(counts)
  if (total === 0) return []
  return RESULT_BUCKETS.flatMap((bucket) => {
    const value = counts[bucket.key]
    return value > 0 ? [{ bucket, share: (value / total) * 100 }] : []
  })
}

/**
 * The four results as one stacked bar, in the shared colours and order
 * (ui/resultTones.ts): not cited orange, your other page blue, target page
 * green, no AI Overview grey. Screen readers hear the counts. On an answer engine
 * the grey one reads "no answer" (ResultWordsProvider).
 */
export function ResultBar({
  counts,
  size = 'row',
  label = 'searches',
  hrefFor,
  className
}: ResultBarProps): JSX.Element {
  const words = useResultWords()
  const parts = segments(counts)
  const text = resultBarText(counts, words)
  const name = `${label}: ${text}`
  const bar = (
    <span
      className={size === 'header' ? 'ui-rbar ui-rbar-header' : 'ui-rbar'}
      role="img"
      aria-label={name}
      title={size === 'row' ? text : undefined}
    >
      {parts.map(({ bucket, share }) => (
        <span
          key={bucket.key}
          className="ui-rbar-part"
          data-result={bucket.key}
          style={{ width: `${share}%`, background: bucket.colour }}
        />
      ))}
    </span>
  )
  if (size === 'row') {
    return (
      <span className={['ui-rbar-wrap', className ?? ''].filter(Boolean).join(' ')}>{bar}</span>
    )
  }
  return (
    <div className={['ui-rbar-block', className ?? ''].filter(Boolean).join(' ')}>
      {bar}
      <ul className="ui-rbar-legend" aria-label={`${label} by result`}>
        {RESULT_BUCKETS.map((bucket) => {
          const value = counts[bucket.key]
          const href = value > 0 ? (hrefFor?.(bucket.key) ?? null) : null
          const text = (
            <>
              <span className="ui-rdot" style={{ background: bucket.colour }} aria-hidden="true" />
              <span>
                <span className="num">{count(value)}</span> {bucketLegend(bucket.key, words)}
              </span>
            </>
          )
          return (
            <li key={bucket.key} data-result={bucket.key}>
              {href ? (
                <a className="ui-rbar-link" href={href}>
                  {text}
                </a>
              ) : (
                text
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The small square in a result's colour, before a group row's label or in a filter chip. */
export function ResultDot({ result }: { result: ResultBucket }): JSX.Element {
  return (
    <span
      className="ui-rdot"
      style={{ background: resultBucket(result).colour }}
      aria-hidden="true"
    />
  )
}
