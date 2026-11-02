import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react'
import type { SetupItem } from '@shared/ipc'
import { Button, IconButton } from '../../ui'
import type { ItemPatch } from './merge'
import type { RowBadge } from './rowView'
import type { RowField } from './types'

/** One row of a list card: tick, name and its second line, a tag, ✎ and ✕. */
export function ListRow({
  item,
  sub,
  badge,
  onToggle,
  onEdit,
  onRemove
}: {
  item: SetupItem
  sub: ReactNode
  badge: RowBadge | null
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <li
      className={`osc-item${item.fresh ? ' osc-item-new' : ''}${item.kept ? '' : ' osc-item-off'}`}
      data-testid="section-row"
      data-item-id={item.id}
    >
      <input
        type="checkbox"
        className="osc-check"
        checked={item.kept}
        aria-label={`Keep ${item.name}`}
        onChange={onToggle}
      />
      <div className="osc-item-main">
        <span className="osc-item-name">{item.name}</span>
        {sub ? <span className="osc-item-sub">{sub}</span> : null}
      </div>
      {badge ? (
        <span className={`osc-tag osc-tag-${badge.tone}`} data-testid="row-tag">
          {badge.text}
        </span>
      ) : (
        <span />
      )}
      <IconButton icon="pencil" size="sm" label={`Edit ${item.name}`} onClick={onEdit} />
      <IconButton icon="x" size="sm" label={`Remove ${item.name}`} onClick={onRemove} />
    </li>
  )
}

/** ✎ Edit in place: the row's fields with Save and Cancel, no dialog (mock-up panel 4). */
export function RowEditor({
  item,
  fields,
  onSave,
  onCancel,
  onToggle
}: {
  item: SetupItem
  fields: readonly RowField[]
  onSave: (patch: ItemPatch) => void
  onCancel: () => void
  onToggle: () => void
}): JSX.Element {
  const [values, setValues] = useState<Record<RowField['key'], string>>({
    name: item.name,
    detail: item.detail,
    url: item.url ?? '',
    tag: item.tag ?? ''
  })
  const firstRef = useRef<HTMLInputElement | null>(null)
  const baseId = useId()

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true })
  }, [])

  const canSave = values.name.trim().length > 0

  function save(): void {
    if (!canSave) return
    const patch: ItemPatch = {}
    for (const field of fields) {
      const value = values[field.key].trim()
      if (field.key === 'name') patch.name = value
      else if (field.key === 'detail') patch.detail = value
      else if (field.key === 'url') patch.url = value.length > 0 ? value : null
      else patch.tag = value.length > 0 ? value : null
    }
    onSave(patch)
  }

  return (
    <li className="osc-item osc-item-edit" data-testid="section-row-edit" data-item-id={item.id}>
      <input
        type="checkbox"
        className="osc-check"
        checked={item.kept}
        aria-label={`Keep ${item.name}`}
        onChange={onToggle}
      />
      <div
        className="osc-edit-fields"
        role="group"
        aria-label={`Edit ${item.name}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            save()
          }
        }}
      >
        {fields.map((field, index) => {
          const id = `${baseId}-${field.key}`
          return (
            <label key={field.key} className="osc-edit-field" htmlFor={id}>
              <span className="sr-only">{field.label}</span>
              {field.options ? (
                <select
                  id={id}
                  className="ui-input ui-input-sm"
                  value={values[field.key]}
                  onChange={(event) =>
                    setValues((now) => ({ ...now, [field.key]: event.target.value }))
                  }
                >
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  ref={index === 0 ? firstRef : undefined}
                  id={id}
                  className={`ui-input ui-input-sm${field.mono ? ' osc-mono' : ''}`}
                  value={values[field.key]}
                  placeholder={field.placeholder ?? field.label}
                  aria-invalid={field.key === 'name' && !canSave ? true : undefined}
                  onChange={(event) =>
                    setValues((now) => ({ ...now, [field.key]: event.target.value }))
                  }
                />
              )}
            </label>
          )
        })}
      </div>
      <div className="osc-edit-actions">
        <Button variant="primary" size="sm" disabled={!canSave} onClick={save}>
          Save
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </li>
  )
}

/** + Add: an inline box at the end of the list. */
export function AddRow({
  placeholder,
  mono,
  label,
  onAdd
}: {
  placeholder: string
  mono?: boolean
  /** "Add a product". */
  label: string
  /** Returns an error line, or null when it was added. */
  onAdd: (text: string) => string | null
}): JSX.Element {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const id = useId()

  function add(): void {
    if (text.trim().length === 0) return
    const error = onAdd(text)
    setProblem(error)
    if (error === null) setText('')
  }

  return (
    <div className="osc-add">
      <div className="osc-row">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          className={`ui-input osc-grow${mono ? ' osc-mono' : ''}`}
          value={text}
          placeholder={placeholder}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => {
            setText(event.target.value)
            setProblem(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button size="sm" disabled={text.trim().length === 0} onClick={add}>
          Add
        </Button>
      </div>
      {problem ? (
        <p className="osc-hint osc-warn" id={`${id}-problem`} role="status">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
