import type { JSX } from 'react'
import type { HistoryEvent } from '@shared/domain'
import { Drawer, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../ui'
import type { HistoryDrillContext } from './historyDrills'
import { isValidNoteDate, noteDateIso, todayLocal } from './model'
import { NearbyChecks } from './NearbyChecks'
import { NoteFields } from './NoteForm'
import { useNoteDraft } from './useNoteDraft'

/**
 * "Add a note" in the shared Drawer (`drawer=hist-note`): the date and what
 * changed on the page, with the checks around that date beside it. Closing
 * with unsaved text asks first.
 */
export function NoteDrawer({
  events,
  context,
  onAdd,
  onClose
}: {
  events: readonly HistoryEvent[]
  context: HistoryDrillContext
  onAdd: (date: string, text: string) => Promise<void>
  /** `saved` is true when it closes after a save. */
  onClose: (saved?: boolean) => void
}): JSX.Element {
  const draft = useNoteDraft({ savedMessage: 'Note saved.', onSubmit: onAdd })
  const day = isValidNoteDate(draft.date) ? draft.date : todayLocal()
  const save = (): void => {
    void draft.submit().then((saved) => {
      if (saved) onClose(true)
    })
  }
  return (
    <Drawer
      id="hist-note"
      title="Add a note"
      subtitle="Line up your edits with citation changes."
      testId="hist-note-drawer"
      dirty={draft.dirty}
      busy={draft.saving}
      closeDisabled={draft.saving}
      onClose={() => onClose()}
      footer={{
        summary: 'Adds the note to the timeline. No searches are used.',
        primary: {
          label: 'Save note',
          busy: draft.saving,
          disabled: draft.saving,
          onClick: save
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="What changed" description="What you changed on the page, and when.">
            <form
              className="hist-note-form"
              aria-label="Add a note"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                save()
              }}
            >
              <NoteFields draft={draft} />
            </form>
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="Checks around the note">
          <NearbyChecks events={events} iso={noteDateIso(day)} context={context} />
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
