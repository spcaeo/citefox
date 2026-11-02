import type { JSX } from 'react'
import type { MarketCheckMetrics } from '@shared/domain'
import { DrillNumber, type PromptDrill } from '../drill'
import { formatMonthDay } from './model'

/**
 * The Overview.dc.html summary sentence, built from the run's own counts.
 * Shown when Claude has not written a summary for this check. With `drill`,
 * every number opens the prompts behind it.
 */
export function RunHeadline({
  run,
  brand,
  drill
}: {
  run: MarketCheckMetrics
  brand: string
  /** Results drills by id. Absent: the numbers are plain text. */
  drill?: (id: string) => PromptDrill | null
}): JSX.Element {
  const day = formatMonthDay(run.finishedAt ?? run.startedAt)
  function figure(id: string, value: number, label: string): JSX.Element {
    const found = drill?.(id) ?? null
    if (!found || found.rows.length !== value) return <>{value}</>
    return <DrillNumber drill={found} label={`${value} ${label}`} />
  }
  return (
    <p className="m3-headline">
      On {day}, Google showed an AI Overview for{' '}
      <strong>
        {figure('kpi:aio', run.promptsWithAio, 'questions with an AI Overview')} of{' '}
        {figure('funnel:checked', run.promptsChecked, 'questions checked')}
      </strong>{' '}
      questions, citing this page in{' '}
      <strong>{figure('kpi:page', run.pageCited, 'questions citing this page')}</strong>, another{' '}
      {brand} page in{' '}
      <strong>
        {figure('drop:this_page', run.otherOwnPage, `questions citing another ${brand} page`)}
      </strong>{' '}
      and naming {brand} without a link in{' '}
      <strong>
        {figure(
          'bucket:named_not_linked',
          run.brandMentioned,
          `questions naming ${brand} without a link`
        )}
      </strong>
      ; {brand} was not in the other{' '}
      <strong>{figure('bucket:invisible', run.notCited, `questions without ${brand}`)}</strong>.
    </p>
  )
}
