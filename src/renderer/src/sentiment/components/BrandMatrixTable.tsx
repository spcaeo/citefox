import { Fragment, useMemo, type JSX } from 'react'
import { SENTIMENT_CELL_MIN_CLAIMS, type SentimentClaim } from '@shared/domain'
import { brandMatrix, formatNet, type MatrixRow } from '@shared/sentiment-metrics'
import { DrillButton, DrillFigure, DrillNumber } from '../../drill'
import { EmptyState, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { NET_LEGEND } from '../constants'
import type { SentimentDrills } from '../drills'
import { netBand } from '../utils/model'
import { pluralize } from '@shared/pluralize'

/**
 * FR-16.7: net sentiment per theme for the brand and each competitor, as a
 * list grid with one column per brand. Every cell with a claim opens its
 * claims; a cell below 2 claims shows its count with no net and sorts last. A
 * theme opens every brand's claims on it.
 */
export function BrandMatrixTable({
  brand,
  competitors,
  claims,
  drills
}: {
  brand: string
  competitors: readonly string[]
  claims: readonly SentimentClaim[]
  drills: SentimentDrills
}): JSX.Element {
  const matrix = useMemo(
    () => brandMatrix(claims, brand, competitors),
    [claims, brand, competitors]
  )

  const columns = useMemo<ListColumn<MatrixRow>[]>(
    () => [
      {
        id: 'theme',
        label: 'Theme',
        width: 'fill',
        minWidth: 180,
        sort: (row) => row.theme.toLowerCase(),
        render: (row) => (
          <DrillButton
            drill={drills.claims(
              { id: `matrix:${row.theme}`, title: `${row.theme}: claims about every brand` },
              row.cells.flatMap((cell) => cell.claimIds)
            )}
            untracked
            label={`${row.theme}: show the claims about every brand`}
            className="st-drill st-strong"
          >
            {row.theme}
          </DrillButton>
        )
      },
      ...matrix.brands.map((name): ListColumn<MatrixRow> => ({
        id: `brand:${name}`,
        label: name,
        width: 120,
        align: 'start',
        sort: (row) => row.cells.find((cell) => cell.brand === name)?.net ?? null,
        render: (row) => {
          const cell = row.cells.find((item) => item.brand === name)
          if (!cell || cell.count === 0) {
            return (
              <span className="st-net st-n-none">
                <span className="sr-only">No claims</span>
              </span>
            )
          }
          const drill = drills.claims(
            { id: `matrix:${row.theme}:${cell.brand}`, title: `${cell.brand} · ${row.theme}` },
            cell.claimIds
          )
          return cell.net === null ? (
            <DrillNumber
              drill={drill}
              label={`${cell.count} ${cell.count === 1 ? 'claim' : 'claims'} about ${cell.brand} on ${row.theme}, too few for a net, show them`}
              className="st-net st-n-none st-net-few"
            />
          ) : (
            <DrillButton
              drill={drill}
              label={`${cell.brand}, ${row.theme}: net ${formatNet(cell.net)} from ${cell.count} claims, show them`}
              className={`st-drill st-net st-n-${netBand(cell.net)}`}
            >
              {formatNet(cell.net)}
              <DrillFigure drill={drill} className="st-net-count" />
            </DrillButton>
          )
        }
      }))
    ],
    [matrix.brands, drills]
  )

  return (
    <section className="st-section" aria-labelledby="st-matrix-h">
      <SectionHead
        id="st-matrix-h"
        title="You and your competitors, by theme"
        description={`Net sentiment per theme, with claim counts. Below ${SENTIMENT_CELL_MIN_CLAIMS} claims a cell shows only its count and sorts last. Sort by a brand to rank themes.`}
      />
      <ListGrid
        urlKey="brands"
        label={`Net sentiment per theme for ${brand} and ${pluralize(competitors.length, 'competitor')}`}
        noun={['theme', 'themes']}
        rows={matrix.rows}
        rowKey={(row) => row.theme}
        rowLabel={(row) => row.theme}
        columns={columns}
        pageSize="all"
        maxBodyHeight={520}
        empty={
          <EmptyState
            compact
            title={`No claims about ${brand} or your competitors in this check`}
          />
        }
      />
      {matrix.rows.length > 0 ? (
        <div className="st-matrix-foot">
          <p className="st-note num">
            Mentions:{' '}
            {matrix.totals.map((cell, index) => (
              <Fragment key={cell.brand}>
                {index > 0 ? ' · ' : null}
                {cell.brand}{' '}
                <DrillNumber
                  drill={drills.claims(
                    { id: `matrix:brand:${cell.brand}`, title: `Claims about ${cell.brand}` },
                    cell.claimIds
                  )}
                  label={`${cell.count} claims about ${cell.brand}, show them`}
                />
              </Fragment>
            ))}
          </p>
          <ul className="st-legend-row" aria-label="Net sentiment colours">
            {NET_LEGEND.map((item) => (
              <li key={item.net}>
                <span className={`st-net st-n-${netBand(item.net)}`}>{formatNet(item.net)}</span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
