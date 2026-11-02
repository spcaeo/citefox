import { useId, type JSX } from 'react'
import { UrlText } from '../../../ui'
import type { NewTopicActions, NewTopicState } from '../hooks/useNewTopic'
import { countText, includedQuestions, pageLabel, pathFor, pickerRows } from '../utils/plan'
import { FitLine } from './FitLine'
import { NameField } from './NameField'
import { PreviewPanel } from './PreviewPanel'
import { ProblemHelp } from './ProblemHelp'
import { TrackedPicker } from './TrackedPicker'
import { WayCards } from './WayCards'

const BUSY_TEXT = {
  problem: 'Writing questions for each stage…',
  page: 'Writing the questions this page should answer…',
  questions: 'Adding your questions…',
  competitor: 'Reading their page and finding the questions it wins…'
} as const

/** Start: pick a way, describe it, and see the preview before anything is saved as a topic. */
export function StartStep({
  state,
  actions
}: {
  state: NewTopicState
  actions: NewTopicActions
}): JSX.Element {
  const { way, draft, tracked } = state
  const writing = state.busy === 'write'
  const locked = state.busy !== null
  const preview = draft !== null && draft.path === pathFor(way) ? includedQuestions(draft) : []
  return (
    <div className="nt-step">
      <WayCards way={way} disabled={locked} onWay={actions.setWay} />
      <WayFields state={state} actions={actions} disabled={locked} />
      {writing ? (
        <p className="nt-notice" role="status">
          {BUSY_TEXT[way]}
        </p>
      ) : null}
      {preview.length > 0 ? (
        <PreviewPanel
          way={way}
          questions={preview}
          busy={locked}
          fromAnswer={state.fromAnswer}
          onAgain={() => void actions.write()}
        />
      ) : null}
      {way !== 'questions' && preview.length > 0 ? (
        <FitLine
          fit={tracked.fit}
          list={tracked.list}
          picked={tracked.picked}
          disabled={locked}
          onToggle={tracked.toggle}
          onSetPicked={tracked.setPicked}
        />
      ) : null}
    </div>
  )
}

function WayFields({
  state,
  actions,
  disabled
}: {
  state: NewTopicState
  actions: NewTopicActions
  disabled: boolean
}): JSX.Element {
  const situationId = useId()
  const pageId = useId()
  const pastedId = useId()
  const urlId = useId()
  const { way, tracked } = state

  const situation = (optional: boolean, hint?: string): JSX.Element => (
    <div className="nt-field">
      <label className="nt-label" htmlFor={situationId}>
        {optional ? 'The buyer’s situation (optional)' : 'The buyer’s situation'}
      </label>
      <textarea
        id={situationId}
        className="ui-input nt-text"
        rows={3}
        value={state.situation}
        disabled={disabled}
        placeholder="A small IT team needs text alerts when servers go down, without a developer."
        onChange={(event) => actions.setSituation(event.target.value)}
      />
      {hint ? <p className="nt-hint">{hint}</p> : null}
    </div>
  )

  if (way === 'problem')
    return (
      <ProblemHelp
        state={state}
        actions={actions}
        disabled={disabled}
        situation={(optional) =>
          situation(
            optional,
            optional ? 'Added to the prompt. Leave it blank and the chatbot picks one.' : undefined
          )
        }
      />
    )

  if (way === 'page')
    return (
      <>
        <div className="nt-field">
          <label className="nt-label" htmlFor={pageId}>
            Your page
          </label>
          <select
            id={pageId}
            className="ui-input"
            value={state.pageUrl ?? ''}
            disabled={disabled}
            onChange={(event) => actions.setPageUrl(event.target.value || null)}
          >
            <option value="">Pick a page…</option>
            {state.candidates.map((candidate) => (
              <option key={candidate.url} value={candidate.url}>
                {pageLabel(candidate.url, state.candidates)}
              </option>
            ))}
          </select>
          {state.pageUrl ? <UrlText url={state.pageUrl} plain /> : null}
        </div>
        {situation(true)}
      </>
    )

  if (way === 'competitor')
    return (
      <div className="nt-field">
        <label className="nt-label" htmlFor={urlId}>
          Their page’s address
        </label>
        <input
          id={urlId}
          type="url"
          className="ui-input"
          value={state.competitorUrl}
          disabled={disabled}
          placeholder="https://competitor.example.com/blog/how-to-send-text-alerts"
          onChange={(event) => actions.setCompetitorUrl(event.target.value)}
        />
      </div>
    )

  const rows = pickerRows(tracked.list, tracked.picked)
  return (
    <>
      <div className="nt-field">
        <label className="nt-label" htmlFor={pastedId}>
          Paste questions, one per line
        </label>
        <textarea
          id={pastedId}
          className="ui-input nt-text"
          rows={4}
          value={state.pasted}
          disabled={disabled}
          onChange={(event) => actions.setPasted(event.target.value)}
        />
      </div>
      <div className="nt-field">
        <span className="nt-label">
          Or pick questions you already track
          {tracked.picked.size > 0 ? ` · ${countText(tracked.picked.size)} picked` : ''}
        </span>
        {tracked.listError ? (
          <p className="nt-error" role="alert">
            {tracked.listError}
          </p>
        ) : tracked.list === null ? (
          <p className="nt-hint" role="status">
            Loading your tracked questions…
          </p>
        ) : rows.length === 0 ? (
          <p className="nt-hint">Every tracked question is already in a topic.</p>
        ) : (
          <TrackedPicker
            label="Questions you already track"
            rows={rows}
            sources={tracked.list.sources}
            picked={tracked.picked}
            disabled={disabled}
            onToggle={tracked.toggle}
          />
        )}
      </div>
      {state.fromQuestions ? <NameField state={state} actions={actions} /> : null}
    </>
  )
}
