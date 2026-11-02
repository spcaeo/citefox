import { Fragment, useMemo, useState, type JSX } from 'react'
import type { OpportunityBucket, OpportunityBucketId, PageResults } from '@shared/domain'
import { DrillButton, DrillFigure, DrillLink, DrillNumber, type PromptDrill } from '../../drill'
import { ListGrid, SectionHead, type ListColumn } from '../../ui'
import { Dotted, ViewToggle } from '../bits'
import { bucketLabel, bucketSentence, promptNumberLabel, rowsFor } from '../model'
import type { ResultsDrills } from './drills'
import { pluralize } from '@shared/pluralize'

const BUCKET_CLASS: Record<OpportunityBucketId, string> = {
  winning: 'm3-b-win',
  cited_only: 'm3-b-wrong',
  named_not_linked: 'm3-b-named',
  invisible: 'm3-b-invisible'
}

function bucketCopy(id: OpportunityBucketId, domain: string, brand: string): string {
  if (id === 'winning') return `A ${domain} page is linked and ${brand} is named in the text.`
  if (id === 'cited_only') return `A ${domain} page is linked, but the text does not name ${brand}.`
  if (id === 'named_not_linked') return `${brand} is in the answer text, with no link.`
  return `No ${brand} link or mention in the overview.`
}

/** The overlay prompts that fall in one bucket. */
function overlayPart(
  results: PageResults,
  bucketId: OpportunityBucketId,
  drills: ResultsDrills
): PromptDrill | null {
  const bucket = results.buckets.find((item) => item.id === bucketId)
  if (!bucket) return null
  const overlay = new Set(results.ugcOverlay.promptIds)
  const ids = bucket.promptIds.filter((id) => overlay.has(id))
  if (ids.length === 0) return null
  return {
    kind: 'prompts',
    id: `ugc:${bucketId}`,
    title: `Reddit or YouTube above you · ${bucketLabel(bucketId)}`,
    description: `Overviews in the ${bucketLabel(bucketId)} bucket where a reddit.com or youtube.com source sits above any ${drills.scope.domain} link.`,
    rows: rowsFor(results, ids),
    scope: drills.scope
  }
}

