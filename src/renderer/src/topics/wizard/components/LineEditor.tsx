import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { Button } from '../../../ui'

export interface LineEditorChoice {
  value: string
  label: string
}

/**
 * Add or edit one line (a question, a keyword, a profile point) above its
 * grid: the text, an optional choice (stage, section, group), Save and Cancel.
 * Enter saves a one-line field; Escape cancels.
 */
export function LineEditor({
  title,
  label,
  initialText,
  choiceLabel,
  choices,
  initialChoice,
  multiline = true,
  hint,
  validate,
  onSave,
  onCancel
}: {
  title: string
  label: string
  initialText: string
  choiceLabel?: string
  choices?: readonly LineEditorChoice[]
  initialChoice?: string
  multiline?: boolean
  hint?: string
  /** A plain sentence when the text cannot be saved (such as "Names your brand"). */
  validate?: (text: string) => string | null
  onSave: (text: string, choice: string | null) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(initialText)
  const [choice, setChoice] = useState(initialChoice ?? choices?.[0]?.value ?? '')
  const [touched, setTouched] = useState(false)
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const ids = { text: useId(), choice: useId(), error: useId() }
  const problem = text.trim().length === 0 ? 'Write something first.' : (validate?.(text) ?? null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  function save(): void {
    setTouched(true)
    if (problem) return
    onSave(text.trim(), choices ? choice : null)
  }

  const common = {
    id: ids.text,
    ref: field,
    className: multiline ? 'ui-input tw-textarea' : 'ui-input',
    value: text,
    'aria-invalid': touched && problem ? true : undefined,
    'aria-describedby': touched && problem ? ids.error : undefined,
    onChange: (event: { target: { value: string } }) => setText(event.target.value),
    onKeyDown: (event: { key: string; preventDefault: () => void; shiftKey: boolean }) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter' && (!multiline || !event.shiftKey)) {
        event.preventDefault()
        save()
      }
    }
  }

  return (
    <section className="ui-panel tw-editor" aria-label={title}>
      <div className="tw-editor-row">
        <div className="tw-field tw-grow">
          <label className="tw-label" htmlFor={ids.text}>
            {label}
          </label>
          {multiline ? <textarea rows={2} {...common} /> : <input {...common} />}
          {touched && problem ? (
            <p className="tw-help tw-warn" id={ids.error}>
              {problem}
            </p>
          ) : hint ? (
            <p className="tw-help">{hint}</p>
          ) : null}
        </div>
        {choices && choiceLabel ? (
          <div className="tw-field">
            <label className="tw-label" htmlFor={ids.choice}>
              {choiceLabel}
            </label>
            <select
              id={ids.choice}
              className="ui-input tw-select"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
            >
              {choices.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="tw-editor-actions">
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
