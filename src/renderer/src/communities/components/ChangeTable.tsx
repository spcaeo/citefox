import type { JSX } from 'react'
import type {
  CitationSourceType,
  CommunitiesReport,
  CommunityLink,
  SourceMixCheck
} from '@shared/domain'
import { DrillButton, DrillNumber } from '../../drill'
import { EmptyState, ListGrid, SectionHead, type ListColumn } from '../../ui'
import type { CommunityDrills } from '../drills'
import {
  checkColumnLabel,
  dateRange,
  plural,
  signedChange,
  sourceTypeLabel,
  typeCitations
} from '../utils/model'

const ROWS: readonly CitationSourceType[] = ['reddit', 'youtube', 'linkedin', 'review', 'forum']

/**
 * FR-17.2. How each community source changed across the newest checks
 * (oldest on the left), as a list grid. Each "x of y" opens those links, each answer count
 * those answers, and the change opens the links gained and lost.
 */
export function ChangeTable({
  report,
  drills
}: {
  report: CommunitiesReport
  drills: CommunityDrills
}): JSX.Element | null {
  const columns = [...report.checks].sort((a, b) => b.index - a.index)
  if (columns.length === 0) return null
  const oldest = columns[0]
  const newest = columns[columns.length - 1]
  const linksOf = (check: SourceMixCheck, type: CitationSourceType): CommunityLink[] =>
    report.links.filter((link) => link.checkIndex === check.index && link.type === type)
  const deltaOf = (type: CitationSourceType): number | null =>
    oldest !== undefined && newest !== undefined && columns.length > 1
      ? typeCitations(newest, type) - typeCitations(oldest, type)
      : null
  const toneOf = (delta: number | null): string =>
    delta !== null && delta > 0 ? 'cm-up' : delta !== null && delta < 0 ? 'cm-down' : ''
  const gridColumns: ListColumn<CitationSourceType>[] = [
    {
      id: 'type',
      label: 'Community source',
      width: 'fill',
      minWidth: 140,
      sort: (type) => sourceTypeLabel(type),
      render: (type) => <span data-change-row={type}>{sourceTypeLabel(type)}</span>
    },
    ...columns.map((check): ListColumn<CitationSourceType> => ({
      id: `check-${check.index}`,
      label:
        report.scope === 'project'
          ? `${checkColumnLabel(check, report.scope)} · ${dateRange(check)}`
          : checkColumnLabel(check, report.scope),
      width: report.scope === 'project' ? 216 : 176,
      numeric: true,
      sort: (type) => typeCitations(check, type),
      render: (type) => (
        <ChangeCell
          report={report}
          check={check}
          type={type}
          label={checkColumnLabel(check, report.scope)}
          drills={drills}
        />
      )
    })),
    {
      id: 'change',
      label: 'Change',
      width: 88,
      numeric: true,
      sort: deltaOf,
      render: (type) => {
        const delta = deltaOf(type)
        const tone = toneOf(delta)
        return delta === null || oldest === undefined || newest === undefined ? (
          '—'
        ) : (
          <DrillButton
            drill={drills.change(
              {
                id: `change:${type}:delta`,
                title: `${sourceTypeLabel(type)} citations`,
                description: `${checkColumnLabel(oldest, report.scope)} to ${checkColumnLabel(newest, report.scope)}: the ${sourceTypeLabel(type)} links that appeared and the ones that dropped out.`
              },
              { before: linksOf(oldest, type), after: linksOf(newest, type) }
            )}
            untracked
            label={`${sourceTypeLabel(type)} change ${signedChange(delta)}: show the citations gained and lost`}
            className={`drill-num ${tone}`}
          >
            {signedChange(delta)}
          </DrillButton>
        )
      }
    }
  ]
  return (
    <section className="cm-section" aria-labelledby="cm-change-h">
      <SectionHead id="cm-change-h" title="How community sources changed" />
      <div className="cm-grid">
        <ListGrid
          label="Community citations per check"
          noun={['source type', 'source types']}
          rows={ROWS}
          rowKey={(type) => type}
          rowLabel={sourceTypeLabel}
          columns={gridColumns}
          empty={<EmptyState compact title="No check yet" />}
        />
      </div>
    </section>
  )
}

function ChangeCell({
  report,
  check,
  type,
  label,
  drills
}: {
  report: CommunitiesReport
  check: SourceMixCheck
  type: CitationSourceType
  label: string
  drills: CommunityDrills
}): JSX.Element {
  const segment = check.types.find((item) => item.type === type)
  const citations = segment?.citations ?? 0
  const aios = segment?.aios ?? 0
  const inCheck = report.links.filter((link) => link.checkIndex === check.index)
  return (
    <span className="cm-change-cell">
      <span>
        {citations > 0 ? (
          <DrillNumber
            drill={drills.links(
              {
                id: `change:${type}:${check.index}:links`,
                title: `${sourceTypeLabel(type)} citations · ${label}`,
                description: `Every ${sourceTypeLabel(type)} link in this check’s overviews.`
              },
              inCheck.filter((link) => link.type === type)
            )}
            label={`${sourceTypeLabel(type)}, ${label}: ${plural(citations, 'citation')}`}
          />
        ) : (
          '0'
        )}{' '}
        of{' '}
        <DrillNumber
          drill={drills.links(
            {
              id: `change:all:${check.index}:links`,
              title: `Every citation · ${label}`,
              description: 'Every link this check’s overviews cite, of any type.'
            },
            inCheck,
            'type'
          )}
          label={`${label}: ${plural(check.citations, 'citation')} in all`}
        />
      </span>
      {aios > 0 && segment !== undefined ? (
        <span className="cm-muted">
          {' · '}
          <DrillNumber
            drill={drills.answers(
              {
                id: `change:${type}:${check.index}`,
                title: `${sourceTypeLabel(type)} · ${label}`,
                description: `Answers in this check whose sources include ${sourceTypeLabel(type)}.`
              },
              segment.aioKeys
            )}
            suffix={aios === 1 ? ' answer' : ' answers'}
            className="cm-drill"
            label={`${sourceTypeLabel(type)}, ${label}: ${plural(aios, 'answer')}`}
          />
        </span>
      ) : null}
    </span>
  )
}
