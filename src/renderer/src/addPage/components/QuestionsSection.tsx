import { useId, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { DrawerSection } from '../../ui'
import {
  MAX_DRAFT_COUNT,
  MAX_TYPED_QUESTIONS,
  typedQuestions,
  type AddPageState,
  type QuestionWay
} from '../model'

export interface QuestionsSectionProps {
  state: AddPageState
  typed: string
  disabled: boolean
  onChange: (patch: Partial<AddPageState>) => void
  onTyped: (text: string) => void
}

/**
 * Which questions the page tracks: Claude drafts them from the page after it
 * reads it (as Add a page always did), or you type your own, which CiteFox adds
 * once the page is read. Either way nothing is searched until a check.
 */
export function QuestionsSection({
  state,
  typed,
  disabled,
  onChange,
  onTyped
}: QuestionsSectionProps): JSX.Element {
  const name = useId()
  const countId = useId()
  const textId = useId()
  const lines = typedQuestions(typed)
  const ways: { way: QuestionWay; label: string; hint: string }[] = [
    {
      way: 'claude',
      label: 'Suggest with CiteFox AI',
      hint: 'CiteFox AI reads the page and drafts buyer questions. You review them before the first check.'
    },
    {
      way: 'type',
      label: 'Type my own',
      hint: 'CiteFox adds your questions as soon as it has read the page.'
    }
  ]
  return (
    <DrawerSection
      title="Questions"
      description="The buyer questions CiteFox searches for this page. Writing them uses no searches."
      testId="add-page-questions"
    >
      <fieldset className="cn2-modes adp-ways">
        <legend className="sr-only">How the page gets its questions</legend>
        {ways.map((item) => (
          <label key={item.way} className="cn2-mode">
            <input
              type="radio"
              name={name}
              value={item.way}
              checked={state.way === item.way}
              disabled={disabled}
              onChange={() => onChange({ way: item.way })}
            />
            <span className="cn2-mode-text">
              <span className="cn2-mode-label">{item.label}</span>
              <span className="cn2-mode-hint">{item.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {state.way === 'claude' ? (
        <div className="adp-field">
          <label className="ui-drawer-label" htmlFor={countId}>
            Questions to draft
          </label>
          <input
            id={countId}
            className="ui-input mono adp-narrow"
            type="number"
            min={1}
            max={MAX_DRAFT_COUNT}
            value={state.count}
            disabled={disabled}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value >= 1 && value <= MAX_DRAFT_COUNT) {
                onChange({ count: value })
              }
            }}
          />
        </div>
      ) : (
        <div className="adp-field">
          <label className="ui-drawer-label" htmlFor={textId}>
            One question per line
          </label>
          <textarea
            id={textId}
            className="adp-text"
            rows={6}
            value={typed}
            disabled={disabled}
            placeholder="How do I text all my staff at once?"
            onChange={(event) => onTyped(event.target.value)}
          />
          <p className="ui-drawer-hint">
            {lines.length > MAX_TYPED_QUESTIONS
              ? `At most ${MAX_TYPED_QUESTIONS} questions at a time.`
              : `${pluralize(lines.length, 'question')}. CiteFox AI also drafts the same number from the page; remove any you do not want on the Questions tab.`}
          </p>
        </div>
      )}
    </DrawerSection>
  )
}
