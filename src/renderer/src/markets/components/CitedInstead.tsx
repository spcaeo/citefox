import { Fragment, type JSX } from 'react'
import { DrillButton, DrillFigure, drillCount } from '../../drill'
import { countNoun } from '../../m3/model'
import { marketLabel } from '../../shell/model'
import { pageHash } from '../../shell/routes'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import { ListGrid, UrlText, type ListColumn } from '../../ui'
import type { MarketResults } from '../types'
import { marketResultsDrill } from '../utils/drills'
import { topDomains } from '../utils/model'

function columns(pageId: string): ListColumn<MarketResults>[] {
  return [
    {
      id: 'market',
      label: 'Market',
      width: 220,
      sort: (entry) => marketLabel(entry.market),
      render: ({ market }) => (
        <a className="mk-head-link" href={pageHash(pageId, 'results', { marketId: market.id })}>
          {marketLabel(market)}
        </a>
      )
    },
    {
      id: 'domains',
      label: 'Top domains',
      width: 'fill',
      minWidth: 320,
      cellClassName: 'mono',
      render: ({ market, results }) => {
        const name = marketLabel(market)
        if (!results?.run) return <span className="faint">Not checked yet</span>
        const domains = topDomains(results)
        if (domains.length === 0) return <span className="faint">No other domain cited</span>
        return (
          <span className="mk-domains">
            {domains.map((item, index) => {
              const drill = marketResultsDrill(pageId, market, results, `domain:${item.domain}`)
              return (
                <Fragment key={item.domain}>
                  {index > 0 ? ' · ' : null}
                  {drill ? (
                    <DrillButton
                      drill={drill}
                      className="m3-link mk-domain"
                      label={`${item.domain}: ${countNoun(drillCount(drill), 'AI Overview', 'AI Overviews')} in ${name}`}
                    >
                      <SiteIcon domain={item.domain} spaced />
                      {item.domain} <DrillFigure drill={drill} />
                    </DrillButton>
                  ) : (
                    <>
                      <UrlText domain={item.domain} variant="url" /> {item.count}
                    </>
                  )}
                </Fragment>
              )
            })}
          </span>
        )
      }
    }
  ]
}

/**
 * FR-9.7: the most-cited competitor domains per market, counted in AIOs.
 * Each domain's count opens the overviews that cite it in that market, like
 * the leaderboard on Results; the market name opens Results there.
 */
export function CitedInstead({
  pageId,
  markets
}: {
  pageId: string
  markets: readonly MarketResults[]
}): JSX.Element {
  return (
    <div className="mk-cited">
      <p className="muted mk-note">
        Most-cited domains in each market&apos;s AI Overviews, counted like the leaderboard on
        Results.
      </p>
      <ListGrid
        label="Cited instead of you, by market"
        noun={['market', 'markets']}
        rows={markets}
        rowKey={(entry) => entry.market.id}
        rowLabel={(entry) => marketLabel(entry.market)}
        columns={columns(pageId)}
        empty={<p className="muted">No markets yet.</p>}
      />
    </div>
  )
}
