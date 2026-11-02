import type { JSX, ReactNode } from 'react'
import type { VisibilityOverview } from '@shared/ipc'
import { DrillButton, DrillNumber } from '../../drill'
import { KpiStrip, KpiTile, type KpiTileProps } from '../../ui'
import { kpiDrill, trackedDrill, type KpiSet } from '../compare'
import { shareLinksDrill } from '../drills'
import { kpiTrend } from '../model'
import { trendDrill, type TrendSet } from '../moreDrills'

/**
 * The headline strip: four numbers, each with its change since the "Compare with"
 * check. The AI Overview tile reads "of N" (N opens every tracked search), and
 * Citation share opens every link, yours first. No sub-lines: the arrow carries
 * the change, and the drawers carry the detail.
 */
export function OverviewKpis({
  data,
  marketLabel
}: {
  /** The overview: its KPIs, and the question sets each number opens. */
  data: VisibilityOverview
  /** The share's market scope: "all markets", or the picked market. */
  marketLabel: string
}): JSX.Element {
  const kpis = data.kpis
  const keywords = kpis.keywords
  const n = (value: number): string => value.toLocaleString('en-US')
  // Each number opens exactly the questions it counts (the drawer total equals it).
  const number = (set: KpiSet, label: string): JSX.Element => {
    const drill = kpiDrill(data, set)
    return (
      <DrillNumber
        drill={drill}
        label={`${n(drill.items.length)} ${keywords > 0 ? 'searches' : 'questions'}: ${label}`}
      />
    )
  }
  const tracking = trackedDrill(data)
  const trackedLabel = `${n(tracking.items.length)} ${keywords > 0 ? 'searches' : 'questions'} tracked`
  // A change chip opens the searches that moved since the compared check.
  const moved = (
    set: TrendSet,
    delta: number | null
  ): Pick<KpiTileProps, 'trend' | 'renderTrend'> => {
    const trend = kpiTrend(delta)
    if (trend === undefined) return {}
    const drill = trendDrill(data, set)
    return {
      trend,
      renderTrend: (chip: ReactNode) =>
        drill.items.length === 0 ? (
          chip
        ) : (
          <DrillButton
            drill={drill}
            className="ov-trend-btn"
            label={`${trend.text} since the compared check: open the ${n(drill.items.length)} that moved`}
            untracked
          >
            {chip}
          </DrillButton>
        )
    }
  }
  const share = kpis.share
  const allLinks = shareLinksDrill(data, marketLabel)
  return (
    <KpiStrip label="Headline numbers" className="ov-kpis">
      <KpiTile
        label="AI Overview shows"
        value={number('aio', 'AI Overview shows')}
        suffix={
          <>
            of <DrillNumber drill={tracking} label={`of ${trackedLabel}`} />
          </>
        }
        {...moved('aio', kpis.withAio.delta)}
      />
      <KpiTile
        label="You’re cited"
        value={number('cited', 'you’re cited')}
        {...moved('cited', kpis.cited.delta)}
      />
      <KpiTile
        label="You’re named"
        value={number('named', 'you’re named')}
        {...moved('named', kpis.named.delta)}
      />
      <KpiTile
        label="Citation share"
        value={
          share.value === null ? (
            '—'
          ) : (
            <DrillButton
              drill={allLinks}
              className="drill-num"
              label={`${share.value}% citation share: open the ${n(allLinks.items.length)} links`}
              untracked
            >
              {share.value}%
            </DrillButton>
          )
        }
        trend={kpiTrend(share.delta, ' pts')}
      />
    </KpiStrip>
  )
}
