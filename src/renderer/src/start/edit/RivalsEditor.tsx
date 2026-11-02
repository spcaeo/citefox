import type { JSX } from 'react'
import type { StartEdit, StartRival, StartRivalKind } from '@shared/ipc'
import { EditableChips } from './EditableChips'
import './edit.css'

const GROUPS: readonly { kind: StartRivalKind; label: string; noun: string; note?: string }[] = [
  { kind: 'competitor', label: 'Competitors', noun: 'competitor' },
  {
    kind: 'switch_from',
    label: 'Buyers switch from',
    noun: 'option buyers switch from',
    note: 'options they leave, not rivals'
  },
  { kind: 'partner', label: 'Partners', noun: 'partner', note: 'integrations' }
]

/**
 * Competitors, options buyers switch from, and partners, each group editable:
 * rename, move to another group, remove, add. Every change is one edit.
 */
export function RivalsEditor({
  rivals,
  onSend,
  layout = 'groups',
  disabled = false
}: {
  rivals: readonly StartRival[]
  onSend: (edit: StartEdit) => void
  /** `groups`: titled blocks (What we found). `facts`: label column rows (What we know). */
  layout?: 'groups' | 'facts'
  disabled?: boolean
}): JSX.Element {
  return (
    <div className={layout === 'facts' ? 'ed-rivals ed-rivals-facts' : 'ed-rivals'}>
      {GROUPS.map((group) => {
        const names = rivals.filter((rival) => rival.kind === group.kind).map((rival) => rival.name)
        return (
          <div className={layout === 'facts' ? 'ed-fact' : 'fd-rivals'} key={group.kind}>
            <p className={layout === 'facts' ? 'ed-fact-label' : 'fd-rivals-title'}>
              {layout === 'facts' && group.kind === 'switch_from' ? 'Switch from' : group.label}
              {layout === 'groups' && group.note ? (
                <span className="sf-faint"> · {group.note}</span>
              ) : null}
            </p>
            <EditableChips
              label={group.label}
              noun={group.noun}
              items={names}
              blue={group.kind === 'switch_from'}
              disabled={disabled}
              moveTargets={GROUPS.filter((other) => other.kind !== group.kind).map((other) => ({
                id: other.kind,
                label: other.label
              }))}
              onRename={(name, to) => onSend({ kind: 'rival', op: 'rename', name, to })}
              onRemove={(name) => onSend({ kind: 'rival', op: 'remove', name })}
              onAdd={(name) => onSend({ kind: 'rival', op: 'add', name, rivalKind: group.kind })}
              onMove={(name, target) =>
                onSend({ kind: 'rival', op: 'move', name, rivalKind: target as StartRivalKind })
              }
            />
          </div>
        )
      })}
    </div>
  )
}
