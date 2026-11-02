import { useState, type JSX } from 'react'
import type { HistoryEvent } from '@shared/domain'
import { Markdown } from '../components/Markdown'
import type { CompareTarget } from './CompareDialog'
import { fullDay } from './model'
import { NoteForm } from './NoteForm'
import { Button, Confirm } from '../ui'

/** Note edit and delete actions, shared by the timeline and the table. */
export interface NoteActions {
  editingId: string | null
  confirmingId: string | null
  onEdit: (noteId: string | null) => void
  onConfirmDelete: (noteId: string | null) => void
  onSave: (noteId: string, date: string, text: string) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
}

/**
 * The content-change line (with Compare content) and a note's text with its
 * edit and delete actions. The timeline and the table both draw these.
 */
export function ContentLine({
  event,
  onCompare
}: {
  event: HistoryEvent
  onCompare: (target: CompareTarget) => void
}): JSX.Element | null {
  const content = event.content
  if (content) {
    const from = content.fromSnapshotId
    return (
      <div className="hist-content ps-row">
        <span className="tag hist-tag-changed">
          {from === null ? 'First read of the page' : 'Page content changed'}
        </span>
        {from === null ? null : (
          <button
            type="button"
            className="m3-link"
            onClick={() => onCompare({ fromSnapshotId: from, toSnapshotId: content.toSnapshotId })}
          >
            Compare content
          </button>
        )}
        {event.detail === null ? <span className="faint">{content.summary}</span> : null}
      </div>
    )
  }
  if (event.check?.contentChanged === false) {
    return <span className="faint">Page content unchanged</span>
  }
  return null
}

export function NoteBody({
  event,
  notes
}: {
  event: HistoryEvent
  notes: NoteActions
}): JSX.Element | null {
  const note = event.note
  if (!note) return null
  if (notes.editingId === note.id) {
    return (
      <div className="hist-note-edit">
        <NoteForm
          initialDate={note.date}
          initialText={note.text}
          submitLabel="Save changes"
          savedMessage="Note updated."
          onSubmit={(date, text) => notes.onSave(note.id, date, text)}
          onCancel={() => notes.onEdit(null)}
        />
      </div>
    )
  }
  return (
    <>
      <Markdown className="hist-note-text" baseLevel={4}>
        {note.text}
      </Markdown>
      <div className="ps-row">
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Edit note from ${fullDay(event)}`}
          onClick={() => notes.onEdit(note.id)}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Delete note from ${fullDay(event)}`}
          onClick={() => notes.onConfirmDelete(note.id)}
        >
          Delete
        </Button>
      </div>
      {notes.confirmingId === note.id ? <DeleteNoteConfirm noteId={note.id} notes={notes} /> : null}
    </>
  )
}

/** "Delete this note?" (ui/Confirm): deleting a note can't be undone. */
export function DeleteNoteConfirm({
  noteId,
  notes
}: {
  noteId: string
  notes: Pick<NoteActions, 'onDelete' | 'onConfirmDelete'>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Confirm
      title="Delete this note?"
      body="The note leaves the timeline. This can't be undone."
      confirmLabel="Delete note"
      cancelLabel="Keep it"
      busy={busy}
      testId="hist-delete-note"
      onCancel={() => notes.onConfirmDelete(null)}
      onConfirm={() => {
        setBusy(true)
        void notes.onDelete(noteId).finally(() => setBusy(false))
      }}
    />
  )
}
