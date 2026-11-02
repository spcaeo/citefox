import { useMemo, type JSX, type ReactNode } from 'react'
import { overviewFromSample } from '@shared/aio-overview'
import type { BrandLens } from '@shared/brand-mentions'
import type { SampleCapture } from '@shared/domain'
import { formatDay } from '../../utils/dates'
import { SegmentedControl } from '../../ui'
import { sampleLabel } from '../utils/model'
import { GoogleOverview } from './aio/GoogleOverview'
import { Marked } from './aio/Marked'
import { MarkdownOverview } from './aio/MarkdownOverview'

/** A v2 panel whose heading has a fixed id, so the KPI tiles can move focus to it. */
export function Card({
  headingId,
  title,
  aside,
  children,
  className
}: {
  headingId: string
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section
      className={className ? `ui-panel pd2-card ${className}` : 'ui-panel pd2-card'}
      aria-labelledby={headingId}
    >
      <div className="ui-panel-head">
        <h2 id={headingId} className="ui-panel-title" tabIndex={-1}>
          {title}
        </h2>
        {aside ? <div className="ui-panel-actions">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * FR-13.2: the overview as Google showed it, from one stored sample. Laid out
 * from the stored SerpApi overview (Google's own blocks) first, then from
 * cloro's markdown; the flattened `aioText`, as plain text, only when neither
 * is stored. Either way the brand and the own site are marked in yellow.
 */
export function AioCard({
  sample,
  samples,
  sampleIndex,
  onSample,
  checkedAt,
  marketName,
  lens = null,
  extra = null
}: {
  /** Shown before "As Google showed it" (a topic question's target page). */
  extra?: ReactNode
  sample: SampleCapture | null
  samples: readonly SampleCapture[]
  sampleIndex: number
  onSample: (index: number) => void
  checkedAt: string | null
  marketName: string
  /** Brand names and the own site, marked in yellow. Null marks nothing. */
  lens?: BrandLens | null
}): JSX.Element {
  const overview = useMemo(() => (sample ? overviewFromSample(sample) : null), [sample])
  return (
    <Card
      headingId="pd-aio-h"
      title={`AI Overview · ${formatDay(checkedAt, { year: false })}`}
      aside={
        <span className="pd2-aio-aside">
          {extra}
          <span className="pd2-faint">As Google showed it, {marketName}</span>
        </span>
      }
    >
      {samples.length > 1 ? (
        <SegmentedControl
          label="Samples"
          size="sm"
          value={String(sampleIndex)}
          options={samples.map((item, index) => ({
            value: String(index),
            label: `Sample ${item.sampleNo}`
          }))}
          onChange={(value) => onSample(Number(value))}
        />
      ) : null}
      {sample === null ? (
        <p className="pd2-muted">No search is stored for this question in this check.</p>
      ) : sample.errorCode !== null ? (
        <p className="pd2-muted" role="note">
          {sample.message ?? 'This search failed.'} {sample.nextStep ?? ''}
        </p>
      ) : overview ? (
        <GoogleOverview
          key={sample.id}
          overview={overview}
          references={sample.references}
          lens={lens}
        />
      ) : sample.aioMarkdown?.trim() ? (
        <MarkdownOverview
          key={sample.id}
          markdown={sample.aioMarkdown}
          references={sample.references}
          lens={lens}
        />
      ) : sample.aioText ? (
        <p className="pd2-aio">
          <Marked text={sample.aioText} lens={lens} />
        </p>
      ) : (
        <p className="pd2-muted">Google showed no AI Overview for this question in this check.</p>
      )}
      {sample ? <p className="pd2-faint">{sampleLabel(sample, samples.length)}</p> : null}
    </Card>
  )
}
