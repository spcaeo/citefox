import type { JSX } from 'react'
import type { ConnectionActivity, ConnectionActivityLog } from '@shared/domain'
import { Icon } from '../../components/Icon'
import { KpiStrip, KpiTile } from '../../ui'
import { DrillButton, DrillNumber } from '../../drill'
import { activityDrill, latestEventDrill, type ActivityCountKind } from '../utils/drills'
import { activityCount } from '../utils/model'

const COUNTS: readonly {
  kind: ActivityCountKind
  field: 'searches' | 'claudeCalls' | 'jinaReads'
  words: string
  title: string
}[] = [
  {
    kind: 'search',
    field: 'searches',
    words: 'SerpApi searches',
    title: 'SerpApi searches · 24 h'
  },
  {
    kind: 'claude_call',
    field: 'claudeCalls',
    words: 'Claude calls',
    title: 'Claude calls · 24 h'
  },
  { kind: 'jina_read', field: 'jinaReads', words: 'Jina reads', title: 'Jina reads · 24 h' }
]

/**
 * FR-11.10. Counts for the last 24 hours and the latest failover in plain words.
 * With the activity log, each count opens the calls behind it and the
 * failover sentence opens the events it tells.
 */
export function ActivityStrip({
  activity,
  log = null,
  error,
  activeProjectId = null,
  onShowKey
}: {
  activity: ConnectionActivity | null
  log?: ConnectionActivityLog | null
  error: string | null
  activeProjectId?: string | null
  /** Moves focus to a key's row and opens it. */
  onShowKey?: (keyId: string) => void
}): JSX.Element {
  const latest = log?.latestEvents[0] ?? null
  const sentence = activity?.latestEvent?.sentence ?? null
  return (
    <section className="conn-activity" aria-label="Last 24 hours">
      <KpiStrip className="conn-kpis">
        {COUNTS.map((item) => (
          <KpiTile
            key={item.kind}
            label={item.title}
            value={
              log ? (
                <DrillNumber
                  drill={activityDrill(log, item.kind, activeProjectId)}
                  label={`${activityCount(log[item.field])} ${item.words} in the last 24 hours`}
                />
              ) : (
                <span>{activity ? activityCount(activity[item.field]) : '—'}</span>
              )
            }
          />
        ))}
      </KpiStrip>
      <div className="note conn-activity-note" role="status" aria-live="polite">
        <Icon name="activity" size="nav" />
        <p className="muted">
          {error ? (
            `Could not read the last 24 hours. ${error}`
          ) : activity === null ? (
            'Reading the last 24 hours…'
          ) : sentence === null ? (
            'No failovers in the last 24 hours.'
          ) : log && log.latestEvents.length > 0 ? (
            <>
              <DrillButton drill={latestEventDrill(log)} untracked>
                {sentence}
              </DrillButton>
              {latest?.keyId && onShowKey ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="m3-link"
                    onClick={() => onShowKey(latest.keyId ?? '')}
                  >
                    Show {latest.keyName ?? 'the key'}
                  </button>
                </>
              ) : null}
            </>
          ) : (
            sentence
          )}
        </p>
      </div>
    </section>
  )
}
