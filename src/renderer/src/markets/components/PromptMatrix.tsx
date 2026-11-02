import { useMemo, type JSX } from 'react'
import { PromptQuestion } from '../../components/PromptQuestion'
import { marketLabel } from '../../shell/model'
import { promptHash, runningHash } from '../../shell/routes'
import {
  EmptyState,
  LinkButton,
  ListGrid,
  ResultChip,
  resultOfCheck,
  type ListColumn
} from '../../ui'
import { useHashQuery } from '../../utils/hashQuery'
import type { MarketResults, MatrixRow } from '../types'
import { buildMatrix, cellLabel } from '../utils/model'

/**
 * The prompt label opens Prompt detail in the first market that checked it
 * (the default market comes first), pinned, so it never follows whichever
 * market the page header has picked.
 */
function rowHref(pageId: string, row: MatrixRow): string {
  const cell = row.cells.find((item) => item.status !== null) ?? row.cells[0]
  return promptHash(pageId, row.promptId, {
    marketId: cell?.marketId ?? null,
    runId: cell?.runId ?? null
  })
}

function matrixColumns(pageId: string, markets: readonly MarketResults[]): ListColumn<MatrixRow>[] {
  return [
    {
      id: 'position',
      label: '#',
      width: 56,
      numeric: true,
      sort: (row) => row.position,
      render: (row) => <span className="faint">{row.position}</span>
    },
    {
      id: 'prompt',
      label: 'Question',
      width: 'fill',
      minWidth: 240,
      sort: (row) => row.text.toLowerCase(),
      render: (row) => (
        <a className="mk-prompt" href={rowHref(pageId, row)} title={row.text.split('**').join('')}>
          <PromptQuestion text={row.text} label={row.label} />
        </a>
      )
    },
    ...markets.map(({ market }): ListColumn<MatrixRow> => {
      const name = marketLabel(market)
      return {
        id: `market-${market.id}`,
        label: name,
        width: 150,
        sort: (row) => row.cells.find((item) => item.marketId === market.id)?.status ?? null,
        render: (row) => {
          const cell = row.cells.find((item) => item.marketId === market.id)
          if (!cell) return null
          return (
            <a
              className="mk-cell-link"
              href={promptHash(pageId, row.promptId, {
                marketId: cell.marketId,
                runId: cell.runId
              })}
            >
              {cell.status ? (
                <ResultChip result={resultOfCheck(cell.status)} label={cellLabel(cell)} />
              ) : (
                <span className="faint mk-unchecked">{cellLabel(cell)}</span>
              )}
              <span className="sr-only">
                {' '}
                · question {row.position} in {name}
              </span>
            </a>
          )
        }
      }
    })
  ]
}

const MATRIX_QUERY = ['show'] as const

/** FR-9.7: every prompt's result in every market, with "Only where markets differ". */
export function PromptMatrix({
  pageId,
  markets
}: {
  pageId: string
  markets: readonly MarketResults[]
}): JSX.Element {
  // The filter is on the route (`?show=differ`), like the tab.
  const [query, setQuery] = useHashQuery(MATRIX_QUERY)
  const show: 'all' | 'differ' = query.show === 'differ' ? 'differ' : 'all'
  const rows = useMemo(() => buildMatrix(markets), [markets])
  const columns = useMemo(() => matrixColumns(pageId, markets), [pageId, markets])
  const differing = rows.filter((row) => row.differs).length
  const shown = show === 'differ' ? rows.filter((row) => row.differs) : rows

  return (
    <div className="mk-matrix">
      <p className="muted mk-note">
        Each cell is the question&apos;s status in that market, with your page&apos;s position in
        the overview&apos;s sources.
      </p>
      <ListGrid
        urlKey="mx"
        label="Question results by market"
        noun={['question', 'questions']}
        rows={shown}
        rowKey={(row) => row.promptId}
        rowLabel={(row) => `Question ${row.position}`}
        columns={columns}
        search={{ text: (row) => row.text, placeholder: 'Search questions' }}
        filter={{
          label: 'Show',
          value: show,
          resetValue: 'all',
          options: [
            { value: 'all', label: 'All questions', count: rows.length },
            { value: 'differ', label: 'Only where markets differ', count: differing }
          ],
          onChange: (value) => setQuery({ show: value === 'differ' ? 'differ' : null })
        }}
        initialSort={[{ key: 'position', dir: 'asc' }]}
        summary={(info) =>
          `Showing ${info.matching.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} ${rows.length === 1 ? 'question' : 'questions'} · ${differing} differ between markets`
        }
        empty={
          <EmptyState
            title="No market has a finished check yet"
            action={
              <LinkButton size="sm" href={runningHash(pageId)}>
                Check now
              </LinkButton>
            }
          />
        }
      />
    </div>
  )
}
