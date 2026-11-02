import type { JSX } from 'react'
import type { PageReadDates } from '@shared/ipc'
import { formatDay, formatMoment } from '../utils/dates'

/**
 * "Published Mar 12, 2025 · Updated Oct 28, 2026 (was Jun 4, 2026) · Last read
 * Oct 29, 10:27 AM": the dates the page states about itself, from its latest read.
 */
export function PageDates({
  dates,
  previousModifiedAt = null
}: {
  dates: Pick<PageReadDates, 'publishedAt' | 'modifiedAt' | 'readAt'>
  previousModifiedAt?: string | null
}): JSX.Element {
  const was =
    previousModifiedAt && dates.modifiedAt && previousModifiedAt !== dates.modifiedAt
      ? ` (was ${formatDay(previousModifiedAt)})`
      : ''
  return (
    <dl className="pc-dates" aria-label="Dates from the page">
      <div>
        <dt>Published</dt>
        <dd>{dates.publishedAt ? formatDay(dates.publishedAt) : 'Not on the page'}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{dates.modifiedAt ? `${formatDay(dates.modifiedAt)}${was}` : 'Not on the page'}</dd>
      </div>
      <div>
        <dt>Last read</dt>
        <dd>{formatMoment(dates.readAt)}</dd>
      </div>
    </dl>
  )
}
