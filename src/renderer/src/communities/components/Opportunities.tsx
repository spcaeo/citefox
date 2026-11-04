import type { JSX } from 'react'
import {
  OPPORTUNITY_SOURCE_TYPES,
  type CommunitiesReport,
  type CommunityOpportunity
} from '@shared/domain'
import { DrillLink, DrillNumber, DrillPopover, openTarget, useDrill } from '../../drill'
import { EmptyState, ListGrid, type ListColumn } from '../../ui'
import type { CommunityDrills } from '../drills'
import { SourceLink } from './columns'
import { useScopeToolbar } from '../utils/scopeToolbar'
import { EmptyWithFilters } from './ScopeFilters'
import { marketName, plural, sourceTypeLabel, statusLabel } from '../utils/model'

const COMMUNITY = new Set<string>(OPPORTUNITY_SOURCE_TYPES)

/**
 * FR-17.5. Answers that cite Reddit, YouTube or LinkedIn but not the page,
 * most to gain first, as one list grid. The prompt and its status open Prompt
 * detail; the rank and the points open the ranking maths in a popover;
 * "N more" lists the other community links in that answer.
 */
export function Opportunities({
  report,
  drills
}: {
  report: CommunitiesReport
  drills: CommunityDrills
}): JSX.Element {
  const { open } = useDrill()
  const filters = useScopeToolbar()
  const rows = report.opportunities
  const pointsText = (row: CommunityOpportunity): string =>
    `+${row.gainPoints} ${row.gainPoints === 1 ? 'point' : 'points'} if cited`
  const othersOf = (row: CommunityOpportunity): ReturnType<CommunityDrills['links']> =>
    drills.links(
      {
        id: `opportunity:${row.aioKey}:others`,
        title: 'Other community sources in this answer',
        description: `Reddit, YouTube and LinkedIn links in the same overview, besides the top one.`
      },
      report.links.filter(
        (link) =>
          link.aioKey === row.aioKey &&
          link.checkIndex === 0 &&
          COMMUNITY.has(link.type) &&
          link.normalizedUrl !== row.sourceUrl
      ),
      'type'
    )
  const why = (row: CommunityOpportunity): JSX.Element => {
    const aio = drills.aio(row.aioKey)
    return (
      <>
        <p>
          <strong>Why rank {row.rank}:</strong> opportunities sort by the visibility points the page
          would gain, then by how high the community source sits, then by how many other community
          sources the answer cites.
        </p>
        <p>
          <strong>{pointsText(row)}:</strong> a cited page scores 3 points per question.
          {aio ? ` Today this question is “${statusLabel(aio.status)}”` : ''}, worth{' '}
          {3 - row.gainPoints}, so being cited adds {row.gainPoints}. Source {row.sourcePosition} of
          the answer is the {sourceTypeLabel(row.sourceType)} link;{' '}
          {plural(row.otherSources, 'other community source')}.
        </p>
      </>
    )
  }

  const columns: ListColumn<CommunityOpportunity>[] = [
    {
      id: 'rank',
      label: '#',
      width: 40,
      numeric: true,
      sort: (row) => row.rank,
      render: (row) => (
        <DrillPopover
          label={`Rank ${row.rank}: show why`}
          title={`Why rank ${row.rank}`}
          className="drill-num"
          content={() => <div className="cm-why">{why(row)}</div>}
        >
          {row.rank}
        </DrillPopover>
      )
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 200,
      sort: (row) => drills.aio(row.aioKey)?.promptPosition ?? null,
      render: (row) => {
        const aio = drills.aio(row.aioKey)
        if (aio === undefined) return '—'
        return (
          <span className="cm-source-cell">
            <DrillLink target={drills.answerTarget(aio)}>
              Question {aio.promptPosition} · {aio.label}
              {report.scope === 'project' ? ` · ${aio.pageLabel}` : ''}
            </DrillLink>
            <span className="cm-source-kind"> · {marketName(report.markets, aio.marketId)}</span>
          </span>
        )
      }
    },
    {
      id: 'gain',
      label: 'Gain',
      width: 136,
      sort: (row) => row.gainPoints,
      render: (row) => (
        <DrillPopover
          label={`${pointsText(row)}: show the score maths`}
          title="The score maths"
          className="cm-drill"
          content={() => <div className="cm-why">{why(row)}</div>}
        >
          {pointsText(row)}
        </DrillPopover>
      )
    },
    {
      id: 'source',
      label: 'Community source in the overview',
      width: 'fill',
      minWidth: 200,
      render: (row) => (
        <span className="cm-source-cell">
          <span className="cm-source-kind">
            {sourceTypeLabel(row.sourceType)} · {row.channel}
          </span>{' '}
          <SourceLink url={row.sourceUrl} title={row.sourceTitle} />
        </span>
      )
    },
    {
      id: 'others',
      label: 'More',
      width: 56,
      numeric: true,
      sort: (row) => row.otherSources,
      render: (row) =>
        row.otherSources > 0 ? (
          <DrillNumber
            drill={othersOf(row)}
            label={`${row.otherSources} more community ${row.otherSources === 1 ? 'source' : 'sources'} in this answer`}
          />
        ) : (
          <span className="cm-zero">0</span>
        )
    },
    {
      id: 'action',
      label: 'Recommended action',
      width: 'fill',
      minWidth: 200,
      render: (row) => (
        <span className="cm-clamp2" title={`${row.action} ${row.why}`}>
          {row.action}
          <span className="cm-muted"> {row.why}</span>
        </span>
      )
    }
  ]

  return (
    <div data-testid="cm-opportunities" className="cm-grid">
      <ListGrid
        urlKey="opp"
        label="Opportunities, ranked by what there is to gain"
        noun={['opportunity', 'opportunities']}
        rows={rows}
        rowKey={(row) => row.aioKey}
        rowLabel={(row) => `Rank ${row.rank}`}
        columns={columns}
        {...(filters ? { toolbar: filters } : {})}
        rowMenu={(row) => {
          const aio = drills.aio(row.aioKey)
          return [
            ...(aio
              ? [
                  {
                    id: 'prompt',
                    label: 'Open question detail',
                    icon: 'eye' as const,
                    onSelect: () => openTarget(drills.answerTarget(aio))
                  }
                ]
              : []),
            {
              id: 'source',
              label: 'Open the community source',
              icon: 'external',
              onSelect: () => openTarget({ kind: 'url', url: row.sourceUrl })
            },
            ...(row.otherSources > 0
              ? [
                  {
                    id: 'others',
                    label: 'Show the other community sources',
                    icon: 'layers' as const,
                    onSelect: () => open(othersOf(row))
                  }
                ]
              : [])
          ]
        }}
        summary={() => 'CiteFox never posts. You copy and post each reply.'}
        empty={
          <EmptyWithFilters>
            <EmptyState
              compact
              title="No opportunity here"
              body={`Every overview that cites Reddit, YouTube or LinkedIn also cites ${
                report.scope === 'project' ? 'the page its question is tracked for' : 'your page'
              }, or none cites them.`}
            />
          </EmptyWithFilters>
        }
      />
    </div>
  )
}
