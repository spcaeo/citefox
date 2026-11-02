import type { JSX } from 'react'
import { CopyText } from '../ui'
import { formatDuration } from './model'
import type { ConsoleLive, ConsoleLiveRow } from './types'

/** How long the last finished item stays under the running ones. */
export const LAST_DONE_MS = 15_000

const ENGINE_MARK: Readonly<Record<ConsoleLiveRow['engines'][number]['state'], string>> = {
  waiting: '…',
  ok: '✓',
  cited: '✓ cited',
  failed: '×'
}

const ENGINE_SAID: Readonly<Record<ConsoleLiveRow['engines'][number]['state'], string>> = {
  waiting: 'still searching',
  ok: 'answered',
  cited: 'answered and cited you',
  failed: 'failed'
}

/**
 * The work running side by side under a job's stage line (owner, 2026-10-29: "if there
 * are three processes, why don't we show these three?"): what it is for, then one row
 * per running item, `Q9 · Problem "Our Zabbix server…" Google AI Overview ✓ · ChatGPT …
 * 12 s`, and the last one finished for a few seconds ("Q8 cited ✓"). The words can be
 * copied; the full text is in the tooltip.
 */
export function ConsoleLiveList({ live, now }: { live: ConsoleLive; now: number }): JSX.Element {
  const done =
    live.lastDone !== null && now - live.lastDone.at < LAST_DONE_MS ? live.lastDone : null
  return (
    <div className="wc-live" data-testid="wc-live">
      {live.purpose ? <p className="wc-line wc-dim wc-live-purpose">{live.purpose}</p> : null}
      {live.rows.length > 0 ? (
        <ul className="wc-live-rows" aria-label="Searching now">
          {live.rows.map((row) => (
            <li key={row.id} className="wc-live-row">
              <span className="wc-live-head">
                <span className="wc-mark wc-mark-running" aria-hidden="true">
                  ▸
                </span>
                <span className="wc-live-id">
                  {row.label}
                  {row.stage ? <span className="wc-dim"> · {row.stage}</span> : null}
                </span>
                <CopyText className="wc-live-text" text={row.text} label={`"${row.text}"`} />
              </span>
              <span className="wc-live-meta">
                {row.engines.map((engine, index) => (
                  <span key={engine.name}>
                    {index > 0 ? <span className="wc-dim"> · </span> : null}
                    {engine.name}{' '}
                    <span className={`wc-live-engine-${engine.state}`} aria-hidden="true">
                      {ENGINE_MARK[engine.state]}
                    </span>
                    <span className="sr-only">{ENGINE_SAID[engine.state]}</span>
                  </span>
                ))}
                <span className="wc-dim num"> · {formatDuration(now - row.startedAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {done ? (
        <p className="wc-line wc-step" key={done.id}>
          {'  '}
          <span
            className={`wc-mark ${done.cited ? 'wc-mark-ok' : 'wc-mark-skipped'}`}
            aria-hidden="true"
          >
            {done.cited ? '✓' : '–'}
          </span>{' '}
          {done.label} {done.cited ? 'cited' : done.cited === false ? 'not cited' : 'no answer'}
        </p>
      ) : null}
    </div>
  )
}
