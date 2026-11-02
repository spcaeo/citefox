import type { JSX } from 'react'
import { TOPIC_STAGE_LABEL, type TopicStage } from '@shared/domain'
import type { TopicPageCandidate } from '@shared/ipc'
import { UrlText } from '../../../ui'
import type { NewTopicActions, NewTopicState } from '../hooks/useNewTopic'
import { draftQuestions, pageLabel } from '../utils/plan'

/** One question on Target pages, from the draft or from the topic just made. */
interface TargetRow {
  promptId: string
  text: string
  stage: TopicStage | null
  targetUrl: string | null
  reason: string | null
}

function targetRows(state: NewTopicState): TargetRow[] {
  const topicId = state.url.topicId
  if (topicId !== null) {
    return (state.tracked.list?.rows ?? [])
      .filter((row) => row.sourceId === topicId && row.promptKind === 'question')
      .map((row) => ({
        promptId: row.promptId,
        text: row.text,
        stage: row.stage,
        targetUrl:
          row.promptId in state.topicTargets
            ? (state.topicTargets[row.promptId] ?? null)
            : row.targetUrl,
        reason: null
      }))
  }
  return draftQuestions(state.draft)
    .filter((prompt) => prompt.included && !prompt.flags.includes('brand'))
    .map((prompt) => ({
      promptId: prompt.id,
      text: prompt.text,
      stage: prompt.stage,
      targetUrl: prompt.targetUrl,
      reason: prompt.matchStatus === 'unmatched' ? null : prompt.matchReason
    }))
}

/** Target pages: which own page should be cited for each question. */
export function PagesStep({
  state,
  actions
}: {
  state: NewTopicState
  actions: NewTopicActions
}): JSX.Element {
  const rows = targetRows(state)
  const matching = state.busy === 'match'
  return (
    <div className="nt-step">
      {state.url.topicId !== null ? (
        <p className="nt-notice" role="status">
          Topic created. Choose the page that should be cited for each question, or leave it for
          later.
        </p>
      ) : null}
      {matching ? (
        <p className="nt-hint" role="status">
          Matching each question to your pages…
        </p>
      ) : null}
      {rows.length === 0 && state.tracked.list === null && state.url.topicId !== null ? (
        <p className="nt-hint" role="status">
          Loading the topic’s questions…
        </p>
      ) : null}
      <ol className="nt-targets" aria-label="Target pages">
        {rows.map((row, index) => (
          <TargetItem
            key={row.promptId}
            row={row}
            number={index + 1}
            candidates={state.candidates}
            disabled={state.busy !== null}
            onPick={(url) => void actions.setTarget(row.promptId, url)}
          />
        ))}
      </ol>
    </div>
  )
}

function TargetItem({
  row,
  number,
  candidates,
  disabled,
  onPick
}: {
  row: TargetRow
  number: number
  candidates: readonly TopicPageCandidate[]
  disabled: boolean
  onPick: (url: string | null) => void
}): JSX.Element {
  const known = row.targetUrl === null || candidates.some((item) => item.url === row.targetUrl)
  return (
    <li className="nt-target">
      <div className="nt-target-question">
        {row.stage ? <span className="nt-stage">{TOPIC_STAGE_LABEL[row.stage]}</span> : null}
        <span className="nt-target-text">{row.text}</span>
      </div>
      <div className="nt-target-page">
        <select
          className="ui-input ui-input-sm"
          aria-label={`Target page for question ${number}`}
          value={row.targetUrl ?? ''}
          disabled={disabled}
          onChange={(event) => onPick(event.target.value || null)}
        >
          <option value="">No page yet</option>
          {known || row.targetUrl === null ? null : (
            <option value={row.targetUrl}>{pageLabel(row.targetUrl, candidates)}</option>
          )}
          {candidates.map((candidate) => (
            <option key={candidate.url} value={candidate.url}>
              {pageLabel(candidate.url, candidates)}
            </option>
          ))}
        </select>
        {row.targetUrl ? <UrlText url={row.targetUrl} plain /> : null}
      </div>
      {row.reason ? <p className="nt-hint">{row.reason}</p> : null}
    </li>
  )
}
