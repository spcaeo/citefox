import { useEffect, useRef, useState, type JSX } from 'react'

/**
 * A one-line inline editor: Enter saves, Escape cancels, leaving the box saves
 * a changed value. An empty or unchanged value cancels.
 */
export function InlineInput({
  label,
  initial = '',
  placeholder,
  wide = false,
  onSave,
  onCancel
}: {
  label: string
  initial?: string
  placeholder?: string
  wide?: boolean
  onSave: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function finish(save: boolean): void {
    if (done.current) return
    done.current = true
    const next = value.trim()
    if (save && next.length > 0 && next !== initial.trim()) onSave(next)
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className={wide ? 'ui-input ed-input ed-input-wide' : 'ui-input ed-input'}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}
