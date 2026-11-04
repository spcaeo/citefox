import { Fragment, type JSX, type ReactNode } from 'react'
import type { SentimentClaim } from '@shared/domain'
import { negativeSources, type NegativeSourceRow } from '@shared/sentiment-metrics'
import { DrillButton, DrillNumber, openTarget, useDrill } from '../../drill'
import { EmptyState, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { SOURCE_KIND_LABEL } from '../constants'
import type { SentimentDrills } from '../drills'
import { countNoun, displayUrl } from '../utils/model'
import { SourceUrl } from './drillBits'

/** FR-16.7: the sources cited next to negative claims about the brand, with what to do. */
export function NegativeSources({
  brand,
  claims,
  assist,
  drills
}: {
  brand: string
  claims: readonly SentimentClaim[]
  /** FR-16.9 "Draft replies to negative sources" slot: the section's one AI action. */
  assist?: ReactNode
  drills: SentimentDrills
}): JSX.Element {
  const { open } = useDrill()
  const rows = negativeSources(claims)
  const total = rows.reduce((sum, row) => sum + row.claimIds.length, 0)
  const byId = new Map(claims.map((claim) => [claim.id, claim] as const))
  const allNegative = drills.claims(
    {
      id: 'claims:negative',
      title: `Negative claims about ${brand}`,
      description: 'Every negative claim, grouped below by the source cited next to it.'
    },
    rows.flatMap((row) => row.claimIds)
  )
  const where = (row: NegativeSourceRow): string => (row.url ? displayUrl(row.url) : 'no source')
  const rowDrill = (row: NegativeSourceRow): ReturnType<SentimentDrills['claims']> =>
    drills.claims(
      { id: `negative:${row.url ?? 'none'}`, title: `Negative claims next to ${where(row)}` },
      row.claimIds
    )

  const columns: ListColumn<NegativeSourceRow>[] = [
    {
      id: 'source',
      label: 'Source',
      width: 'fill',
      minWidth: 220,
      cellClassName: 'mono',
      sort: (row) => row.url ?? '',
      render: (row) => (row.url ? <SourceUrl url={row.url} /> : 'No cited source')
    },
    {
      id: 'type',
      label: 'Type',
      width: 112,
      sort: (row) => (row.sourceKind ? SOURCE_KIND_LABEL[row.sourceKind] : null),
      render: (row) => (row.sourceKind ? SOURCE_KIND_LABEL[row.sourceKind] : '—')
    },
    {
      id: 'claims',
      label: 'Negative claims',
      width: 128,
      numeric: true,
      sort: (row) => row.claimIds.length,
      render: (row) => (
        <DrillNumber
          drill={rowDrill(row)}
          label={`${row.claimIds.length} negative claims, show them`}
        />
      )
    },
    {
      id: 'themes',
      label: 'Themes',
      width: 180,
      render: (row) => (
        <span className="st-attrs">
          {row.themes.map((theme, index) => (
            <Fragment key={theme}>
              {index > 0 ? ', ' : null}
              <DrillButton
                drill={drills.claims(
                  {
                    id: `negative:${row.url ?? 'none'}:${theme}`,
                    title: `${theme}: negative claims next to ${where(row)}`
                  },
                  row.claimIds.filter((id) => byId.get(id)?.theme === theme)
                )}
                untracked
                label={`Show the negative claims about ${theme} next to ${where(row)}`}
                className="st-drill"
              >
                {theme}
              </DrillButton>
            </Fragment>
          ))}
        </span>
      )
    },
    {
      id: 'advice',
      label: 'What you can do',
      width: 'fill',
      minWidth: 220,
      render: (row) => (
        <span className="st-muted-cell" title={row.advice}>
          {row.advice}
        </span>
      )
    }
  ]

  return (
    <section className="st-section" aria-labelledby="st-negative-h">
      <SectionHead
        id="st-negative-h"
        title="What’s driving the negative claims"
        description={
          <>
            Sources cited next to the{' '}
            <DrillNumber
              drill={allNegative}
              suffix={total === 1 ? ' negative sentence' : ' negative sentences'}
              label={`${countNoun(total, 'negative sentence', 'negative sentences')} about ${brand}, show them`}
            />{' '}
            about {brand}
          </>
        }
      />
      <ListGrid
        urlKey="negsrc"
        label="Negative sources table"
        noun={['source', 'sources']}
        rows={rows}
        rowKey={(row) => row.url ?? 'none'}
        rowLabel={(row) => where(row)}
        columns={columns}
        search={{
          text: (row) => [row.url ?? '', ...row.themes, row.advice].join(' '),
          placeholder: 'Search sources'
        }}
        {...(assist ? { ai: assist } : {})}
        rowMenu={(row) => [
          {
            id: 'claims',
            label: 'Show the negative claims',
            icon: 'eye',
            onSelect: () => open(rowDrill(row))
          },
          ...(row.url
            ? [
                {
                  id: 'open',
                  label: 'Open the source',
                  icon: 'external' as const,
                  onSelect: () => openTarget({ kind: 'url', url: row.url ?? '' })
                }
              ]
            : [])
        ]}
        onActivate={(row) => open(rowDrill(row))}
        empty={<EmptyState compact title={`No negative claims about ${brand} in this check`} />}
      />
    </section>
  )
}
