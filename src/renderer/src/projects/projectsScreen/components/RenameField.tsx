import { useEffect, useRef, useState, type JSX } from 'react'

/**
 * The project name as a field while renaming in the list: Enter saves, Escape
 * keeps the old name. Keys and clicks stay in the field, so the grid does not
 * open the project.
 */
export function RenameField({
  name,
  onSave,
  onCancel
}: {
  name: string
  onSave: (name: string) => Promise<boolean>
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // After the row menu hands focus back to its button.
    const timer = window.setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function save(): Promise<void> {
    const next = value.trim()
    if (next === '') return
    if (next === name) {
      onCancel()
      return
    }
    setBusy(true)
    const saved = await onSave(next)
    setBusy(false)
    if (!saved) ref.current?.focus()
  }

  return (
    <input
      ref={ref}
      className="ui-input ui-input-sm pj-rename"
      aria-label={`New name for ${name}`}
      aria-describedby="pj-rename-hint"
      value={value}
      maxLength={80}
      disabled={busy}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          void save()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

/** Read once by every rename field. */
export function RenameHint(): JSX.Element {
  return (
    <span id="pj-rename-hint" className="sr-only">
      Enter saves the name. Escape keeps the old one.
    </span>
  )
}
