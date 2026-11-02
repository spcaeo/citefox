import type { JSX, ReactNode } from 'react'
import { busyTiming, SLOW_TEXT, type BusyState, type UsualRange } from './busyModel'
import { UiIcon } from './UiIcon'
import { useBusyAnnounce, useElapsed } from './useBusy'

/**
 * The one "working" look of CiteFox (owner, 2026-10-25: "a really good blinker
 * or process indicator"). Pieces, used together or alone:
 *
 *   BusyMark  - the row's mark: a spinning ring while it works, a hollow circle
 *               while it waits its turn, ✓ when done (also ✕, ⚠ and a dash).
 *   BusyLine  - "Waiting for Claude's reply · 4 s · usually 5–10 s", and after
 *               twice the usual time a calm "Taking longer than usual…" line.
 *   BusyBar   - a thin moving bar along the top edge of the card that works.
 *   Button `busy` - a spinner and a busy label; it cannot be pressed twice.
 *
 * With reduced motion the ring and the bar pulse slowly instead of moving.
 * Timers are aria-hidden; the start, the end and "taking longer" are each said
 * once through a polite live region.
 */

const STATE_ICON = {
  done: 'check',
  failed: 'x',
  warning: 'warning'
} as const

export function BusyMark({
  state,
  size = 'md',
  label
}: {
  state: BusyState
  /** `md` 20px (rows), `sm` 16px (status lines and compact lists). */
  size?: 'md' | 'sm'
  /** Names the mark for screen readers when nothing else says the state. */
  label?: string
}): JSX.Element {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <span
      className={`ui-progress-icon ui-busy-mark is-${state}${size === 'sm' ? ' is-sm' : ''}`}
      data-state={state}
      {...a11y}
    >
      {state === 'done' || state === 'failed' || state === 'warning' ? (
        <UiIcon name={STATE_ICON[state]} size={12} />
      ) : null}
      {state === 'skipped' ? <span className="dash" /> : null}
    </span>
  )
}

/** The thin moving bar along the top edge of a working card (the card is `position: relative`). */
export function BusyBar({ active }: { active: boolean }): JSX.Element | null {
  return active ? <span className="ui-busy-bar" aria-hidden="true" data-testid="busy-bar" /> : null
}

export interface BusyLineProps {
  /** True while the job runs. Keep the line rendered: it says the end when this turns false. */
  active: boolean
  /** Plain words for what runs now, such as "Waiting for Claude's reply". */
  label: string
  /** How long it usually takes, in seconds. Shows "usually 5–10 s" and drives the slow line. */
  usual?: UsualRange | null
  /** False when the caller draws the spinning mark elsewhere (a row's status column). */
  mark?: boolean
  /** A muted line after the time, such as "You can keep working". */
  note?: string
  /** Offered beside "Taking longer than usual…", such as a Cancel or a ChatGPT way out. */
  slowAction?: ReactNode
  /** Said once when the job ends. Leave out when the result is announced elsewhere. */
  end?: string
  /** Where the start, end and slow words are said. Default the kit's polite live region; false says nothing. */
  announce?: ((message: string) => void) | false
  className?: string
}

/**
 * A live busy line: spinner, the plain words, "4 s · usually 5–10 s", and after
 * twice the usual time "Taking longer than usual…" with an optional action.
 * Renders nothing while `active` is false.
 */
export function BusyLine({
  active,
  label,
  usual = null,
  mark = true,
  note,
  slowAction,
  end,
  announce,
  className
}: BusyLineProps): JSX.Element | null {
  const timing = busyTiming(useElapsed(active), usual)
  useBusyAnnounce(active && announce !== false, timing.slow, {
    start: /[….!?]$/.test(label) ? label : `${label}…`,
    ...(end ? { end } : {}),
    slow: SLOW_TEXT,
    ...(announce ? { announce } : {})
  })
  if (!active) return null
  return (
    <div
      className={className ? `ui-busy ${className}` : 'ui-busy'}
      data-slow={timing.slow || undefined}
    >
      <p className="ui-busy-line">
        {mark ? <BusyMark state="running" size="sm" /> : null}
        <span className="ui-busy-label">{label}</span>
        <span className="ui-busy-time num" aria-hidden="true">
          · {timing.text}
        </span>
        {note ? <span className="ui-busy-note">· {note}</span> : null}
      </p>
      {timing.slow ? (
        <p className="ui-busy-slow">
          <span>{SLOW_TEXT}</span>
          {slowAction}
        </p>
      ) : null}
    </div>
  )
}
