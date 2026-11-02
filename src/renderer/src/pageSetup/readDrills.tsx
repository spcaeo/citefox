import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { DrillNumber } from '../drill'
import { promptItemsDrill } from './drills'
import type { PromptContext } from './readContext'
import './readDrills.css'

/**
 * Drill pieces shared by Page read and Buyer profile: the prompt and coverage
 * data they match against, a prompt count that opens its drawer, and a flag
 * that expands to explain itself.
 */

/**
 * "3 prompts" that opens the drawer of exactly those prompts. Draws nothing
 * when no prompt matches, or before the prompts load.
 */
export function PromptCount({
  context,
  id,
  title,
  description,
  ids,
  className
}: {
  context: PromptContext
  id: string
  title: string
  description: string
  ids: readonly string[]
  className?: string
}): JSX.Element | null {
  if (!context.prompts || ids.length === 0) return null
  const drill = promptItemsDrill({ id, title, description }, context.prompts, ids, context.scope)
  return (
    <DrillNumber
      drill={drill}
      className={className ? `ps-drill-count ${className}` : 'ps-drill-count'}
      suffix={ids.length === 1 ? ' question' : ' questions'}
      label={`${ids.length} ${ids.length === 1 ? 'question' : 'questions'}: ${title}`}
    />
  )
}

/**
 * A page-read flag that opens a short explanation in place, with the values
 * it compares side by side. A real button: Enter or Space toggles it, and
 * Escape inside the explanation closes it and returns focus to the flag.
 */
export function ReadFlag({
  ok,
  label,
  children
}: {
  ok: boolean
  label: string
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const button = useRef<HTMLButtonElement>(null)
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    button.current?.focus()
  }
  return (
    <span className="ps-flag-wrap" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={ok ? 'ps-flag ok ps-flag-btn' : 'ps-flag ps-flag-btn'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name={ok ? 'check' : 'warning'} />
        {label}
      </button>
      {open ? (
        <span className="ps-flag-detail" id={panelId} role="note">
          {children}
        </span>
      ) : null}
    </span>
  )
}

/** Two or more values side by side, for a flag's explanation. */
export function Compare({
  rows
}: {
  rows: readonly { label: string; value: string | null; mono?: boolean }[]
}): JSX.Element {
  return (
    <span className="ps-compare">
      {rows.map((row) => (
        <span key={row.label} className="ps-compare-row">
          <span className="ps-key">{row.label}</span>
          <span className={row.mono ? 'mono' : undefined}>{row.value ?? 'Not set'}</span>
        </span>
      ))}
    </span>
  )
}
