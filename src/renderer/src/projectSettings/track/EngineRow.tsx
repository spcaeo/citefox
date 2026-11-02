import { useId, type JSX } from 'react'
import type { SearchProvider } from '@shared/domain'
import type { EngineCounts, EngineOption } from '@shared/ipc'
import { EngineLogo } from '../../engines/EngineLogo'
import { Chip, type ChipTone } from '../../ui'
import { ENGINE_NOTES, engineState, type EngineState } from './model'

const CHIP: Readonly<Record<EngineState, { label: string; tone: ChipTone }>> = {
  on: { label: 'On', tone: 'ok' },
  off: { label: 'Off', tone: 'neutral' },
  'needs-cloro': { label: 'Needs a key', tone: 'warn' },
  unavailable: { label: 'Unavailable', tone: 'warn' }
}

/**
 * One engine in "What to track" (and a topic's own engines): its box, logo, name, one
 * line, the price of one question in one market, and a chip. An engine that needs a
 * cloro key the project lacks cannot be ticked; one that was ticked before the key went
 * can still be unticked.
 */
export function EngineRow({
  option,
  picked,
  provider,
  counts,
  needId,
  disabled = false,
  onToggle
}: {
  option: EngineOption
  picked: boolean
  provider: SearchProvider
  counts?: EngineCounts | undefined
  /** The "needs a cloro key" note the row points to. */
  needId?: string | undefined
  disabled?: boolean
  onToggle: (on: boolean) => void
}): JSX.Element {
  const id = useId()
  const meta = ENGINE_NOTES[option.id]
  const state = engineState(option, picked, counts)
  const chip = CHIP[state]
  const note =
    state === 'needs-cloro'
      ? 'Needs a search key that checks every engine'
      : state === 'unavailable'
        ? 'Paused by the search service at the last check; resumes on its own'
        : meta.note
  const price =
    option.id === 'google_aio' && provider === 'serpapi'
      ? '1–2 searches'
      : `${option.credits} credits`
  const describedBy = [`${id}-note`, state === 'needs-cloro' ? needId : undefined]
    .filter(Boolean)
    .join(' ')
  return (
    <li className={`et-row${state === 'needs-cloro' ? ' off' : ''}`}>
      <input
        id={id}
        type="checkbox"
        className="et-check"
        checked={picked}
        disabled={disabled || (!option.runnable && !picked)}
        aria-describedby={describedBy}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <label htmlFor={id} className="et-row-main">
        <EngineLogo engine={option.id} size={24} className="et-logo" />
        <span className="et-row-text">
          <span className="et-name">{option.label}</span>
          <span className="et-note" id={`${id}-note`}>
            {note}
          </span>
        </span>
      </label>
      <span className="et-price num">{price}</span>
      <span className="et-chip">
        <Chip size="sm" tone={chip.tone}>
          {chip.label}
        </Chip>
      </span>
    </li>
  )
}
