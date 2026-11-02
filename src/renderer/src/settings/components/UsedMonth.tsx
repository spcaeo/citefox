import type { JSX } from 'react'
import type { ApiKeyMetadata } from '@shared/domain'
import { DrillButton } from '../../drill'
import {
  CITEFOX_USED_LABEL,
  formatCount,
  planLine,
  serpKeysDrill,
  serpUsageSummary,
  usageLabel,
  usageNoun
} from '../../keys/serpUsage'

/**
 * "Used this month" over every counted SerpApi key, the same rule as Status
 * and the status popover. It opens the keys; their Used column adds up to it.
 */
export function UsedMonth({ keys }: { keys: readonly ApiKeyMetadata[] }): JSX.Element {
  const summary = serpUsageSummary(keys)
  const label = summary
    ? `${formatCount(summary.used)} of ${formatCount(summary.limit)}`
    : 'No usage yet'
  const width =
    summary && summary.limit > 0
      ? Math.min(100, Math.round((summary.used / summary.limit) * 100))
      : 0
  return (
    <div className="field">
      <span className="field-label">{summary ? usageLabel(summary) : CITEFOX_USED_LABEL}</span>
      <div className="usage">
        <div className="bar" role="img" aria-label={label}>
          <span style={{ width: `${width}%` }} />
        </div>
        {summary ? (
          <DrillButton
            drill={serpKeysDrill(keys, { id: 'settings:serp-used', title: 'Used this month' })}
            className="drill-num mono"
            label={`${label} ${usageNoun(summary)}: show each key`}
            untracked
          >
            {label}
          </DrillButton>
        ) : (
          <span className="mono">{label}</span>
        )}
      </div>
      {summary && planLine(summary) ? <p className="hint">{planLine(summary)}</p> : null}
      {summary && summary.keys > 1 ? (
        <p className="hint">
          {summary.counted === summary.keys
            ? `All ${summary.keys} SerpApi keys`
            : `${summary.counted} of ${summary.keys} SerpApi keys (the others are off, untested or have no limit)`}
          · {formatCount(summary.left)} left
        </p>
      ) : null}
    </div>
  )
}
