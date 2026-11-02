import type { JSX } from 'react'
import type { CitedSiteRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { CONNECTIONS_HREF } from '../../assistant/drawer/model'
import { DrillNumber } from '../../drill'
import { formatMonthDay } from '../../m3/model'
import { Button, EmptyState, LinkButton, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { kindLinksDrill, kindSitesDrill, type CompetitorDrillScope } from '../drills'
import { countChange, type KindKey, type KindRow } from '../model'

/**
 * "Who else the AI answers cite": every cited site other than yours, by site type,
 * with its citations as of the period start and now. Opening a type filters the sites
 * list below to it; its Sites and Citations now counts open those sites and links.
 * Sites no list or AI has sorted yet sit in their own "Not sorted yet" row, with
 * "Sort now" (or, with no AI connected, one calm line that links to Connections).
 */
export function SiteKindTable({
  rows,
  sites,
  drillScope,
  siteHref,
  periodStart,
  period,
  kind,
  sorting,
  unsorted,
  needsAi,
  onSortNow,
  onKind
}: {
  rows: readonly KindRow[]
  /** The cited sites behind the rows, for the count drills. */
  sites: readonly CitedSiteRow[]
  drillScope: CompetitorDrillScope
  siteHref: (rowId: string) => string
  periodStart: string
  period: number
  kind: KindKey | null
  /** True while the AI sorts the domains no list knows. */
  sorting: boolean
  /** Domains not sorted yet. */
  unsorted: number
  /** No AI is connected, so nothing can sort them. */
  needsAi: boolean
  onSortNow: () => void
  onKind: (kind: KindKey | null) => void
}): JSX.Element {
  const hasBefore = rows.some((row) => row.before !== null)
  const then = `Citations ${formatMonthDay(periodStart)}`
  const columns: readonly ListColumn<KindRow>[] = [
    {
      id: 'kind',
      label: 'Site type',
      width: 'fill',
      minWidth: 200,
      sort: (row) => row.label,
      render: (row) =>
        row.kind === 'pending' ? (
          <span className="cmp-pending">
            <span className="cmp-name muted">
              {row.label} ({row.sites})
            </span>
            {needsAi ? null : (
              <Button size="sm" variant="ghost" busy={sorting} onClick={onSortNow}>
                Sort now
              </Button>
            )}
          </span>
        ) : (
          <span className="cmp-name">{row.label}</span>
        )
    },
    {
      id: 'sites',
      label: 'Sites',
      width: 84,
      numeric: true,
      sort: (row) => row.sites,
      render: (row) => (
        <DrillNumber
          drill={kindSitesDrill(row.kind, row.label, sites, drillScope, siteHref)}
          label={`${pluralize(row.sites, 'site')}: ${row.label}`}
        />
      )
    },
    {
      id: 'before',
      label: then,
      width: 132,
      numeric: true,
      // No check old enough to compare: no column of dashes (audit2 #14).
      hideWhenEmpty: (row) => row.before,
      sort: (row) => row.before,
      render: (row) => (row.before === null ? <span className="faint">—</span> : row.before)
    },
    {
      id: 'now',
      label: 'Citations now',
      width: 120,
      numeric: true,
      sort: (row) => row.now,
      render: (row) => (
        <DrillNumber
          drill={kindLinksDrill(row.kind, row.label, sites, drillScope)}
          label={`${pluralize(row.now, 'link')} now: ${row.label}`}
        />
      )
    },
    {
      id: 'change',
      label: 'Change',
      width: 96,
      numeric: true,
      hideWhenEmpty: (row) => row.change,
      sort: (row) => row.change,
      render: (row) =>
        row.change === null ? (
          <span className="faint">—</span>
        ) : (
          <span className={row.change === 0 ? 'faint' : 'num'}>{countChange(row.change)}</span>
        )
    }
  ]
  const description = [
    hasBefore
      ? `${then}: the latest checks ${period} days ago, against the latest checks now.`
      : null,
    sorting ? `Sorting ${pluralize(unsorted, 'site')} by type…` : null
  ]
    .filter((part) => part !== null)
    .join(' ')
  return (
    <section className="cmp-kinds" aria-labelledby="cmp-kinds-title">
      <SectionHead
        id="cmp-kinds-title"
        title="Who else the AI answers cite"
        description={<span role={sorting ? 'status' : undefined}>{description}</span>}
      />
      {needsAi && unsorted > 0 && !sorting ? (
        <p className="muted cmp-needs-ai">
          {pluralize(unsorted, 'site')} not sorted yet. Connect an AI to sort them by type.{' '}
          <LinkButton href={CONNECTIONS_HREF} size="sm" variant="ghost">
            Connect an AI
          </LinkButton>
        </p>
      ) : null}
      <ListGrid<KindRow>
        label="Site types"
        noun={['site type', 'site types']}
        rows={rows}
        rowKey={(row) => row.kind}
        rowLabel={(row) => row.label}
        columns={columns}
        initialSort={[{ key: 'now', dir: 'desc' }]}
        onActivate={(row) => onKind(row.kind === kind ? null : row.kind)}
        isRowCurrent={(row) => row.kind === kind}
        pageSize={25}
        empty={
          <EmptyState
            title="No other sites cited yet."
            body="Once an AI Overview cites a site other than yours, it shows here by type."
          />
        }
      />
    </section>
  )
}