/** "Opportunities": the bar, the four buckets and the Reddit/YouTube overlay all drill. */
export function OpportunitiesCard({
  results,
  drills,
  aio
}: {
  results: PageResults
  drills: ResultsDrills
  aio: number
}): JSX.Element {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const { domain, brand } = drills.scope
  const ugc = drills.get('ugc')
  const overlayRows = rowsFor(results, results.ugcOverlay.promptIds).sort(
    (a, b) => a.promptPosition - b.promptPosition
  )
  const parts = results.buckets
    .map((bucket) => overlayPart(results, bucket.id, drills))
    .filter((part): part is PromptDrill => part !== null)

  return (
    <section
      className="card stack-tight"
      id="m3-opportunities"
      aria-labelledby="m3-opp-h"
      data-nfr-chart="opportunities"
    >
      <span className="sr-only" data-nfr-total="">
        {aio}
      </span>
      <SectionHead
        id="m3-opp-h"
        title="Opportunities"
        description="Four buckets. Every AI Overview is in exactly one. No AI Overview and errors are outside."
        actions={<ViewToggle view={view} onView={setView} />}
      />
      {view === 'chart' ? (
        <>
          <div
            className="m3-stack"
            role="group"
            aria-label={`Opportunities bar: ${results.buckets
              .map((bucket) => `${bucket.count} ${bucketLabel(bucket.id)}`)
              .join(', ')}`}
          >
            {results.buckets.map((bucket) => {
              const drill = drills.get(`bucket:${bucket.id}`)
              if (!drill || drill.rows.length === 0) return null
              return (
                <DrillNumber
                  key={bucket.id}
                  drill={drill}
                  className={`m3-seg-btn ${BUCKET_CLASS[bucket.id]}`}
                  style={{ flex: `${drill.rows.length} 1 0` }}
                  label={`${pluralize(drill.rows.length, 'question')}: ${bucketLabel(bucket.id)}`}
                />
              )
            })}
          </div>
          <div className="m3-buckets">
            {results.buckets.map((bucket) => {
              const drill = drills.get(`bucket:${bucket.id}`)
              if (!drill) return null
              return (
                <DrillButton key={bucket.id} drill={drill} className="m3-bucket">
                  <span className="ps-row">
                    <span className={`m3-swatch ${BUCKET_CLASS[bucket.id]}`} />
                    <span style={{ fontWeight: 600 }}>{bucketLabel(bucket.id)}</span>
                  </span>
                  <span>
                    <DrillFigure drill={drill} className="m3-bucket-n" />{' '}
                    <span className="faint">
                      {drill.rows.length === 1 ? 'question' : 'questions'}
                    </span>
                  </span>
                  <span className="muted">{bucketCopy(bucket.id, domain, brand)}</span>
                  <span className="mono faint">{promptNumberLabel(drill.rows)}</span>
                </DrillButton>
              )
            })}
          </div>
        </>
      ) : (
        <BucketTable results={results} drills={drills} />
      )}
      <p className="m3-sum">
        <Dotted text={bucketSentence(results)} />
      </p>
      <div className="m3-overlay">
        <span className="label">
          <Dotted text="Overlay · overlaps the buckets above" />
        </span>
        {ugc ? (
          <DrillButton drill={ugc} className="m3-link">
            <span className="sr-only" data-nfr-figure="ugc">
              {ugc.rows.length}
            </span>
            Reddit or YouTube is cited above you in {ugc.rows.length} of these {aio}
          </DrillButton>
        ) : null}
        <span className="muted">
          {parts.length === 0 || results.ugcOverlay.count === 0 ? (
            'None of these AI Overviews put a Reddit or YouTube source above you.'
          ) : (
            <>
              Of those {results.ugcOverlay.count}:{' '}
              {parts.map((part, index) => (
                <Fragment key={part.id}>
                  {index > 0 ? ' · ' : null}
                  <DrillNumber drill={part} />{' '}
                  {bucketLabel(part.id.slice('ugc:'.length) as OpportunityBucketId)}
                </Fragment>
              ))}
              . {overlayRows.length === 1 ? 'Question' : 'Questions'}{' '}
              {overlayRows.map((row, index) => {
                const target = drills.prompt(row)
                return (
                  <Fragment key={row.promptId}>
                    {index > 0 ? ', ' : null}
                    {target ? (
                      <DrillLink
                        target={target}
                        label={`Open question ${row.promptPosition}: ${row.label.split('**').join('')}`}
                      >
                        {row.promptPosition}
                      </DrillLink>
                    ) : (
                      row.promptPosition
                    )}
                  </Fragment>
                )
              })}
              .
            </>
          )}
        </span>
        <span className="faint">
          &quot;Above you&quot; means a reddit.com or youtube.com source sits higher than any{' '}
          {domain} link, or the overview has no {domain} link at all.
        </span>
      </div>
    </section>
  )
}

/** The buckets as a list grid. The counts add up to the AI Overviews. */
function BucketTable({
  results,
  drills
}: {
  results: PageResults
  drills: ResultsDrills
}): JSX.Element {
  const columns = useMemo<ListColumn<OpportunityBucket>[]>(
    () => [
      {
        id: 'bucket',
        label: 'Bucket',
        width: 'fill',
        render: (bucket) => bucketLabel(bucket.id)
      },
      {
        id: 'prompts',
        label: 'Questions',
        width: 96,
        numeric: true,
        render: (bucket) => {
          const drill = drills.get(`bucket:${bucket.id}`)
          return (
            <span data-nfr-segment="">{drill ? <DrillNumber drill={drill} /> : bucket.count}</span>
          )
        }
      }
    ],
    [drills]
  )
  return (
    <ListGrid
      label="Opportunity buckets. The counts add up to the AI Overviews."
      noun={['bucket', 'buckets']}
      rows={results.buckets}
      rowKey={(bucket) => bucket.id}
      rowLabel={(bucket) => bucketLabel(bucket.id)}
      columns={columns}
      className="m3-inner-grid"
      empty={<p className="muted">No buckets for this check.</p>}
    />
  )
}
