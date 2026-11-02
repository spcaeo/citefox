import type { JSX } from 'react'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import { IndexCell, LiveSinceCell, PageCell, StatusChip } from '../../changes/cells'
import { citedDrill, drillCell } from '../../changes/drills'
import { citedRows, pageName } from '../../changes/model'
import { useDrill } from '../../drill'
import { openDrawer } from '../../shell/drawers'
import { navigateHash, pageHash } from '../../shell/routes'
import { EmptyState, ListGrid, SectionHead, type ListColumn } from '../../ui'
import { newFixValues } from '../drawer/model'
import { roundRows } from './model'

/**
 * "In the next round": pages not cited yet and pages that lost ground. A row opens
 * its change; the `⋯` menu drafts the fix, explains lost ground, opens the page's
 * Progress tab or logs a change.
 */
export function RoundGrid({
  ledger,
  onDraft,
  onLost,
  onOpen
}: {
  ledger: ChangeLedger
  onDraft: (row: ChangeRow) => void
  onLost: (row: ChangeRow) => void
  onOpen: (row: ChangeRow) => void
}): JSX.Element {
  const { open } = useDrill()
  const rows = roundRows(ledger)
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
      width: 140,
      sort: (row) => row.liveSince,
      render: (row) => <LiveSinceCell row={row} />
    },
    {
      id: 'cited',
      label: 'Cited now',
      width: 88,
      numeric: true,
      sort: (row) => citedRows(row.now).length,
      render: (row) => (row.now ? citedRows(row.now).length : '—'),
      drill: (row) => drillCell(open, citedDrill(ledger, row, 'now'))
    },
    {
      id: 'index',
      label: 'Google index',
      width: 116,
      render: (row) => <IndexCell row={row} />
    },
    {
      id: 'status',
      label: 'Status',
      width: 96,
      sort: (row) => row.status,
      render: (row) => <StatusChip row={row} />
    }
  ]
  return (
    <div className="rnd-grid">
      <SectionHead
        id="rnd-grid-h"
        title="In the next round"
        count={rows.length}
        description="Pages not cited yet and pages that lost ground. Draft the fix for each one."
      />
      <ListGrid<ChangeRow>
        urlKey="round"
        label="In the next round"
        noun={['page', 'pages']}
        rows={rows}
        rowKey={(row) => row.fixId}
        rowLabel={(row) => pageName(row)}
        columns={columns}
        search={{ text: (row) => `${pageName(row)} ${row.url}`, placeholder: 'Search pages' }}
        initialSort={[{ key: 'live', dir: 'asc' }]}
        onActivate={onOpen}
        rowMenu={(row) => [
          {
            id: 'draft',
            label: 'Draft the fix',
            icon: 'sparkle' as const,
            tone: 'ai' as const,
            onSelect: () => onDraft(row)
          },
          ...(row.status === 'lost'
            ? [
                {
                  id: 'lost',
                  label: 'See what happened',
                  icon: 'eye' as const,
                  onSelect: () => onLost(row)
                }
              ]
            : []),
          {
            id: 'progress',
            label: 'Open the page’s Progress tab',
            icon: 'external' as const,
            onSelect: () => navigateHash(pageHash(row.pageId, 'progress'))
          },
          {
            id: 'log',
            label: 'Log a change',
            icon: 'plus' as const,
            onSelect: () => openDrawer('fix', newFixValues({ pageId: row.pageId }))
          }
        ]}
        empty={
          <EmptyState
            icon="check"
            title="Nothing in the next round."
            body="Every changed page is cited, or too new to judge."
          />
        }
      />
    </div>
  )
}
