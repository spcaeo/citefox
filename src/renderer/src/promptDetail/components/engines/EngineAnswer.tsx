import { useMemo, type JSX } from 'react'
import type { BrandLens } from '@shared/brand-mentions'
import type { EngineAnswerView } from '@shared/ipc'
import { AnswerView } from '../../../components/answer/AnswerView'
import { EngineDot } from '../../../engines/EngineDots'
import { spendText, statusText } from '../../../engines/model'
import { formatStamp } from '../../../m3/model'
import { formatMoment } from '../../../utils/dates'
import { Chip } from '../../../ui'
import { NO_SOURCE_ACTIONS, type SourceActions } from '../../../sites/useSourceActions'
import { markdownCitations, sourceLines } from '../../../sites/sources'
import { Card } from '../OverviewCards'
import { SourcesCard } from '../sources/SourcesCard'
import '../../../engines/engines.css'

/**
 * One engine's tab on a question (Engines.dc.html panel 3): its latest answer laid out as
 * the engine showed it (AnswerView: headings, lists, tables, source chips, the brand in
 * yellow), a cited or named badge, when it was checked and what it cost, then the sources
 * it used as the same table as Google's sources tab. No answer, an engine that was down
 * at the provider, or a failed call is a plain grey line, never an error.
 */
export function EngineAnswer({
  answer,
  marketName,
  lens = null,
  topic = false,
  sourceActions = NO_SOURCE_ACTIONS
}: {
  answer: EngineAnswerView
  marketName: string
  /** Brand names and the own site, marked in yellow. Null marks nothing. */
  lens?: BrandLens | null
  /** The prompt is a topic's: its target is the topic's target page. */
  topic?: boolean
  /** The sources' quick actions, shared with Google's sources tab. Default: none. */
  sourceActions?: SourceActions
}): JSX.Element {
  const { label } = answer
  const hasAnswer =
    answer.status === 'cited' || answer.status === 'named' || answer.status === 'not_cited'
  const body = answer.markdown ?? answer.text ?? ''
  return (
    <div className="pd2-stack" data-testid="engine-answer" data-engine={answer.engine}>
      <Card
        headingId="pd-eng-h"
        title={answer.checkedAt === null ? label : `${label} · ${formatMoment(answer.checkedAt)}`}
        aside={<StatusBadge answer={answer} />}
      >
        {hasAnswer && body.trim() !== '' ? (
          <div className="eng-answer-body">
            <AnswerView markdown={body} sources={answer.sources} lens={lens} />
          </div>
        ) : (
          <p className="eng-answer-empty" role="note">
            {emptyText(answer)}
          </p>
        )}
        {answer.checkedAt !== null ? (
          <p className="eng-answer-meta">
            <span>Checked {formatStamp(answer.checkedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{marketName}</span>
            <span aria-hidden="true">·</span>
            <span>{spendText(answer.credits, answer.costMicros)}</span>
          </p>
        ) : null}
      </Card>
      {hasAnswer ? <EngineSources answer={answer} topic={topic} actions={sourceActions} /> : null}
    </div>
  )
}

function StatusBadge({ answer }: { answer: EngineAnswerView }): JSX.Element {
  const text =
    answer.status === 'cited' && answer.position !== null
      ? `Cited #${answer.position}`
      : statusText(answer.status)
  return (
    <Chip size="sm" tone={answer.status === 'cited' ? 'ok' : 'neutral'}>
      <EngineDot status={answer.status} />
      {text}
    </Chip>
  )
}

/** What to say when there is no answer to show, in plain words. */
function emptyText(answer: EngineAnswerView): string {
  const { label } = answer
  switch (answer.status) {
    case null:
      return `Not checked on ${label} yet. The next check asks ${label} too.`
    case 'no_answer':
      return `${label} gave no answer to this question in this check.`
    case 'unavailable':
      return `${label} was unavailable during this check, so there is no answer. CiteFox asks again at the next check.`
    case 'error':
      return `${label} could not be checked this time${answer.message ? `: ${answer.message}` : '.'} CiteFox tries again at the next check.`
    default:
      return `${label} answered without any text to show.`
  }
}

function EngineSources({
  answer,
  topic,
  actions
}: {
  answer: EngineAnswerView
  topic: boolean
  actions: SourceActions
}): JSX.Element {
  const { label } = answer
  const lines = useMemo(
    () =>
      sourceLines(
        answer.sources.map((source) => ({ ...source, key: `${source.position}:${source.url}` })),
        actions.competitors,
        answer.markdown ? markdownCitations(answer.markdown) : null,
        actions.tracked,
        actions.settings
      ),
    [answer, actions.competitors, actions.tracked, actions.settings]
  )
  return (
    <SourcesCard
      headingId="pd-eng-src-h"
      title={`Sources ${label} used`}
      gridLabel={`Sources ${label} used, in its order`}
      engine={label}
      lines={lines}
      topic={topic}
      actions={actions}
    />
  )
}
