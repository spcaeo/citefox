import type { FormEvent, JSX } from 'react'
import { Button, DrawerField, DrawerFields } from '../ui'
import { NOTE_MAX, useNoteDraft, type NoteDraft } from './useNoteDraft'

/** The Date and Note fields of a draft, labels above (drawer field style). */
export function NoteFields({ draft }: { draft: NoteDraft }): JSX.Element {
  const id = draft.fieldId
  const errorField = draft.errorField
  const error = draft.error
  return (
    <DrawerFields>
      <DrawerField
        label="Date"
        htmlFor={`${id}-date`}
        hint="The day you changed the page."
        error={errorField === 'date' ? error : null}
      >
        <input
          id={`${id}-date`}
          aria-describedby={
            errorField === 'date' ? `${id}-date-hint ${id}-date-error` : `${id}-date-hint`
          }
          className="ui-input hist-date-input"
          type="date"
          value={draft.date}
          required
          onChange={(event) => draft.setDate(event.target.value)}
        />
      </DrawerField>
      <DrawerField
        label="Note"
        htmlFor={`${id}-text`}
        counter={`${draft.text.length.toLocaleString('en-US')} / ${NOTE_MAX.toLocaleString('en-US')}`}
        error={errorField === 'text' ? error : null}
      >
        <textarea
          id={`${id}-text`}
          aria-describedby={errorField === 'text' ? `${id}-text-error` : undefined}
          className="ui-input hist-textarea"
          rows={5}
          value={draft.text}
          placeholder="What did you change on the page?"
          required
          maxLength={NOTE_MAX}
          data-autofocus
          onChange={(event) => draft.setText(event.target.value)}
        />
      </DrawerField>
    </DrawerFields>
  )
}

/**
 * Date and text for a note with its own Save and Cancel (FR-15.3): editing a
 * note in place on the timeline. The drawers use `useNoteDraft` and
 * `NoteFields` with the drawer footer instead.
 */
export function NoteForm({
  initialDate,
  initialText = '',
  submitLabel,
  savedMessage,
  onSubmit,
  onCancel,
  clearOnSave = false
}: {
  initialDate?: string
  initialText?: string
  submitLabel: string
  /** Announced after a save, such as "Note saved." */
  savedMessage: string
  onSubmit: (date: string, text: string) => Promise<void>
  onCancel?: () => void
  clearOnSave?: boolean
}): JSX.Element {
  const draft = useNoteDraft({
    ...(initialDate === undefined ? {} : { initialDate }),
    initialText,
    savedMessage,
    onSubmit,
    clearOnSave
  })

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void draft.submit()
  }

  return (
    <form className="hist-note-form stack-tight" onSubmit={submit} noValidate>
      <NoteFields draft={draft} />
      <div className="ps-row">
        <Button type="submit" variant="primary" disabled={draft.saving}>
          {draft.saving ? 'Saving…' : submitLabel}
        </Button>
        {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
      </div>
      <p className="faint" role="status">
        {draft.saved ?? ''}
      </p>
    </form>
  )
}
