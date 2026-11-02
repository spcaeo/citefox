import type { JSX, ReactNode } from 'react'
import { ResultBar, useResultWords } from '../../../ui'
import type { SearchFilter, Totals } from '../model'
import { pctText } from './text'

/**
 * The topic's summary card (TopicBig): "240 searches · target page cited: 35% of searches
 * with an AI Overview" (the topic's one headline, as in the sidebar and the Topics list),
 * "Needs work: 134 · shown in Fixes as 3 page fixes", and the big result bar whose
 * legend counts each open their drill.
 */
export function SummaryCard({
  totals,
  pageFixes,
  fixesHref,
  drillHref,
  actions,
  checking = false
}: {
  totals: Totals
  /** Distinct pages to fix (improve, pick an owner, or write) for the searches that need work. */
  pageFixes: number
  fixesHref: string
  drillHref: (filter: SearchFilter) => string
  /** The section's one AI menu, at the right of the first line. */
  actions?: ReactNode
  /** A check is running: unchecked searches are on their way, not missing. */
  checking?: boolean
}): JSX.Element {
  const words = useResultWords()
  const waiting = checking && totals.counts.not_checked === totals.searches
  return (
    <section className="ui-panel tv-summary" aria-label="Topic summary" data-guide="topic-kpis">
      <div className="tv-summary-top">
        <p className="tv-summary-lead num">
          <b>
            {totals.searches.toLocaleString('en-US')}{' '}
            {totals.searches === 1 ? 'search' : 'searches'}
          </b>
          {waiting ? (
            <span className="tv-muted"> · Waiting for the first answers</span>
          ) : totals.targetPct === null ? null : (
            <>
              <b>
                {' '}
                · {words.cited ? 'your pages cited' : 'right page cited'}:{' '}
                {pctText(totals.targetPct)}
              </b>
              <span className="tv-muted"> of searches {words.withAnswer}</span>
            </>
          )}
        </p>
        {waiting ? null : (
          <p className="tv-summary-work num">
            <b>Needs work: {totals.needsWork.toLocaleString('en-US')}</b>
            {totals.needsWork > 0 ? (
              <>
                {' '}
                ·{' '}
                <a href={fixesHref}>
                  shown in Fixes as {pageFixes} {pageFixes === 1 ? 'page fix' : 'page fixes'}
                </a>
              </>
            ) : null}
          </p>
        )}
        {actions}
      </div>
      <ResultBar
        size="header"
        counts={totals.counts}
        label="Topic searches"
        hrefFor={(result) => drillHref({ result })}
      />
      {totals.counts.not_checked > 0 ? (
        <p className="tv-muted num">
          {checking
            ? `${totals.counts.not_checked} still checking: they fill in as the answers land.`
            : `${totals.counts.not_checked} not checked yet: the next check fills them in.`}
        </p>
      ) : null}
    </section>
  )
}
