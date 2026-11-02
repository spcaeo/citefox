import { useId, useState } from 'react'
import { errorText } from '../components/errorText'
import { isValidNoteDate, todayLocal } from './model'

export const NOTE_MAX = 4000

/** A note's date and text being written, its check and its save (FR-15.3). */
export interface NoteDraft {
  date: string
  text: string
  setDate: (value: string) => void
  setText: (value: string) => void
  error: string | null
  /** The field the error is about. */
  errorField: 'date' | 'text' | null
  saved: string | null
  saving: boolean
  /** Changed from what it started with. */
  dirty: boolean
  /** The fields' id stem: `<id>-date` and `<id>-text`. */
  fieldId: string
  /** Checks the note, then saves it. Resolves true once saved. */
  submit: () => Promise<boolean>
  /** Starts again from this date and text (editing the note as it is now). */
  reset: (date: string, text: string) => void
}

/**
 * The state of "Add a note" and of editing one. `onSubmit` rejects with an
 * Error whose message is shown under the fields.
 */
export function useNoteDraft({
  initialDate,
  initialText = '',
  savedMessage,
  onSubmit,
  clearOnSave = false
}: {
  initialDate?: string
  initialText?: string
  /** Announced after a save, such as "Note saved." */
  savedMessage: string
  onSubmit: (date: string, text: string) => Promise<void>
  clearOnSave?: boolean
}): NoteDraft {
  const [base, setBase] = useState(() => ({
    date: initialDate ?? todayLocal(),
    text: initialText
  }))
  const [date, setDate] = useState(base.date)
  const [text, setText] = useState(initialText)
  const [problem, setProblem] = useState<{ field: 'date' | 'text'; message: string } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fieldId = useId()
  const focus = (field: 'date' | 'text'): void => {
    document.getElementById(`${fieldId}-${field}`)?.focus()
  }

  async function submit(): Promise<boolean> {
    if (saving) return false
    setSaved(null)
    const trimmed = text.trim()
    if (!isValidNoteDate(date)) {
      setProblem({ field: 'date', message: 'Pick the date of the change.' })
      focus('date')
      return false
    }
    if (trimmed === '') {
      setProblem({ field: 'text', message: 'Write what changed on the page.' })
      focus('text')
      return false
    }
    if (trimmed.length > NOTE_MAX) {
      setProblem({
        field: 'text',
        message: `Keep the note under ${NOTE_MAX.toLocaleString('en-US')} characters.`
      })
      focus('text')
      return false
    }
    setProblem(null)
    setSaving(true)
    try {
      await onSubmit(date, trimmed)
      if (clearOnSave) setText('')
      setSaved(savedMessage)
      return true
    } catch (cause) {
      setProblem({ field: 'text', message: errorText(cause, 'Could not save the note.') })
      return false
    } finally {
      setSaving(false)
    }
  }

  return {
    date,
    text,
    setDate,
    setText,
    error: problem?.message ?? null,
    errorField: problem?.field ?? null,
    saved,
    saving,
    dirty: date !== base.date || text !== base.text,
    fieldId,
    submit,
    reset: (nextDate, nextText) => {
      setBase({ date: nextDate, text: nextText })
      setDate(nextDate)
      setText(nextText)
      setProblem(null)
      setSaved(null)
    }
  }
}
