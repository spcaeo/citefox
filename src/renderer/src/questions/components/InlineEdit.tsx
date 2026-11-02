import { useEffect, useRef, useState, type JSX } from 'react'
import type { PromptTextRules, QuestionRow } from '@shared/ipc'
import { textProblem, wordCount } from '../../promptDetail/edit/model'

/**
 * The question's wording as a field, in its row: Enter saves, Escape cancels,
 * and the line under it counts words and says what is wrong before saving.
 * Keys stay in the field (the grid's arrows and Enter do not move or open).
 */
export function InlineQuestionEdit({
  row,
  rules,
  busy,
  onSave,
  onCancel
}: {
  row: QuestionRow
  rules: PromptTextRules
  busy: boolean
  onSave: (text: string) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(row.text)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const changed = text.trim() !== row.text
  const problem = changed ? textProblem(text, rules) : null
  const words = wordCount(text)
  const hint =
    problem ??
    `${words} ${words === 1 ? 'word' : 'words'} · ${changed ? 'Enter saves a new version' : 'no change'} · Esc cancels`
  return (
    <span className="qs-inline-edit" data-no-row-open="">
      <input
        ref={ref}
        className="ui-input"
        aria-label={`Wording of ${row.text}`}
        aria-invalid={problem !== null}
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (!changed) onCancel()
            else if (problem === null) onSave(text.trim())
          }
        }}
      />
      <span className="qs-inline-hint" {...(problem ? { 'data-problem': '' } : {})} role="status">
        {hint}
      </span>
    </span>
  )
}
