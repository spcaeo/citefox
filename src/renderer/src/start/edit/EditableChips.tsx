import { useState, type JSX } from 'react'
import { Button, Chip, RowMenu, type MenuItem } from '../../ui'
import { InlineInput } from './InlineInput'
import './edit.css'

export interface MoveTarget {
  id: string
  label: string
}

/**
 * Editable chips (competitors, segments): each chip has a ⋯ menu with Rename
 * (inline), Move to another group (rivals), and Remove; an Add button opens an
 * inline box. Nothing changes here; the caller sends the edit.
 */
export function EditableChips({
  label,
  noun,
  items,
  blue = false,
  moveTargets = [],
  onRename,
  onRemove,
  onAdd,
  onMove,
  disabled = false
}: {
  /** The group, for names: "Competitors". */
  label: string
  /** One item, for menus: "competitor". */
  noun: string
  items: readonly string[]
  blue?: boolean
  moveTargets?: readonly MoveTarget[]
  onRename: (from: string, to: string) => void
  onRemove: (name: string) => void
  onAdd: (name: string) => void
  onMove?: (name: string, targetId: string) => void
  disabled?: boolean
}): JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="ed-chips">
      <span className="ed-chips-list" role="list" aria-label={label}>
        {items.map((item) =>
          renaming === item ? (
            <span role="listitem" key={item}>
              <InlineInput
                label={`Rename ${noun} ${item}`}
                initial={item}
                onSave={(to) => {
                  setRenaming(null)
                  onRename(item, to)
                }}
                onCancel={() => setRenaming(null)}
              />
            </span>
          ) : (
            <span role="listitem" key={item} className="ed-chip-item">
              <Chip tone={blue ? 'info' : 'neutral'} className="ed-chip">
                <span>{item}</span>
                {disabled ? null : (
                  <RowMenu label={`Edit ${noun} ${item}`} width={220} items={menuFor(item)} />
                )}
              </Chip>
            </span>
          )
        )}
      </span>
      {disabled ? null : adding ? (
        <InlineInput
          label={`Add a ${noun}`}
          placeholder={`Add a ${noun}`}
          onSave={(name) => {
            setAdding(false)
            onAdd(name)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
          <span className="sr-only">
            Add a {noun} to {label}
          </span>
          <span aria-hidden="true">Add</span>
        </Button>
      )}
    </div>
  )

  function menuFor(item: string): MenuItem[] {
    const menu: MenuItem[] = [
      { id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => setRenaming(item) }
    ]
    for (const target of moveTargets) {
      menu.push({
        id: `move-${target.id}`,
        label: `Move to ${target.label}`,
        icon: 'arrow-right',
        onSelect: () => onMove?.(item, target.id)
      })
    }
    menu.push({
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      tone: 'danger',
      onSelect: () => onRemove(item)
    })
    return menu
  }
}
