import { useEffect, useId, useRef, useState, type JSX } from 'react'
import type { SetupListId } from '@shared/ipc'
import { Button, IconButton } from '../../ui'
import { withList } from './draftOps'
import { itemsFromNames } from './merge'
import type { SectionEnv } from './types'
import { useSectionUrl } from './useSectionUrl'

/**
 * A small editable line under the competitors card (mock-up panel 6): "They
 * switch from (not rivals): AT&T, Verizon ✎". ✎ opens it in place as a comma
 * list with Save and Cancel; the open state is `edit=<list>.line` in the URL.
 */
export function NameLine({
  env,
  list,
  label,
  note,
  placeholder
}: {
  env: SectionEnv
  list: SetupListId
  /** "They switch from". */
  label: string
  /** "(not rivals)". */
  note: string
  placeholder: string
}): JSX.Element {
  const url = useSectionUrl(list)
  const key = `${list}.line`
  const editing = url.editId === key
  const items = env.draft.lists[list].filter((item) => item.kept)
  const names = items.map((item) => item.name)
  const id = useId()

  return (
    <div className="osc-line" data-testid={`line-${list}`}>
      {editing ? (
        <LineEditor
          id={id}
          label={label}
          initial={names.join(', ')}
          placeholder={placeholder}
          onSave={(text) => {
            const next = text.split(',').map((part) => part.trim())
            env.onDraft((draft) => withList(draft, list, (now) => itemsFromNames(now, next)))
            url.stopEdit()
          }}
          onCancel={url.stopEdit}
        />
      ) : (
        <p className="osc-hint osc-line-text">
          <b>{label}</b> {note}:{' '}
          {names.length > 0 ? names.join(', ') : <span className="osc-placeholder">none yet</span>}
          <span className="osc-line-edit">
            <IconButton
              icon="pencil"
              size="sm"
              label={`Edit ${label}`}
              onClick={() => url.startEdit(key)}
            />
          </span>
        </p>
      )}
    </div>
  )
}

function LineEditor({
  id,
  label,
  initial,
  placeholder,
  onSave,
  onCancel
}: {
  id: string
  label: string
  initial: string
  placeholder: string
  onSave: (text: string) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="osc-row">
      <label htmlFor={id} className="osc-line-label">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        className="ui-input ui-input-sm osc-grow"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSave(text)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <Button variant="primary" size="sm" onClick={() => onSave(text)}>
        Save
      </Button>
      <Button size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
