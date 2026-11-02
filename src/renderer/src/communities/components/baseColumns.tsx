import { Fragment } from 'react'
import type { CommunitiesReport, CommunitySourceBase } from '@shared/domain'
import { DrillButton, DrillNumber, type ItemDrill } from '../../drill'
import type { ListColumn } from '../../ui'
import type { CommunityDrills } from '../drills'
import { marketName, marketsShort, plural } from '../utils/model'
import { FirstSeen, PromptLinks, TimesCited } from './columns'

/** The base columns' ids, in display order. */
export type BaseKey = 'cited' | 'markets' | 'times' | 'gap' | 'first'

/**
 * Columns every community list shares: cited on, markets, times cited, gap
 * and first seen. `detail` is the source's own drawer (its answers, with
 * what CiteFox knows about it on top), which a row and "Times cited" open.
 */
export function baseColumns<T extends CommunitySourceBase>(
  report: CommunitiesReport,
  drills: CommunityDrills,
  detail: (row: T) => ItemDrill
): Record<BaseKey, ListColumn<T>> {
  const name = (row: T): string => row.title ?? row.url
  return {
    cited: {
      id: 'cited',
      label: report.scope === 'project' ? 'Pages' : 'Questions',
      width: 96,
      sort: (row) =>
        report.scope === 'project' ? row.pageCount : (row.promptPositions[0] ?? null),
      render: (row) =>
        report.scope === 'project' ? (
          <DrillNumber
            drill={drills.pages(
              {
                id: `pages:${row.url}`,
                title: `Pages whose answers cite “${name(row)}”`,
                description:
                  'Tracked pages with at least one answer in the newest check that cites it.'
              },
              row.aioKeys
            )}
            suffix={row.pageCount === 1 ? ' page' : ' pages'}
            label={`${name(row)}: cited for ${plural(row.pageCount, 'page')}`}
          />
        ) : (
          <span>
            <PromptLinks row={row} drills={drills} />
          </span>
        )
    },
    markets: {
      id: 'markets',
      label: 'Markets',
      width: 112,
      sort: (row) => row.marketIds.length,
      render: (row) => (
        <span>
          {row.marketIds.map((marketId, index) => {
            const keys = row.aioKeys.filter((key) => drills.aio(key)?.marketId === marketId)
            const full = marketName(report.markets, marketId)
            return (
              <Fragment key={marketId}>
                {index > 0 ? ', ' : null}
                <DrillButton
                  drill={drills.answers(
                    {
                      id: `market:${row.url}:${marketId}`,
                      title: `${full}: answers citing “${name(row)}”`,
                      description: `Answers in ${full} in the newest check that cite it.`
                    },
                    keys
                  )}
                  untracked
                  label={`${full}: show the ${plural(keys.length, 'answer')} citing ${name(row)}`}
                  className="cm-drill"
                >
                  {marketsShort(report.markets, [marketId])}
                </DrillButton>
              </Fragment>
            )
          })}
        </span>
      )
    },
    times: {
      id: 'times',
      label: 'Times cited',
      width: 96,
      numeric: true,
      sort: (row) => row.timesCited,
      render: (row) => <TimesCited row={row} drill={detail(row)} />
    },
    gap: {
      id: 'gap',
      label: 'Gap',
      width: 56,
      numeric: true,
      sort: (row) => row.gap,
      render: (row) =>
        row.gap > 0 ? (
          <DrillNumber
            drill={drills.answers(
              {
                id: `gap:${row.url}`,
                title: `Gap: “${name(row)}” cited, nothing of yours`,
                description: `Answers that cite it and no ${report.domain} page (REPORT-SPEC §8 gap).`
              },
              row.gapKeys
            )}
            label={`${name(row)}: ${plural(row.gap, 'answer')} cite it and nothing of yours`}
          />
        ) : (
          <span className="cm-zero">0</span>
        )
    },
    first: {
      id: 'first',
      label: 'First seen',
      width: 88,
      sort: (row) => row.firstSeenAt,
      render: (row) => <FirstSeen row={row} report={report} />
    }
  }
}
