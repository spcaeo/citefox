import { useRef, useState, type JSX } from 'react'

export interface InlineInputProps {
  label: string
  initial: string
  placeholder?: string
  className?: string
  /** Saves the trimmed text. True when it saved (the box closes). */
  onSave: (text: string) => Promise<boolean>
  /** Closes the box: after a save, Esc, or leaving it unchanged. */
  onDone: () => void
}

/**
 * A one-line box typed in place: Enter (or leaving the box) saves, Esc
 * cancels. Keys stay here so the grid around it does not move focus.
 */
export function InlineInput({
  label,
  initial,
  placeholder,
  className,
  onSave,
  onDone
}: InlineInputProps): JSX.Element {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  // Enter then blur, or Esc then blur, must act once.
  const settled = useRef(false)

  async function commit(): Promise<void> {
    if (settled.current) return
    const value = text.trim()
    settled.current = true
    if (value.length === 0 || value === initial.trim()) {
      onDone()
      return
    }
    setBusy(true)
    if (await onSave(value)) {
      onDone()
      return
    }
    settled.current = false
    setBusy(false)
  }

  return (
    <input
      className={['ui-input', 'au-inline-input', className].filter(Boolean).join(' ')}
      aria-label={label}
      aria-busy={busy || undefined}
      placeholder={placeholder}
      value={text}
      readOnly={busy}
      // The box opens because the person asked for it, so it takes focus.
      autoFocus
      onChange={(event) => setText(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          settled.current = true
          onDone()
        }
      }}
      onBlur={() => void commit()}
    />
  )
}
