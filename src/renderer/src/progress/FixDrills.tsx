import { Fragment, type JSX } from 'react'
import type { FixMarketOutcome, FixOtherPrompts, LoggedFix } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { DrillLink } from '../drill'
import { formatMoment } from '../m3/model'
import { RunDrillButton, RunFigure } from '../visibility/progressRuns'
import { fixSummaryParts, othersLine, outcomeLabel, verdictPromptIds } from './model'

/**
 * Fix card drills (FR-14.7, REPORT-SPEC "Interaction model"). Rows come from
 * the check the number belongs to: the verdict from the follow-up (after)
 * check, the comparison from the first full check after go-live.
 */

/** The verdict badge. It opens the targeted prompts with that result in the after check. */
export function FixVerdict({
  fix,
  outcome
}: {
  fix: LoggedFix
  outcome: FixMarketOutcome | undefined
}): JSX.Element {
  const tone = `fx-verdict fx-verdict-${outcome?.verdict ?? 'waiting'}`
  if (!outcome || outcome.verdict === 'waiting') {
    return <span className={tone}>Waiting for the follow-up</span>
  }
  const ids = verdictPromptIds(outcome)
  const label = outcomeLabel(outcome)
  if (ids.length === 0) return <span className={tone}>{label}</span>
  const id = `fix:${fix.number}:verdict`
  const copy = {
    id,
    title: `Fix ${fix.number} · ${label}`,
    description: `Targeted questions with this result in the follow-up check on ${formatMoment(outcome.afterAt)}. One check is a signal, not proof.`
  }
  if (outcome.verdict === 'partly') {
    return (
      <RunDrillButton
        className={`${tone} fx-verdict-btn`}
        label={`Partly worked · ${ids.length} of ${pluralize(outcome.compared, 'question')}, show the ones that worked`}
        copy={copy}
        ids={ids}
        marketId={outcome.marketId}
        runId={outcome.afterRunId}
      >
        Partly worked · <RunFigure id={id} ids={ids} /> of {pluralize(outcome.compared, 'question')}
      </RunDrillButton>
    )
  }
  return (
    <RunDrillButton
      className={`${tone} fx-verdict-btn`}
      label={`${label}, show the targeted questions`}
      copy={copy}
      ids={ids}
      marketId={outcome.marketId}
      runId={outcome.afterRunId}
      untracked
    >
      {label}
    </RunDrillButton>
  )
}

/** "Live Oct 8 · targets prompts 4, 6 and 9 · checked Oct 19 …", each prompt number a link. */
export function FixSummary({
  fix,
  outcome,
  pageId,
  marketId,
  place,
  now
}: {
  fix: LoggedFix
  outcome: FixMarketOutcome | undefined
  pageId: string
  marketId: string | null
  place: string
  now: Date
}): JSX.Element {
  const parts = fixSummaryParts(fix, outcome, place, now)
  const prompts = [...(outcome?.prompts ?? [])].sort((a, b) => a.promptPosition - b.promptPosition)
  return (
    <p className="faint">
      {parts.live} · targets{' '}
      {prompts.length === 0
        ? 'no questions'
        : `${prompts.length === 1 ? 'question' : 'questions'} `}
      {prompts.map((prompt, index) => (
        <Fragment key={prompt.promptId}>
          {index === 0 ? '' : index === prompts.length - 1 ? ' and ' : ', '}
          <DrillLink
            target={{ kind: 'prompt', pageId, promptId: prompt.promptId, marketId }}
            label={`Question ${prompt.promptPosition}, open its latest result`}
          >
            {prompt.promptPosition}
          </DrillLink>
        </Fragment>
      ))}
      {parts.rest.map((part) => ` · ${part}`).join('')}
    </p>
  )
}

/** "N of the M prompts you didn't target also moved": N opens exactly those prompts. */
export function FixComparison({
  others,
  marketId
}: {
  others: FixOtherPrompts | null
  marketId: string | null
}): JSX.Element {
  if (others === null || others.total === 0 || others.promptIds.length === 0) {
    return <p className="muted">{othersLine(others)}</p>
  }
  const id = `fix-others:${others.toRunId}`
  const total = pluralize(others.total, 'question')
  return (
    <p className="muted">
      <RunDrillButton
        label={`${others.promptIds.length} of the ${total} you didn’t target also moved, show them`}
        copy={{
          id,
          title: 'Other questions that moved',
          description:
            'Questions this fix did not target that moved between the last full check before go-live and the first full check after it. Google’s overviews shift on their own.'
        }}
        ids={others.promptIds}
        marketId={marketId}
        runId={others.toRunId}
      >
        <RunFigure id={id} ids={others.promptIds} /> of the {total} you didn’t target
      </RunDrillButton>{' '}
      also moved in the same period. Google’s overviews shift on their own, so treat one check as a
      signal, not proof.
    </p>
  )
}
