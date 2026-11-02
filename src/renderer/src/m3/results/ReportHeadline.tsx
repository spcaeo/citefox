import type { JSX, ReactNode } from 'react'
import type { PageResults } from '@shared/domain'
import { percent, reportHeadline, type HeadlineCounts } from '@shared/report-copy'
import { DrillNumber, whereDrill, type PromptDrill } from '../../drill'
import type { ResultsDrills } from './drills'

/** The counts behind the report headline (Docs/REPORT-SPEC.md §2). Measured leaves out errors. */
function headlineCounts(results: PageResults): HeadlineCounts | null {
  const run = results.run
  if (!run) return null
  return {
    measured: run.promptsChecked - run.errors,
    aio: run.promptsWithAio,
    cited: run.pageCited + run.otherOwnPage,
    named: results.prompts.filter((row) => row.named === true).length,
    notVisible: run.notCited,
    failed: run.errors
  }
}

/**
 * The report's overview headline, word for word as `reportHeadline` writes it
 * (so app and exports read the same), with every count opening its prompts.
 * A count whose prompts don't add up to it stays plain text.
 */
export function ReportHeadline({
  results,
  drills
}: {
  results: PageResults
  drills: ResultsDrills
}): JSX.Element | null {
  const counts = headlineCounts(results)
  if (!counts) return null
  const tracked = whereDrill(
    results,
    {
      id: 'tracked',
      title: 'Questions tracked',
      description: 'Every question in this market, including searches that failed.'
    },
    () => true,
    drills.scope
  )
  const failedDrill = whereDrill(
    results,
    {
      id: 'failed',
      title: 'Searches that failed',
      description: 'Questions whose Google search failed after retries. They have no result yet.'
    },
    (row) => row.status === 'error',
    drills.scope
  )
  function n(drill: PromptDrill | null, value: number, label: string): ReactNode {
    if (!drill || drill.rows.length !== value) return value
    return <DrillNumber drill={drill} label={`${value} ${label}`} />
  }
  const noun = counts.noun ?? 'buyer questions'
  let body: ReactNode
  if (counts.measured === 0 || counts.aio === 0) {
    body = reportHeadline(counts)
  } else {
    const aio = n(drills.get('kpi:aio'), counts.aio, 'questions with an AI Overview')
    const failed = counts.failed ?? 0
    const total = n(tracked, counts.measured + failed, 'questions tracked')
    const failedNote =
      failed > 0 ? (
        <>
          {' '}
          ({n(failedDrill, failed, failed === 1 ? 'search failed' : 'searches failed')}{' '}
          {failed === 1 ? 'search failed' : 'searches failed'})
        </>
      ) : null
    const cited = n(drills.get('funnel:own_domain'), counts.cited, 'questions that cite you')
    const named = n(drills.get('named'), counts.named, 'questions that name you')
    const hidden = n(drills.get('bucket:invisible'), counts.notVisible, 'questions without you')
    body = (
      <>
        Google shows an AI Overview for {aio} of your {total} {noun}
        {failedNote}.{' '}
        {counts.cited === 0 ? (
          <>You are not cited in any of them, and named in the text of {named}.</>
        ) : (
          <>
            You are cited in {cited} of them ({percent(counts.cited, counts.aio) ?? 0}%) and named
            in the text of {named}.
          </>
        )}{' '}
        {counts.notVisible === 0 ? (
          'Every answer cites or names you somewhere.'
        ) : (
          <>
            In {hidden} the answer appears without you at all — that is the opportunity this report
            is about.
          </>
        )}
      </>
    )
  }
  return <p className="m3-headline">{body}</p>
}
