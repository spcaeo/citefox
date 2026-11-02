import { useId, type JSX } from 'react'
import type { LlmUsage } from '@shared/ipc'
import { formatClock, formatDay } from '../utils/dates'
import type { UsageClient } from './client'
import {
  callStep,
  connectionLabel,
  formatSeconds,
  formatTokens,
  plural,
  stepLabel,
  usageSummary
} from './model'
import { UsageDetail } from './UsageDetail'
import { useLlmUsage } from './useLlmUsage'

/**
 * Claude usage from the call log (FR-25.6): calls today, tokens this month, and
 * the split by connection and by step, with the latest failures. Prompts and
 * replies are never logged, so none are shown.
 */
export function ClaudeUsage({
  client,
  projectId,
  refreshKey,
  card = true,
  variant = 'compact'
}: {
  client?: UsageClient
  /** Omit for every project plus calls outside projects. */
  projectId?: string
  refreshKey?: number | string
  /** False drops the card frame, for use inside another card. */
  card?: boolean
  /** `full`: KPI tiles and list grids (Connections). `compact`: lines for a side card (Status). */
  variant?: 'compact' | 'full'
}): JSX.Element {
  const headingId = useId()
  const { usage, error, loading } = useLlmUsage({
    ...(client ? { client } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(refreshKey !== undefined ? { refreshKey } : {})
  })
  return (
    <section
      className={[card ? 'card cu-card' : 'cu-card', variant === 'full' ? 'cu-full' : '']
        .filter(Boolean)
        .join(' ')}
      aria-labelledby={headingId}
    >
      {/* Not "Claude usage": the card sits under a "Claude" heading, and a second name with that word makes the section ambiguous. */}
      <h3 id={headingId} className="cu-title">
        Calls and tokens
      </h3>
      {error ? (
        <p className="field-error" role="alert">
          Could not read CiteFox AI usage. {error}
        </p>
      ) : usage ? (
        variant === 'full' ? (
          <UsageDetail usage={usage} idBase={headingId} />
        ) : (
          <UsageBody usage={usage} />
        )
      ) : loading ? (
        <p className="faint" role="status">
          Reading CiteFox AI usage…
        </p>
      ) : null}
    </section>
  )
}

function UsageBody({ usage }: { usage: LlmUsage }): JSX.Element {
  return (
    <>
      <p className="cu-summary">
        <span>{usageSummary(usage)}</span>
        {usage.failedToday > 0 ? (
          <span className="cu-failed"> · {usage.failedToday} failed today</span>
        ) : null}
      </p>
      {usage.callsThisMonth === 0 ? (
        <p className="hint">No CiteFox AI calls this month yet.</p>
      ) : (
        <>
          <div className="cu-block">
            <h4 className="cu-sub">By connection</h4>
            <ul className="cu-list">
              {usage.byConnection.map((entry) => (
                <li key={entry.connection} className="cu-row">
                  <span>{connectionLabel(entry.connection)}</span>
                  <span className="mono faint">
                    {plural(entry.calls, 'call', 'calls')} · {formatTokens(entry.tokensIn)} in /{' '}
                    {formatTokens(entry.tokensOut)} out
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {usage.byStep.length > 0 ? (
            <details className="cu-block">
              <summary className="cu-sub">By step ({usage.byStep.length})</summary>
              <ul className="cu-list">
                {usage.byStep.map((entry) => (
                  <li key={entry.step} className="cu-row">
                    <span>{stepLabel(entry.step)}</span>
                    <span className="mono faint">
                      {plural(entry.calls, 'call', 'calls')}
                      {entry.failed > 0 ? ` · ${entry.failed} failed` : ''} · about{' '}
                      {formatSeconds(entry.averageDurationMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <div className="cu-block">
        <h4 className="cu-sub">Recent errors</h4>
        {usage.recentErrors.length === 0 ? (
          <p className="faint">No errors</p>
        ) : (
          <ul className="cu-list">
            {usage.recentErrors.map((entry) => (
              <li key={entry.id} className="cu-error">
                <span className="mono faint">
                  {formatDay(entry.startedAt, { year: false })} · {formatClock(entry.startedAt)}
                </span>
                <span className="tag">{stepLabel(callStep(entry))}</span>
                <span className="muted">{entry.error ?? 'Failed'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
