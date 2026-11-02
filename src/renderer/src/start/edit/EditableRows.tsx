import { useState, type JSX, type ReactNode } from 'react'
import { Button, RowMenu } from '../../ui'
import { InlineInput } from './InlineInput'
import './edit.css'

export interface EditableRow {
  id: string
  text: string
  /** Shown before the text: "Q1". */
  lead?: string
  /** Rendered instead of the plain text (a URL with copy and open). */
  content?: ReactNode
}

/**
 * Editable list rows (questions, triggers, picked pages): each row has a ⋯
 * menu with Edit (inline, when `onEdit` is set) and Remove; an Add button
 * opens an inline box (or `addSlot` renders a custom one).
 */
export function EditableRows({
  label,
  noun,
  rows,
  onEdit,
  onRemove,
  onAdd,
  addSlot,
  disabled = false
}: {
  label: string
  noun: string
  rows: readonly EditableRow[]
  onEdit?: (id: string, text: string) => void
  onRemove: (id: string) => void
  onAdd?: (text: string) => void
  /** A custom add control (a URL box). Replaces the inline box. */
  addSlot?: (close: () => void) => ReactNode
  disabled?: boolean
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const canAdd = !disabled && (onAdd !== undefined || addSlot !== undefined)

  return (
    <div className="ed-rows">
      <ul className="ed-list" aria-label={label}>
        {rows.map((row) => (
          <li key={row.id} className="ed-row">
            {row.lead ? <span className="sf-faint num ed-lead">{row.lead}</span> : null}
            {editing === row.id && onEdit ? (
              <InlineInput
                label={`Edit ${noun}`}
                initial={row.text}
                wide
                onSave={(text) => {
                  setEditing(null)
                  onEdit(row.id, text)
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <span className="ed-text">{row.content ?? row.text}</span>
            )}
            {disabled ? null : (
              <RowMenu
                label={`Edit ${noun}: ${row.text}`}
                width={200}
                items={[
                  ...(onEdit
                    ? [
                        {
                          id: 'edit',
                          label: 'Edit',
                          icon: 'pencil' as const,
                          onSelect: () => setEditing(row.id)
                        }
                      ]
                    : []),
                  {
                    id: 'remove',
                    label: 'Remove',
                    icon: 'trash' as const,
                    tone: 'danger' as const,
                    onSelect: () => onRemove(row.id)
                  }
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      {canAdd ? (
        adding ? (
          <div className="ed-add">
            {addSlot ? (
              addSlot(() => setAdding(false))
            ) : (
              <InlineInput
                label={`Add a ${noun}`}
                placeholder={`Add a ${noun}`}
                wide
                onSave={(text) => {
                  setAdding(false)
                  onAdd?.(text)
                }}
                onCancel={() => setAdding(false)}
              />
            )}
          </div>
        ) : (
          <div className="ed-add">
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
              Add a {noun}
            </Button>
          </div>
        )
      ) : null}
    </div>
  )
}
