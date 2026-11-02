import type { JSX } from 'react'
import type { HistoryEvent, HistoryNote } from '@shared/domain'
import { Markdown } from '../components/Markdown'
import { Drawer, DrawerFacts, DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../ui'
import type { CompareTarget } from './CompareDialog'
import { ContentLine, DeleteNoteConfirm } from './EventBody'
import type { HistoryDrillContext } from './historyDrills'
import { EventChips } from './HistoryTimeline'
import { changeText, eventIso, fullDay, plainTitle, typeLabel, type EventNoteMode } from './model'
import { NearbyChecks } from './NearbyChecks'
import { NoteFields } from './NoteForm'
import { useNoteDraft } from './useNoteDraft'

/**
 * One History event in the shared Drawer (`drawer=hist-event&he.id=<event>`),
 * opened from a grid row: its chips and drills, Compare content, and the
 * checks around its date. A note is edited in place (`he.note=edit`) and
 * deleted through ui/Confirm (`he.note=delete`).
 */
export function EventDrawer({
  event,
  events,
  context,
  mode,
  onMode,
  onCompare,
  onSaveNote,
  onDeleteNote,
  onClose
}: {
  /** Null: the id on the URL is not in this page's history (a stale link). */
  event: HistoryEvent | null
  events: readonly HistoryEvent[]
  context: HistoryDrillContext
  mode: EventNoteMode
  onMode: (mode: EventNoteMode) => void
  onCompare: (target: CompareTarget) => void
  onSaveNote: (noteId: string, date: string, text: string) => Promise<void>
  /** Deletes the note; the drawer closes once it is gone. */
  onDeleteNote: (noteId: string) => Promise<void>
  onClose: () => void
}): JSX.Element {
  if (event === null) {
    return (
      <Drawer
        id="hist-event"
        title="Event"
        testId="hist-event-drawer"
        error={{ message: "This event is not in this page's history any more." }}
        onClose={onClose}
      />
    )
  }
  const note = event.note
  if (note) {
    return (
      <NoteEventDrawer
        // A new draft per note.
        key={note.id}
        event={event}
        note={note}
        events={events}
        context={context}
        mode={mode}
        onMode={onMode}
        onSaveNote={onSaveNote}
        onDeleteNote={onDeleteNote}
        onClose={onClose}
      />
    )
  }
  const content = event.content
  const from = content?.fromSnapshotId ?? null
  return (
    <Drawer
      id="hist-event"
      title={plainTitle(event.title)}
      heading={
        <Markdown inline baseLevel={4}>
          {event.title}
        </Markdown>
      }
      subtitle={`${typeLabel(event)} · ${fullDay(event)}`}
      testId="hist-event-drawer"
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        ...(content && from !== null
          ? {
              cancel: 'Close',
              secondary: {
                label: 'Compare content',
                icon: 'file' as const,
                onClick: () =>
                  onCompare({ fromSnapshotId: from, toSnapshotId: content.toSnapshotId })
              }
            }
          : {})
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="What happened">
            <div className="hist-drawer-body stack-tight">
              <div className="hist-head">
                <EventChips event={event} context={context} />
              </div>
              <ContentLine event={event} onCompare={onCompare} />
              {event.detail ? (
                <Markdown className="faint" baseLevel={4}>
                  {event.detail}
                </Markdown>
              ) : null}
            </div>
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this event">
          <DrawerSection title="Details">
            <DrawerFacts label="Event details" items={eventFacts(event)} />
          </DrawerSection>
          <NearbyChecks
            events={events}
            iso={eventIso(event)}
            exceptId={event.id}
            context={context}
          />
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

function eventFacts(event: HistoryEvent): { label: string; value: JSX.Element | string }[] {
  const check = event.check
  const facts: { label: string; value: JSX.Element | string }[] = [
    { label: 'Type', value: typeLabel(event) },
    { label: 'Date', value: fullDay(event) }
  ]
  if (check) {
    facts.push(
      { label: 'Score', value: <span className="num">{check.score ?? '—'}</span> },
      { label: 'Change', value: <span className="num">{changeText(check.scoreChange)}</span> },
      {
        label: 'Questions checked',
        value: (
          <span className="num">
            {check.promptsChecked} of {check.promptsTotal}
          </span>
        )
      }
    )
  }
  return facts
}

function NoteEventDrawer({
  event,
  note,
  events,
  context,
  mode,
  onMode,
  onSaveNote,
  onDeleteNote,
  onClose
}: {
  event: HistoryEvent
  note: HistoryNote
  events: readonly HistoryEvent[]
  context: HistoryDrillContext
  mode: EventNoteMode
  onMode: (mode: EventNoteMode) => void
  onSaveNote: (noteId: string, date: string, text: string) => Promise<void>
  onDeleteNote: (noteId: string) => Promise<void>
  onClose: () => void
}): JSX.Element {
  const editing = mode === 'edit'
  const draft = useNoteDraft({
    initialDate: note.date,
    initialText: note.text,
    savedMessage: 'Note updated.',
    onSubmit: (date, text) => onSaveNote(note.id, date, text)
  })
  const title = `Note · ${fullDay(event)}`
  return (
    <Drawer
      id="hist-event"
      title={title}
      subtitle="Your note on the page's timeline."
      testId="hist-event-drawer"
      dirty={editing && draft.dirty}
      busy={draft.saving}
      closeDisabled={draft.saving}
      focusOnOpen={editing ? 'auto' : 'close'}
      focusKey={mode}
      onClose={onClose}
      footer={{
        summary: editing ? 'Saving updates the note on the timeline.' : null,
        danger: {
          label: 'Delete note',
          icon: 'trash',
          ariaLabel: `Delete note from ${fullDay(event)}`,
          onClick: () => onMode('delete')
        },
        ...(editing
          ? {
              primary: {
                label: 'Save changes',
                busy: draft.saving,
                disabled: draft.saving,
                onClick: () => {
                  void draft.submit().then((saved) => {
                    if (saved) onMode('view')
                  })
                }
              }
            }
          : {
              cancel: 'Close',
              secondary: {
                label: 'Edit note',
                icon: 'pencil' as const,
                ariaLabel: `Edit note from ${fullDay(event)}`,
                onClick: () => {
                  draft.reset(note.date, note.text)
                  onMode('edit')
                }
              }
            })
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title="Your note"
            description={editing ? 'Change the date or the text, then save.' : undefined}
          >
            {editing ? (
              <form
                className="hist-note-form"
                aria-label="Edit the note"
                noValidate
                onSubmit={(submitEvent) => {
                  submitEvent.preventDefault()
                  void draft.submit().then((saved) => {
                    if (saved) onMode('view')
                  })
                }}
              >
                <NoteFields draft={draft} />
              </form>
            ) : (
              <Markdown className="hist-note-text" baseLevel={4}>
                {note.text}
              </Markdown>
            )}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this note">
          <NearbyChecks
            events={events}
            iso={eventIso(event)}
            exceptId={event.id}
            context={context}
          />
        </DrawerRail>
      </DrawerGrid>
      {mode === 'delete' ? (
        <DeleteNoteConfirm
          noteId={note.id}
          notes={{
            onDelete: onDeleteNote,
            onConfirmDelete: () => onMode('view')
          }}
        />
      ) : null}
    </Drawer>
  )
}
