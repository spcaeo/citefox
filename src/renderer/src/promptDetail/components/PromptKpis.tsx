import type { JSX } from 'react'
import type { PromptCheckRow } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { DrillPopover } from '../../drill'
import { Movement } from '../../m3/bits'
import { coverageLabel, statusLabel } from '../../m3/model'
import { KpiStrip, KpiTile } from '../../ui'
import type { CitationCounts } from '../types'
import { positionLabel, statusMeaning } from '../utils/model'
import type { PromptTab } from './promptTabs'

/**
 * The prompt's four numbers as one KPI strip: status (what it means and its
 * points), position among the sources, the change since the last check, and
 * page coverage. Each value moves to the tab that shows it, drawn as the kit's
 * drillable number (`drill-num`, dotted underline).
 */
export function PromptKpis({
  row,
  sourceCount,
  counts,
  sinceLabel,
  onGo
}: {
  row: PromptCheckRow
  sourceCount: number
  counts: CitationCounts
  sinceLabel: string | null
  onGo: (tab: PromptTab, focusId: string) => void
}): JSX.Element {
  const meaning = statusMeaning(row.status)
  return (
    <KpiStrip className="pd2-kpis" label="This question in numbers">
      <KpiTile
        label="Status"
        value={
          <DrillPopover
            label={`Status ${statusLabel(row.status)}: what it means`}
            title={statusLabel(row.status)}
            className="drill-num"
            content={() => (
              <>
                <p>{meaning.meaning}</p>
                <p className="faint">{meaning.points}</p>
                {row.previousStatus ? (
                  <p className="faint">
                    Previous check: {statusLabel(row.previousStatus)}
                    {row.previousPosition !== null ? ` · position ${row.previousPosition}` : ''}
                  </p>
                ) : null}
              </>
            )}
          >
            {statusLabel(row.status)}
          </DrillPopover>
        }
        sub={meaning.points}
      />
      <KpiTile
        label="Position in the sources"
        value={
          row.position === null ? (
            'Not listed'
          ) : (
            <button
              type="button"
              className="drill-num"
              aria-label={`${positionLabel(row.position)}: go to the sources`}
              onClick={() => onGo('sources', 'pd-src-h')}
            >
              {row.position}
            </button>
          )
        }
        suffix={sourceCount > 0 ? `of ${pluralize(sourceCount, 'source')}` : undefined}
        sub={`${counts.thisPage === 1 ? '1 link' : `${counts.thisPage} links`} to this page · ${counts.otherOwn} to other own pages`}
      />
      <KpiTile
        label={sinceLabel ? `Since ${sinceLabel}` : 'Since the last check'}
        value={
          row.movement ? (
            <button type="button" className="drill-num" onClick={() => onGo('time', 'pd-time-h')}>
              <Movement
                movement={row.movement}
                previousStatus={row.previousStatus}
                previousPosition={row.previousPosition}
              />
              <span className="sr-only">: go to this question over time</span>
            </button>
          ) : (
            'First check'
          )
        }
        sub={
          row.previousStatus
            ? `Was ${statusLabel(row.previousStatus)}${row.previousPosition !== null ? ` · position ${row.previousPosition}` : ''}`
            : 'Nothing to compare with yet'
        }
      />
      <KpiTile
        label="Page coverage"
        value={
          <button
            type="button"
            className="drill-num"
            aria-label={`Page coverage ${row.coverage ? coverageLabel(row.coverage) : 'not rated yet'}: go to the coverage`}
            onClick={() => onGo('overview', 'pd-cov-h')}
          >
            {row.coverage ? coverageLabel(row.coverage) : 'Not rated'}
          </button>
        }
        sub={row.action ? 'Has a suggested update' : 'From Content gaps'}
      />
    </KpiStrip>
  )
}
