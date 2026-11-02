import { useId, type JSX, type ReactNode } from 'react'
import type { VisibilityOverview } from '@shared/ipc'
import { compareOptions, compareValue } from '../compare'
import { IconButton } from '../../ui'
import { IMPACT_REVIEW_HASH } from '../impactLink'

/**
 * Summary's one quiet line on top: the verdict moved to Reports → Impact review, which
 * also splits a rise into the market and your own work. The line keeps "Compare with"
 * and "How we measure" (every change on the screen reads against that comparison), and
 * the results bar under it (the children).
 */
export function ImpactLine({
  data,
  onCompare,
  onMethod,
  children
}: {
  data: VisibilityOverview
  /** A run id or day; empty for each source's previous check. */
  onCompare: (vs: string | null) => void
  onMethod: () => void
  children?: ReactNode
}): JSX.Element {
  const compareId = useId()
  const options = compareOptions(data.compare)
  return (
    <section className="ov-verdict ov-impact" aria-label="Is it working?">
      <div className="ov-verdict-head">
        <p className="ov-impact-line">
          <span aria-hidden="true">✓ </span>
          <b>Is it working?</b>{' '}
          <a
            className="ov-link"
            href={IMPACT_REVIEW_HASH}
            data-testid="ov-impact-link"
            title="The verdict, market vs your work and what to do next"
          >
            See the Impact review →
          </a>
        </p>
        <div className="ov-verdict-tools">
          <label className="ui-head-field" htmlFor={compareId}>
            <span className="ui-head-field-label">Compare with</span>
            <select
              id={compareId}
              className="select"
              value={compareValue(data.compare)}
              disabled={options.length < 2 && data.compare.vs === null}
              onChange={(event) => onCompare(event.target.value || null)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <IconButton icon="book-open" size="sm" tip label="How we measure" onClick={onMethod} />
        </div>
      </div>
      {data.compare.unknown ? (
        <p className="ov-note" role="status">
          That check is not in this project, so each question is compared with its previous check.
        </p>
      ) : null}
      {children}
    </section>
  )
}
