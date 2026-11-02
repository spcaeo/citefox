import type { JSX } from 'react'
import type { HistoryEvent } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { DrillLink } from '../drill'
import { KpiStrip, KpiTile, type KpiTrend } from '../ui'
import { checkTarget, type HistoryDrillContext } from './historyDrills'
import { changeText, fullDay, newestFirst, scoreText, type KindFilter } from './model'

/**
 * History's KPI row: the latest check's score (opens its results) and how many
 * checks, content changes and notes the page has. A count shows those events.
 */
export function HistoryKpis({
  events,
  counts,
  context,
  onKind
}: {
  events: readonly HistoryEvent[]
  counts: Readonly<Record<KindFilter, number>>
  context: HistoryDrillContext
  onKind: (kind: KindFilter) => void
}): JSX.Element {
  const latest = newestFirst(events).find((event) => event.check !== null) ?? null
  const check = latest?.check ?? null
  const change = check && !check.partial ? check.scoreChange : null
  const trend: KpiTrend | undefined =
    change === null
      ? undefined
      : {
          direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
          text: `${changeText(change)} vs previous`
        }

  return (
    <KpiStrip className="hist-kpis">
      <KpiTile
        label="Latest score"
        value={
          check && latest ? (
            <DrillLink
              target={checkTarget(context, check)}
              className="hist-kpi-link"
              label={`Latest check, ${scoreText(check.score)}: open its results (${fullDay(latest)})`}
            >
              {check.score === null ? '—' : check.score}
            </DrillLink>
          ) : (
            '—'
          )
        }
        {...(trend ? { trend } : {})}
        sub={latest ? `Checked ${fullDay(latest)}` : 'No check yet'}
      />
      <CountTile label="Checks" kind="check" noun="check" counts={counts} onKind={onKind} />
      <CountTile
        label="Content changes"
        kind="content"
        noun="content change"
        counts={counts}
        onKind={onKind}
      />
      <CountTile label="Notes" kind="note" noun="note" counts={counts} onKind={onKind} />
    </KpiStrip>
  )
}

function CountTile({
  label,
  kind,
  noun,
  counts,
  onKind
}: {
  label: string
  kind: KindFilter
  noun: string
  counts: Readonly<Record<KindFilter, number>>
  onKind: (kind: KindFilter) => void
}): JSX.Element {
  const count = counts[kind]
  return (
    <KpiTile
      label={label}
      value={
        count === 0 ? (
          0
        ) : (
          <button
            type="button"
            className="hist-kpi-link"
            aria-label={`Show the ${pluralize(count, noun)}`}
            onClick={() => onKind(kind)}
          >
            {count}
          </button>
        )
      }
      sub={`of ${pluralize(counts.all, 'event')}`}
    />
  )
}
