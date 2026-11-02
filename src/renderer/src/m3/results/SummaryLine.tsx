import type { JSX } from 'react'
import type { PageResults } from '@shared/domain'
import { Markdown } from '../../components/Markdown'
import { UiIcon } from '../../ui'
import { RunAssists, type ResultsAssistScope } from '../ResultsAssists'
import { ReportHeadline } from './ReportHeadline'
import type { ResultsDrills } from './drills'

/**
 * The summary line under the KPI row (Topic-Overview.png "Since Oct 12: …"):
 * the report headline with every count drillable, Claude's run summary when
 * there is one, and the section's one AI menu
 * (Explain this change, Summarize this run). Its answer shows as one card.
 */
export function SummaryLine({
  results,
  drills,
  assists,
  hasPrevious
}: {
  results: PageResults
  drills: ResultsDrills
  assists?: ResultsAssistScope
  hasPrevious: boolean
}): JSX.Element {
  return (
    <section className="m3-summary-line ui-tint" data-tint="ai" aria-label="Summary">
      <span className="m3-summary-mark" aria-hidden="true">
        <UiIcon name="sparkle" size={16} />
      </span>
      <div className="m3-summary-body">
        <ReportHeadline results={results} drills={drills} />
        {results.runSummary ? (
          <div className="m3-summary-claude">
            <Markdown baseLevel={2}>{results.runSummary.headline}</Markdown>
            <Markdown className="muted" baseLevel={2}>
              {results.runSummary.body}
            </Markdown>
          </div>
        ) : null}
      </div>
      {assists ? <RunAssists scope={assists} hasPrevious={hasPrevious} /> : null}
    </section>
  )
}
