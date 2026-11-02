import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Chip } from '../../../ui'

/** How long a click waits to tell a single click (open) from a double click (rename). */
export const DOUBLE_CLICK_MS = 260

/**
 * The topic's name, which renames in place: double-click it (or Rename in the
 * row menu) for a field; Enter saves, Escape cancels, leaving the field saves.
 * A single click still opens the topic. A paused topic shows "Paused".
 */
export function TopicNameCell({
  name,
  meta,
  paused,
  editing,
  onEdit,
  onOpen,
  onSave,
  onCancel
}: {
  name: string
  /** "From a buyer problem · every 14 days · checked Oct 19". Null leaves the line out. */
  meta: string | null
  paused: boolean
  editing: boolean
  onEdit: () => void
  onOpen: () => void
  /** Resolves when saved; rejects with the reason to keep the field open. */
  onSave: (name: string) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const timer = useRef<number | null>(null)

  // Each time the field opens it starts from the current name.
  const [opened, setOpened] = useState(false)
  if (opened !== editing) {
    setOpened(editing)
    if (editing) {
      setValue(name)
      setError(null)
    }
  }

  useEffect(() => {
    if (!editing) return
    input.current?.focus()
    input.current?.select()
  }, [editing])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  async function commit(): Promise<void> {
    if (saving) return
    const next = value.trim().replace(/\s+/gu, ' ')
    if (next === name) {
      onCancel()
      return
    }
    if (next.length === 0) {
      setError('Give the topic a name.')
      return
    }
    setSaving(true)
    try {
      await onSave(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename the topic.')
    } finally {
      setSaving(false)
    }
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    // Keep the grid's own keys (Enter opens the row, Space ticks it) out of the field.
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  if (editing) {
    return (
      <span className="tl-topic tl-topic-editing" data-no-row-open="">
        <input
          ref={input}
          className="ui-input ui-input-sm tl-rename"
          aria-label={`Rename ${name}`}
          aria-invalid={error !== null || undefined}
          value={value}
          maxLength={120}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKey}
          onBlur={() => void commit()}
        />
        {error ? (
          <span className="tl-rename-error" role="alert">
            {error}
          </span>
        ) : (
          <span className="tl-topic-origin">Enter saves · Esc cancels</span>
        )}
      </span>
    )
  }

  return (
    <span className="tl-topic">
      <span className="tl-topic-line">
        <span
          className="tl-topic-name"
          title={`${name} (double-click to rename)`}
          data-no-row-open=""
          onClick={() => {
            if (timer.current !== null) return
            timer.current = window.setTimeout(() => {
              timer.current = null
              onOpen()
            }, DOUBLE_CLICK_MS)
          }}
          onDoubleClick={() => {
            if (timer.current !== null) window.clearTimeout(timer.current)
            timer.current = null
            onEdit()
          }}
        >
          {name}
        </span>
        {paused ? (
          <Chip tone="warn" size="sm">
            Paused
          </Chip>
        ) : null}
      </span>
      {meta === null ? null : <span className="tl-topic-origin">{meta}</span>}
    </span>
  )
}
