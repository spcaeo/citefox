import type { JSX } from 'react'
import { savedPartHref, type SaveNote } from '../saveNote'

/** The save confirmation, with a link to the saved page instead of its raw id. */
export function SaveNoteText({ note }: { note: SaveNote }): JSX.Element {
  return (
    <p role="status">
      {note.text}{' '}
      {note.pageId && note.part ? (
        note.inOpenProject ? (
          <a href={savedPartHref(note.pageId, note.part)}>Open the saved page</a>
        ) : (
          <span>Open {note.projectName} to see the saved page.</span>
        )
      ) : null}
      {note.after ? ` ${note.after}` : ''}
    </p>
  )
}
