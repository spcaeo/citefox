import { useId, useState, type JSX } from 'react'
import {
  TOPIC_STAGE_LABEL,
  TOPIC_STAGES,
  type TopicDraftPrompt,
  type TopicStage
} from '@shared/domain'
import { Button, IconButton } from '../../../ui'
import type { NewTopicActions, NewTopicState } from '../hooks/useNewTopic'
import { draftQuestions, includedQuestions } from '../utils/plan'
import { NameField } from './NameField'

/** Review questions: name the topic, tick what goes in, edit, restage, remove and add. */
export function ReviewStep({
  state,
  actions
}: {
  state: NewTopicState
  actions: NewTopicActions
}): JSX.Element {
  const questions = draftQuestions(state.draft)
  const included = includedQuestions(state.draft).length
  return (
    <div className="nt-step">
      <NameField state={state} actions={actions} />
      <p className="nt-hint" role="status">
        {included} of {questions.length} {questions.length === 1 ? 'question' : 'questions'} go into
        the topic. Edit any wording; nothing is searched yet.
      </p>
      <ol className="nt-review" aria-label="Questions">
        {questions.map((prompt, index) => (
          <ReviewRow
            key={prompt.id}
            prompt={prompt}
            number={index + 1}
            disabled={state.busy !== null}
            actions={actions}
          />
        ))}
      </ol>
      <AddRow disabled={state.busy !== null} onAdd={actions.add} />
    </div>
  )
}

function StageSelect({
  value,
  label,
  disabled,
  onChange
}: {
  value: TopicStage | null
  label: string
  disabled: boolean
  onChange: (stage: TopicStage | null) => void
}): JSX.Element {
  return (
    <select
      className="ui-input ui-input-sm nt-stage-select"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange((event.target.value || null) as TopicStage | null)}
    >
      <option value="">No stage</option>
      {TOPIC_STAGES.map((stage) => (
        <option key={stage} value={stage}>
          {TOPIC_STAGE_LABEL[stage]}
        </option>
      ))}
    </select>
  )
}

function ReviewRow({
  prompt,
  number,
  disabled,
  actions
}: {
  prompt: TopicDraftPrompt
  number: number
  disabled: boolean
  actions: NewTopicActions
}): JSX.Element {
  const [text, setText] = useState(prompt.text)
  const [seen, setSeen] = useState(prompt.text)
  // A saved rewrite (or a reload) replaces the typed wording.
  if (prompt.text !== seen) {
    setSeen(prompt.text)
    setText(prompt.text)
  }
  const save = (): void => {
    if (text.trim().length === 0) setText(prompt.text)
    else void actions.editText(prompt, text)
  }
  return (
    <li className="nt-review-row" data-off={!prompt.included || undefined}>
      <input
        type="checkbox"
        className="ui-check"
        aria-label={`Include question ${number}`}
        checked={prompt.included}
        disabled={disabled}
        onChange={() => void actions.toggleInclude(prompt)}
      />
      <input
        className="ui-input ui-input-sm nt-review-text"
        aria-label={`Question ${number}`}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            save()
          }
        }}
      />
      <StageSelect
        value={prompt.stage}
        label={`Stage of question ${number}`}
        disabled={disabled}
        onChange={(stage) => void actions.setStage(prompt, stage)}
      />
      <IconButton
        icon="trash"
        size="sm"
        label={`Remove question ${number}`}
        disabled={disabled}
        onClick={() => void actions.remove(prompt)}
      />
    </li>
  )
}

function AddRow({
  disabled,
  onAdd
}: {
  disabled: boolean
  onAdd: (text: string, stage: TopicStage | null) => Promise<void>
}): JSX.Element {
  const fieldId = useId()
  const [text, setText] = useState('')
  const [stage, setStage] = useState<TopicStage | null>(null)
  const add = async (): Promise<void> => {
    if (text.trim().length === 0) return
    await onAdd(text, stage)
    setText('')
  }
  return (
    <div className="nt-add">
      <label className="sr-only" htmlFor={fieldId}>
        Add a question
      </label>
      <input
        id={fieldId}
        className="ui-input ui-input-sm nt-review-text"
        placeholder="Add a question in the buyer’s words"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void add()
          }
        }}
      />
      <StageSelect
        value={stage}
        label="Stage of the new question"
        disabled={disabled}
        onChange={setStage}
      />
      <Button
        size="sm"
        icon="plus"
        disabled={disabled || text.trim().length === 0}
        onClick={() => void add()}
      >
        Add
      </Button>
    </div>
  )
}
