import type { JSX } from 'react'
import { FIX_KIND_OPTIONS, type FixKind } from '@shared/domain'
import { CHANGE_STATUSES } from '@shared/fix-loop'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import type { FixVerdictState, FixVerdictView } from '@shared/fix-verdict'
import { newFixValues } from '../fixes/drawer/model'
import { openDrawer } from '../shell/drawers'
import { Button, EmptyState, ListGrid, type ListColumn } from '../ui'
import { IndexCell, LiveSinceCell, PageCell, StatusChip } from './cells'
import { filterRows, pageName, SHOW_FILTERS, showCounts, type ShowFilter } from './model'
import { verdictOf } from './verdict'
import { BeforeNowCell, TrendCell, VerdictPill } from './VerdictCells'

/** Verdict sort: the ones that worked first, the ones that got worse last. */
const VERDICT_ORDER: Readonly<Record<FixVerdictState, number>> = {
  worked: 0,
  no_change: 1,
  too_early: 2,
  waiting: 3,
  planned: 4,
  worse: 5
}

/**
 * "Changes you made": every logged change on a page, newest go-live first, with how
 * many of the fix's searches cited the page before and now, its trend, and the
 * verdict (Did it work?). Every count opens its searches; the filter is in the URL
 * (`?show=`). #1 spots and the average position are in the change's drawer.
 */
export function ChangesGrid({
  ledger,
  show,
  selectedId,
  busy,
  onShow,
  onSelect,
  onLost,
  onKind
}: {
  ledger: ChangeLedger
  show: ShowFilter
  selectedId: string | null
  busy: boolean
  onShow: (show: ShowFilter) => void
  onSelect: (row: ChangeRow) => void
  onLost: (row: ChangeRow) => void
  onKind: (row: ChangeRow, kind: FixKind) => void
}): JSX.Element {
  const counts = showCounts(ledger.rows)
  const views = new Map<string, FixVerdictView>(
    ledger.rows.map((row) => [row.fixId, verdictOf(row.measure, row.liveSince, ledger.builtAt)])
  )
  const view = (row: ChangeRow): FixVerdictView =>
    views.get(row.fixId) ?? verdictOf(row.measure, row.liveSince, ledger.builtAt)
  const columns: readonly ListColumn<ChangeRow>[] = [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 200,
      sort: (row) => pageName(row).toLowerCase(),
      render: (row) => <PageCell row={row} site={ledger.domain} withKind />
    },
    {
      id: 'live',
      label: 'Live since',
      width: 120,
      sort: (row) => row.liveSince,
      render: (row) => <LiveSinceCell row={row} />
    },
    {
      id: 'cited',
      label: 'Cited before → now',
      hint: 'The fix’s own searches that cite the page: before it went live, and now.',
      width: 112,
      numeric: true,
      sort: (row) => (view(row).measured === 0 ? null : view(row).citedNow),
      render: (row) => <BeforeNowCell ledger={ledger} row={row} view={view(row)} />
    },
    {
      id: 'trend',
      label: 'Trend',
      width: 76,
      sort: false,
      render: (row) => (
        <TrendCell measure={row.measure} label={`Searches citing ${pageName(row)} at each check`} />
      )
    },
    {
      id: 'verdict',
      label: 'Did it work?',
      width: 144,
      sort: (row) => VERDICT_ORDER[view(row).state],
      render: (row) => <VerdictPill view={view(row)} />
    },
    {
      id: 'index',
      label: 'Google index',
      width: 116,
      priority: 'low',
      render: (row) => <IndexCell row={row} />
    },
    {
      id: 'status',
      label: 'Status',
      width: 96,
      defaultHidden: true,
      sort: (row) => CHANGE_STATUSES.findIndex((item) => item.id === row.status),
      render: (row) => <StatusChip row={row} />
    }
  ]
  return (
    <ListGrid<ChangeRow>
      urlKey="chg"
      columnsMenu
      label="Changes you made"
      noun={['change', 'changes']}
      rows={filterRows(ledger.rows, show)}
      rowKey={(row) => row.fixId}
      rowLabel={(row) => pageName(row)}
      columns={columns}
      search={{
        text: (row) => `${pageName(row)} ${row.url} ${row.description}`,
        placeholder: 'Search changes'
      }}
      filter={{
        label: 'Show changes',
        options: SHOW_FILTERS.map((item) => ({
          value: item.id,
          label: item.label,
          count: counts[item.id]
        })),
        value: show,
        onChange: (value) => onShow(value as ShowFilter)
      }}
      onActivate={onSelect}
      isRowCurrent={(row) => row.fixId === selectedId}
      rowMenu={(row) => [
        {
          id: 'detail',
          label: 'Show the change',
          icon: 'eye' as const,
          onSelect: () => onSelect(row)
        },
        ...(row.status === 'lost'
          ? [
              {
                id: 'lost',
                label: 'See what happened',
                icon: 'trend-down' as const,
                onSelect: () => onLost(row)
              }
            ]
          : []),
        ...FIX_KIND_OPTIONS.filter((option) => option.id !== row.kind).map((option, index) => ({
          id: `kind-${option.id}`,
          label: `Change kind to ${option.label}`,
          icon: 'pencil' as const,
          disabled: busy,
          groupStart: index === 0,
          onSelect: () => onKind(row, option.id)
        }))
      ]}
      empty={
        <EmptyState
          title="No fixes logged yet."
          body="Log a fix, such as a new page or a rewrite, and CiteFox measures what it did."
          action={
            <Button size="sm" icon="plus" onClick={() => openDrawer('fix', newFixValues())}>
              Log a fix
            </Button>
          }
        />
      }
    />
  )
}
