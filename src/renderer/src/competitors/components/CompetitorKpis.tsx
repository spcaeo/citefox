import type { JSX } from 'react'
import type { CompetitorsOverview } from '@shared/ipc'
import { DrillButton, DrillNumber } from '../../drill'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import { KpiStrip, KpiTile } from '../../ui'
import { allLinksDrill, citationsDrill, newSitesDrill, type CompetitorDrillScope } from '../drills'
import { percent, shareTrend, topCompetitor } from '../model'

/**
 * Your share (with the scope line Overview uses too), the top competitor's share, and
 * the sites first cited in the period. In "12 of 150 links", the 12 opens your links
 * and the 150 (and the share itself) every link, yours first; New sites opens them.
 */
export function CompetitorKpis({
  data,
  drillScope,
  onOpen,
  siteHref
}: {
  data: CompetitorsOverview
  drillScope: CompetitorDrillScope
  /** Opens a row's drawer (the top competitor). */
  onOpen: (rowId: string) => void
  /** The screen with a site's drawer open, for the New sites rows. */
  siteHref: (rowId: string) => string
}): JSX.Element {
  const you = data.rows.find((row) => row.kind === 'you') ?? null
  const top = topCompetitor(data.rows)
  const links = allLinksDrill(data.rows, drillScope)
  const fresh = newSitesDrill(data.rows, drillScope, data.period, siteHref)
  const n = (value: number): string => value.toLocaleString('en-US')
  return (
    <KpiStrip label="Share of citations" className="cmp-kpis">
      <KpiTile
        label="Your share of citations"
        value={
          you === null || you.share === null ? (
            percent(null)
          ) : (
            <DrillButton
              drill={links}
              className="drill-num"
              label={`${percent(you.share)} share of citations: open the ${n(links.items.length)} links`}
              untracked
            >
              {percent(you.share)}
            </DrillButton>
          )
        }
        trend={shareTrend(you?.shareChange ?? null, data.period)}
        sub={
          <>
            {you !== null ? (
              <DrillNumber
                drill={citationsDrill(you, drillScope)}
                label={`${n(you.links.length)} of your links in AI Overviews`}
              />
            ) : (
              '0'
            )}{' '}
            of{' '}
            <DrillNumber drill={links} label={`${n(links.items.length)} links in AI Overviews`} />{' '}
            links
          </>
        }
      />
      <KpiTile
        label="Top competitor’s share"
        value={
          top === null ? (
            '—'
          ) : top.citations > 0 ? (
            <DrillButton
              drill={citationsDrill(top, drillScope)}
              className="drill-num"
              label={`${percent(top.share)} share of citations for ${top.name}: open its ${n(top.citations)} links`}
              untracked
            >
              {percent(top.share)}
            </DrillButton>
          ) : (
            percent(top.share)
          )
        }
        trend={top ? shareTrend(top.shareChange, data.period, false) : undefined}
        sub={
          top ? (
            <button type="button" className="cmp-link" onClick={() => onOpen(top.id)}>
              {top.domain ? <SiteIcon domain={top.domain} spaced /> : null}
              {top.name}
            </button>
          ) : (
            'No saved competitor cited'
          )
        }
      />
      <KpiTile
        label="New sites cited"
        value={data.newSites === null ? '—' : <DrillNumber drill={fresh} />}
        sub={
          data.newSites === null
            ? `No check older than ${data.period} days to compare`
            : `First cited in the last ${data.period} days`
        }
      />
    </KpiStrip>
  )
}
