import { useId, type JSX } from 'react'
import { Button } from '../../../ui'
import type { NewTopicActions, NewTopicState } from '../hooks/useNewTopic'

/** The topic's name; made from tracked questions, Claude suggests it. */
export function NameField({
  state,
  actions
}: {
  state: NewTopicState
  actions: NewTopicActions
}): JSX.Element {
  const nameId = useId()
  const hintId = useId()
  const canSuggest = state.fromQuestions && state.tracked.picked.size > 0
  return (
    <div className="nt-field">
      <div className="nt-field-head">
        <label className="nt-label" htmlFor={nameId}>
          Topic name
        </label>
        {canSuggest ? (
          <Button
            variant="text"
            size="sm"
            icon="sparkle"
            busy={state.busy === 'name'}
            disabled={state.busy !== null && state.busy !== 'name'}
            onClick={() => void actions.suggestName()}
          >
            Suggest a name
          </Button>
        ) : null}
      </div>
      <input
        id={nameId}
        className="ui-input"
        value={state.name}
        placeholder={state.topicName || 'Name the topic'}
        disabled={state.busy === 'create'}
        aria-describedby={state.nameSuggested ? hintId : undefined}
        onChange={(event) => actions.setName(event.target.value)}
      />
      {state.nameSuggested ? (
        <p id={hintId} className="nt-hint">
          Name suggested from the questions
        </p>
      ) : null}
    </div>
  )
}
