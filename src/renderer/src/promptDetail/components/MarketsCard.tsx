import type { JSX } from 'react'
import type { Market, PromptCheckRow, PromptMarketSnapshot } from '@shared/domain'
import { Markdown } from '../../components/Markdown'
import { StatusChip } from '../../m3/bits'
import { statusLabel } from '../../m3/model'
import { navigateHash, pageHash } from '../../shell/routes'
import { Chip, LinkButton, ListGrid, ResultChip, type ListColumn, type MenuItem } from '../../ui'
import { marketKind, marketNameFor } from '../utils/model'
import { Card } from './OverviewCards'

interface MarketLine {
  marketId: string
  name: string
  kind: string
  current: boolean
  status: PromptCheckRow['status'] | null
  position: number | null
  /** This market's wording, when it differs from the one shown. */
  wording: string | null
  /** False for a snapshot of a market the page no longer tracks. */
  openable: boolean
}

function kindFor(markets: readonly Market[], id: string, defaultId: string | null): string {
  const market = markets.find((item) => item.id === id)
  return market ? marketKind(market, defaultId) : ''
}

/**
 * FR-13.3: the same prompt in the page's markets as a list grid, with each
 * market's wording. A row opens the prompt in that market.
 */
export function MarketsCard({
  pageId,
  markets,
  defaultMarketId,
  marketId,
  row,
  others,
  onMarketChange
}: {
  pageId: string
  markets: readonly Market[]
  defaultMarketId: string | null
  marketId: string
  row: PromptCheckRow | null
  others: readonly PromptMarketSnapshot[]
  onMarketChange: (marketId: string) => void
}): JSX.Element {
  const lines: MarketLine[] = [
    {
      marketId,
      name: marketNameFor(markets, marketId),
      kind: kindFor(markets, marketId, defaultMarketId),
      current: true,
      status: row?.status ?? null,
      position: row?.position ?? null,
      wording: null,
      openable: false
    },
    ...others
      .filter((other) => other.marketId !== marketId)
      .map((other) => ({
        marketId: other.marketId,
        name: marketNameFor(markets, other.marketId),
        kind: kindFor(markets, other.marketId, defaultMarketId),
        current: false,
        status: other.status,
        position: other.position,
        wording: row && other.text !== row.text ? other.text : null,
        openable: markets.some((market) => market.id === other.marketId)
      }))
  ]
  const columns: readonly ListColumn<MarketLine>[] = [
    {
      id: 'market',
      label: 'Market',
      width: 240,
      sort: (line) => line.name,
      render: (line) => (
        <span className="pd2-market-cell">
          {line.openable ? (
            <button
              type="button"
              className="pd2-cell-btn"
              title="Show this question in this market"
              onClick={() => onMarketChange(line.marketId)}
            >
              {line.name}
            </button>
          ) : (
            <span>{line.name}</span>
          )}
          {line.kind ? <span className="pd2-faint">{line.kind}</span> : null}
          {line.current ? (
            <Chip size="sm" tone="info">
              Shown
            </Chip>
          ) : null}
        </span>
      )
    },
    {
      id: 'status',
      label: 'Status',
      width: 176,
      sort: (line) => (line.status ? statusLabel(line.status) : null),
      render: (line) =>
        line.status ? (
          <StatusChip status={line.status} />
        ) : (
          <ResultChip result="not_checked" label="Not checked yet" />
        )
    },
    {
      id: 'position',
      label: 'Position',
      width: 96,
      numeric: true,
      sort: (line) => line.position,
      render: (line) => (line.position === null ? '—' : line.position)
    },
    {
      id: 'wording',
      label: 'Question in this market',
      width: 'fill',
      minWidth: 200,
      render: (line) =>
        line.wording ? (
          <span className="pd2-ellipsis">
            <Markdown inline baseLevel={3}>
              {line.wording}
            </Markdown>
          </span>
        ) : (
          <span className="pd2-faint">Same wording</span>
        )
    }
  ]

  function menu(line: MarketLine): MenuItem[] {
    return [
      ...(line.openable
        ? [
            {
              id: 'open',
              label: 'Show this question in this market',
              icon: 'eye' as const,
              onSelect: () => onMarketChange(line.marketId)
            }
          ]
        : []),
      {
        id: 'compare',
        label: 'Compare all markets',
        icon: 'layers',
        onSelect: () => navigateHash(pageHash(pageId, 'markets'))
      }
    ]
  }

  return (
    <Card
      headingId="pd-mkt-h"
      title="This question in each market"
      className="pd2-grid-card"
      aside={
        <LinkButton href={pageHash(pageId, 'markets')} size="sm" variant="text">
          Compare all markets →
        </LinkButton>
      }
    >
      <ListGrid<MarketLine>
        label="This question in other markets"
        noun={['market', 'markets']}
        rows={lines}
        rowKey={(line) => line.marketId}
        rowLabel={(line) => line.name}
        columns={columns}
        rowMenu={menu}
        isRowCurrent={(line) => line.current}
        onActivate={(line) => {
          if (line.openable) onMarketChange(line.marketId)
        }}
        pageSize="all"
        summary={() =>
          lines.length === 1 ? (
            <>
              This page tracks one market. Add another on the{' '}
              <a href={pageHash(pageId, 'markets')}>Markets</a> tab.
            </>
          ) : (
            `${lines.length} markets`
          )
        }
        empty={null}
      />
    </Card>
  )
}
