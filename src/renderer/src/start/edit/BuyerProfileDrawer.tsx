import { useState, type JSX } from 'react'
import type { StartBuyers, StartEdit } from '@shared/ipc'
import { Drawer, DrawerField, DrawerGrid, DrawerSection } from '../../ui'
import { EditableChips } from './EditableChips'
import { EditableRows } from './EditableRows'
import './edit.css'

/**
 * Edit the buyer profile (journey A3 "Who buys") in the kit's Drawer, on the
 * URL as `drawer=start-buyers`. Segments and triggers send their own edit at
 * once (each undoable from the toast). Who buys is typed, so it is saved by
 * the primary button; while it differs from the saved text the drawer is
 * dirty, and ✕, Escape, Cancel and Back ask "Discard changes?" first.
 */
export function BuyerProfileDrawer({
  buyers,
  onSend,
  onClose
}: {
  buyers: StartBuyers
  onSend: (edit: StartEdit) => void
  onClose: () => void
}): JSX.Element {
  const [who, setWho] = useState(buyers.who ?? '')
  const changed = who.trim().length > 0 && who.trim() !== (buyers.who ?? '').trim()

  return (
    <Drawer
      id="start-buyers"
      title="Edit the buyer profile"
      subtitle="Who buys shapes the questions CiteFox writes for this site."
      testId="start-buyers-drawer"
      dirty={changed}
      onClose={onClose}
      footer={{
        summary: changed
          ? 'Who buys is not saved yet'
          : 'Segments and triggers save as you change them · each can be undone',
        primary: {
          label: changed ? 'Save and close' : 'Done',
          onClick: () => {
            if (changed) onSend({ kind: 'who', op: 'set', text: who.trim() })
            onClose()
          }
        }
      }}
    >
      <DrawerGrid className="ed-drawer">
        <DrawerSection>
          <DrawerField
            label="Who buys"
            hint="One or two sentences: the people who buy and what they need."
          >
            {({ id, describedBy }) => (
              <textarea
                id={id}
                aria-describedby={describedBy}
                className="ui-input ed-textarea"
                rows={3}
                value={who}
                onChange={(event) => setWho(event.target.value)}
              />
            )}
          </DrawerField>
        </DrawerSection>
        <DrawerSection
          title="Segments"
          count={buyers.segments.length}
          description="Kinds of buyer. Each change saves at once."
          span={6}
        >
          <EditableChips
            label="Segments"
            noun="segment"
            items={buyers.segments}
            onRename={(text, to) => onSend({ kind: 'segment', op: 'rename', text, to })}
            onRemove={(text) => onSend({ kind: 'segment', op: 'remove', text })}
            onAdd={(text) => onSend({ kind: 'segment', op: 'add', text })}
          />
        </DrawerSection>
        <DrawerSection
          title="Triggers"
          count={buyers.triggers.length}
          description="What makes them look for a fix. Each change saves at once."
          span={6}
        >
          <EditableRows
            label="Triggers"
            noun="trigger"
            rows={buyers.triggers.map((text) => ({ id: text, text }))}
            onEdit={(text, to) => onSend({ kind: 'trigger', op: 'rename', text, to })}
            onRemove={(text) => onSend({ kind: 'trigger', op: 'remove', text })}
            onAdd={(text) => onSend({ kind: 'trigger', op: 'add', text })}
          />
        </DrawerSection>
      </DrawerGrid>
    </Drawer>
  )
}
