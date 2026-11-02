import type { JSX } from 'react'
import type {
  CitationOwner,
  CitationSourceType,
  CommunitiesReport,
  SourceMixCheck
} from '@shared/domain'
import { DrillButton, DrillFigure, DrillNumber, type ItemDrill } from '../../drill'
import { MarkButton } from '../../sentiment/components/drillBits'
import { EmptyState, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { useScopeToolbar } from '../utils/scopeToolbar'
import type { CommunityDrills } from '../drills'
import { dateRange, ownerLabel, plural, segmentWidth, share, sourceTypeLabel } from '../utils/model'

type SourceTypeMix = SourceMixCheck['types'][number]
type OwnerMix = SourceMixCheck['owners'][number]

const OWNER_TEXT: Readonly<Record<CitationOwner, string>> = {
  yours: 'Links to a page on your site.',
  competitor: 'Links to a competitor you track.',
  external: 'Links to a site that is neither yours nor a tracked competitor.'
}

/**
 * FR-17.2. What the newest check's overviews cite, by source type and by
 * owner, as two list grids under one stacked bar. Unit: citations (links).
 * The screen's filters sit in the source-type grid's toolbar. Every citation count and bar segment lists
 * its links; every answer count lists its answers (NFR-14).
 */
export function SourceMix({
  report,
  check,
  scopeLabel,
  drills
}: {
  report: CommunitiesReport
  check: SourceMixCheck
  scopeLabel: string
  drills: CommunityDrills
}): JSX.Element {
  const filters = useScopeToolbar()
  const total = check.citations
  const shown = check.types.filter((segment) => segment.citations > 0)
  const links = report.links.filter((link) => link.checkIndex === check.index)
  const typeLinks = (type: CitationSourceType): ItemDrill =>
    drills.links(
      {
        id: `links:type:${type}`,
        title: `${sourceTypeLabel(type)} citations`,
        description: `Every ${sourceTypeLabel(type)} link in the newest check’s overviews · ${scopeLabel}. One row per link per answer.`
      },
      links.filter((link) => link.type === type)
    )
  const ownerLinks = (owner: CitationOwner): ItemDrill =>
    drills.links(
      {
        id: `links:owner:${owner}`,
        title: `${ownerLabel(owner)}: citations`,
        description: `${OWNER_TEXT[owner]} One row per link per answer · ${scopeLabel}.`
      },
      links.filter((link) => link.owner === owner),
      'type'
    )
  const allLinks = drills.links(
    {
      id: 'links:all',
      title: 'Every citation in the newest check',
      description: `Every link the newest check’s overviews cite · ${scopeLabel}. One answer cites several pages, so there are more links than answers.`
    },
    links,
    'type'
  )
  const typeColumns: ListColumn<SourceTypeMix>[] = [
    {
      id: 'type',
      label: 'Source type',
      width: 'fill',
      minWidth: 140,
      sort: (segment) => sourceTypeLabel(segment.type),
      render: (segment) => (
        <span data-mix-type={segment.type}>
          <span className={`cm-swatch cm-seg-${segment.type}`} aria-hidden="true" />
          {sourceTypeLabel(segment.type)}
        </span>
      )
    },
    {
      id: 'citations',
      label: 'Citations',
      width: 96,
      numeric: true,
      sort: (segment) => segment.citations,
      render: (segment) => (
        <span data-nfr-segment="">
          {segment.citations > 0 ? (
            <DrillNumber
              drill={typeLinks(segment.type)}
              label={`${plural(segment.citations, 'citation')}: ${sourceTypeLabel(segment.type)}`}
            />
          ) : (
            <span className="cm-zero">0</span>
          )}
        </span>
      )
    },
    {
      id: 'share',
      label: 'Share',
      width: 80,
      numeric: true,
      sort: (segment) => segment.citations,
      render: (segment) => `${share(segment.citations, total)}%`
    },
    {
      id: 'answers',
      label: 'Answers citing it',
      width: 136,
      numeric: true,
      sort: (segment) => segment.aios,
      render: (segment) =>
        segment.aios > 0 ? (
          <DrillNumber
            drill={drills.answers(
              {
                id: `type:${segment.type}`,
                title: `${sourceTypeLabel(segment.type)} cited`,
                description: `Answers whose sources include at least one ${sourceTypeLabel(segment.type)} link.`
              },
              segment.aioKeys
            )}
            label={`${plural(segment.aios, 'answer')} cite ${sourceTypeLabel(segment.type)}`}
          />
        ) : (
          <span className="cm-zero">0</span>
        )
    }
  ]
  const ownerColumns: ListColumn<OwnerMix>[] = [
    {
      id: 'owner',
      label: 'Owner',
      width: 'fill',
      minWidth: 120,
      render: (segment) => (
        <span data-owner={segment.owner}>
          <span className={`cm-swatch cm-owner-${segment.owner}`} aria-hidden="true" />
          {ownerLabel(segment.owner)}
        </span>
      )
    },
    {
      id: 'citations',
      label: 'Citations',
      width: 112,
      numeric: true,
      render: (segment) => (
        <span>
          {segment.citations > 0 ? (
            <DrillNumber
              drill={ownerLinks(segment.owner)}
              label={`${plural(segment.citations, 'citation')}: ${ownerLabel(segment.owner)}`}
            />
          ) : (
            '0'
          )}{' '}
          <span className="cm-muted">({share(segment.citations, total)}%)</span>
        </span>
      )
    },
    {
      id: 'answers',
      label: 'Answers',
      width: 112,
      numeric: true,
      render: (segment) =>
        segment.aios > 0 ? (
          <OwnerAnswers
            drill={drills.answers(
              {
                id: `owner:${segment.owner}`,
                title: `${ownerLabel(segment.owner)} cited`,
                description:
                  segment.owner === 'yours'
                    ? `Answers that cite a ${report.domain} page.`
                    : segment.owner === 'competitor'
                      ? 'Answers that cite a competitor you track.'
                      : 'Answers that cite a site that is neither yours nor a tracked competitor.'
              },
              segment.aioKeys
            )}
            label={`${ownerLabel(segment.owner)}: cited in ${plural(segment.aios, 'answer')}`}
          />
        ) : (
          <span className="cm-zero">0</span>
        )
    }
  ]
  return (
    <section className="cm-section" aria-labelledby="cm-mix-h" data-nfr-chart="source-mix">
      <SectionHead
        id="cm-mix-h"
        title="Where AI Overviews get their answers"
        description={
          <span data-testid="mix-caption">
            {plural(total, 'citation')} (links, not questions) across{' '}
            {plural(check.aios, 'overview')} · {scopeLabel} · {dateRange(check)}
          </span>
        }
      />
      <div className="cm-stack" aria-hidden="true" title="Select a segment to list its links">
        {shown.map((segment) => (
          <MarkButton
            key={segment.type}
            drill={typeLinks(segment.type)}
            className={`cm-seg cm-seg-${segment.type}`}
            style={{ width: segmentWidth(segment.citations, total) }}
            title={`${sourceTypeLabel(segment.type)}: ${plural(segment.citations, 'citation')}`}
          />
        ))}
      </div>
      <div className="cm-mix-body">
        <div className="cm-grid">
          <ListGrid
            label={`Citations by source type. The rows add up to ${total}.`}
            noun={['source type', 'source types']}
            rows={check.types}
            rowKey={(segment) => segment.type}
            rowLabel={(segment) => sourceTypeLabel(segment.type)}
            columns={typeColumns}
            toolbar={filters}
            summary={() => (
              <span>
                Total{' '}
                <span data-nfr-total="">
                  <DrillNumber drill={allLinks} label={`${plural(total, 'citation')} in total`} />
                </span>{' '}
                {total === 1 ? 'citation' : 'citations'} · 100%
              </span>
            )}
            empty={<EmptyState compact title="No citation in this check" />}
          />
        </div>
        <div className="cm-grid">
          <ListGrid
            label="Who Google leans on"
            noun={['owner', 'owners']}
            rows={check.owners}
            rowKey={(segment) => segment.owner}
            rowLabel={(segment) => ownerLabel(segment.owner)}
            columns={ownerColumns}
            toolbar={
              <span className="cm-owner-tool">
                <span className="cm-tool-title">Who Google leans on</span>
                <span className="cm-stack cm-stack-owner" aria-hidden="true">
                  {check.owners
                    .filter((segment) => segment.citations > 0)
                    .map((segment) => (
                      <MarkButton
                        key={segment.owner}
                        drill={ownerLinks(segment.owner)}
                        className={`cm-seg cm-owner-${segment.owner}`}
                        style={{ width: segmentWidth(segment.citations, total) }}
                        title={`${ownerLabel(segment.owner)}: ${plural(segment.citations, 'citation')}`}
                      />
                    ))}
                </span>
              </span>
            }
            empty={<EmptyState compact title="No citation in this check" />}
          />
        </div>
      </div>
    </section>
  )
}

/** "in N answers": the answers citing one owner. */
function OwnerAnswers({ drill, label }: { drill: ItemDrill; label: string }): JSX.Element {
  return (
    <DrillButton drill={drill} className="cm-drill cm-note" label={label}>
      in <DrillFigure drill={drill} /> {drill.items.length === 1 ? 'answer' : 'answers'}
    </DrillButton>
  )
}
