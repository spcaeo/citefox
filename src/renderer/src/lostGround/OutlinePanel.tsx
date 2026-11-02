import type { JSX } from 'react'
import type { LostGroundView } from '@shared/ipc'
import type { OutlineHeading } from '@shared/outline-diff'
import { pluralize } from '@shared/pluralize'
import { EmptyState, Panel } from '../ui'
import { formatMoment } from '../utils/dates'

/**
 * "Why it most likely happened": the page's headings before the drop and now, side
 * by side. Sections from before with no match now are in red; new ones are marked.
 */
export function OutlinePanel({ view }: { view: LostGroundView }): JSX.Element {
  const { outline, beforeRead, nowRead } = view
  return (
    <Panel title="Why it most likely happened" className="lg-outline">
      {outline && beforeRead && nowRead ? (
        <>
          <p className="muted lg-outline-line">
            {outline.removed === 0 && outline.added === 0
              ? 'Every section of the old version still has a match in the new one, so the outline alone does not explain the drop.'
              : `${pluralize(outline.removed, 'section')} of the old version ${outline.removed === 1 ? 'has' : 'have'} no match in the new one, and ${pluralize(outline.added, 'section')} ${outline.added === 1 ? 'is' : 'are'} new. The questions it lost often lived in the sections that went.`}
          </p>
          <div className="lg-outline-cols">
            <OutlineColumn
              id="lg-before"
              heading={`Before: ${readName(beforeRead.title)} · ${formatMoment(beforeRead.fetchedAt)}`}
              items={outline.before}
              side="before"
            />
            <OutlineColumn
              id="lg-now"
              heading={`Now: ${readName(nowRead.title)} · ${formatMoment(nowRead.fetchedAt)}`}
              items={outline.now}
              side="now"
            />
          </div>
          <p className="faint lg-legend">
            <span className="lg-legend-gone">In red:</span> sections with no match in the new
            version. <span className="lg-new-tag">New</span> marks sections the old version did not
            have.
          </p>
        </>
      ) : (
        <EmptyState
          compact
          icon="file"
          title="No outline to compare yet"
          body={
            beforeRead
              ? 'CiteFox has no read of the page since then. The next check reads it again.'
              : 'CiteFox did not read the page before the older check, so there is nothing to compare with.'
          }
        />
      )}
    </Panel>
  )
}

function readName(title: string | null): string {
  return title ? `“${title}”` : 'the page'
}

function OutlineColumn({
  id,
  heading,
  items,
  side
}: {
  id: string
  heading: string
  items: readonly OutlineHeading[]
  side: 'before' | 'now'
}): JSX.Element {
  return (
    <section className="lg-outline-col" aria-labelledby={id}>
      <h3 id={id} className="lg-outline-h">
        {heading}
      </h3>
      {items.length === 0 ? (
        <p className="faint">No section headings on this version.</p>
      ) : (
        <ol className="lg-headings">
          {items.map((item, index) => {
            const unmatched = item.match === null
            const className = [
              item.level === 'h3' ? 'lg-h3' : '',
              unmatched && side === 'before' ? 'lg-gone' : ''
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <li key={`${index}-${item.text}`} className={className || undefined}>
                {item.text}
                {unmatched && side === 'before' ? (
                  <span className="sr-only"> (no match in the new version)</span>
                ) : null}
                {unmatched && side === 'now' ? <span className="lg-new-tag">New</span> : null}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
