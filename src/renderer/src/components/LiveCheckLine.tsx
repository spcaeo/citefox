import { useEffect, useState, type JSX } from 'react'
import type { LiveCheck } from '@shared/ipc'
import './liveCheckLine.css'
import { JUST_NOW_MS, liveCheckText } from './liveCheckText'

/**
 * One calm line while a check runs (owner, 2026-10-29): how many answers are in,
 * and that the numbers fill in as they arrive. "Checked just now" when it ends;
 * a stopped check says its answers come from a partial check. A screen that knows
 * which questions are being checked names them ("checking Q7, Q8, Q9 now"), each
 * a link to its row.
 */
export function LiveCheckLine({
  live,
  checkedAt,
  running = [],
  onPick,
  now: fixedNow
}: {
  live: LiveCheck | null | undefined
  /** The latest finished check, for "Checked just now". */
  checkedAt: string | null
  /** The questions being checked now ("Q7"), while the check runs. */
  running?: readonly { promptId: string; label: string }[]
  /** Shows that question's row. */
  onPick?: (promptId: string) => void
  /** Tests only. */
  now?: number
}): JSX.Element | null {
  const [clock, setClock] = useState(() => Date.now())
  const recent = live == null && checkedAt !== null && clock - Date.parse(checkedAt) < JUST_NOW_MS
  useEffect(() => {
    if (!recent || fixedNow !== undefined) return
    // Drop "Checked just now" once it is no longer true.
    const timer = setTimeout(() => setClock(Date.now()), JUST_NOW_MS)
    return () => clearTimeout(timer)
  }, [recent, fixedNow])
  const line = liveCheckText(live, checkedAt, fixedNow ?? clock)
  if (line === null) return null
  return (
    <p className="live-line" data-tone={line.tone} role="status">
      {line.tone === 'running' ? (
        <svg
          className="live-line-spin"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-9-9" />
        </svg>
      ) : null}
      {line.tone === 'running' && running.length > 0 ? (
        <span>
          {line.text.replace(/ · numbers update as answers come in$/u, '')} · checking{' '}
          {running.map((item, index) => (
            <span key={item.promptId}>
              {index > 0 ? ', ' : null}
              {onPick ? (
                <button
                  type="button"
                  className="live-line-pick"
                  aria-label={`Show ${item.label} in the list`}
                  onClick={() => onPick(item.promptId)}
                >
                  {item.label}
                </button>
              ) : (
                item.label
              )}
            </span>
          ))}{' '}
          now
        </span>
      ) : (
        line.text
      )}
    </p>
  )
}
