import type { JSX } from 'react'
import type { EngineFilter } from '../../../engines/model'
import { ResultDot, useResultWords, type ListEngineFilter } from '../../../ui'
import {
  folderGrid,
  resultLabel,
  withEngine,
  type Dashboard,
  type FolderGridRow
} from '../../views/model'
import { folderListHash, folderResultHash } from './rows'

const n = (value: number): string => value.toLocaleString('en-US')

function Count({
  count,
  text = n(count),
  href,
  label,
  className
}: {
  count: number
  /** What the cell shows, when it is not the count itself (a share). */
  text?: string
  href: string
  label: string
  className?: string
}): JSX.Element {
  if (count === 0) return <span className="num">{text}</span>
  return (
    <a
      className={className ? `tl-count num ${className}` : 'tl-count num'}
      href={href}
      aria-label={label}
      title={label}
    >
      {text}
    </a>
  )
}

function Line({
  row,
  results,
  link,
  total = false
}: {
  row: FolderGridRow
  results: readonly FolderGridRow['cells'][number]['result'][]
  /** Keeps the picked engine on a link. */
  link: (hash: string) => string
  total?: boolean
}): JSX.Element {
  const words = useResultWords()
  const Cell = total ? 'th' : 'td'
  return (
    <tr className={total ? 'tv-grid-all' : undefined}>
      <th scope="row" className="tv-grid-name">
        {total ? row.label : <a href={link(folderListHash({ id: row.id }))}>{row.label}</a>}
      </th>
      <Cell className="num">
        <Count
          count={row.totals.searches}
          href={link(folderResultHash(total ? undefined : row.id, null))}
          label={`${row.label}: open these ${row.totals.searches} searches`}
        />
      </Cell>
      {results.map((result) => {
        const count = row.totals.counts[result]
        return (
          <Cell key={result} className="tv-grid-cell num" data-result={result}>
            <Count
              count={count}
              href={link(folderResultHash(total ? undefined : row.id, result))}
              label={`${row.label} · ${resultLabel(result, words)}: open these ${count} searches`}
              className="tv-grid-count"
            />
          </Cell>
        )
      })}
      <Cell className="num">
        <Count
          count={row.totals.counts.target}
          text={row.totals.targetPct === null ? '—' : `${row.totals.targetPct}%`}
          href={link(folderResultHash(total ? undefined : row.id, 'target'))}
          label={`${row.label} · Target cited ${row.totals.targetPct ?? 0}%: open these ${row.totals.counts.target} searches`}
        />
      </Cell>
      <Cell className="num">
        <Count
          count={row.totals.needsWork}
          href={link(folderResultHash(total ? undefined : row.id, null, true))}
          label={`${row.label} · Needs work: open these ${row.totals.needsWork} searches`}
        />
      </Cell>
    </tr>
  )
}

/**
 * The dashboard's Grid: one row per folder, one column per result, and the All row.
 * Every count opens those searches on Questions; a folder's name opens its topics.
 */
export function DashGrid({
  board,
  engine,
  engineValue = 'all'
}: {
  board: Dashboard
  /** The engine filter, in the toolbar's engine spot (audit #4). */
  engine?: ListEngineFilter
  /** The picked engine: every count's link keeps it. */
  engineValue?: EngineFilter
}): JSX.Element {
  const words = useResultWords()
  const grid = folderGrid(board)
  // One folder row (no folder made yet): it is the All row, so it shows once, as
  // "All topics" (second monday review #14).
  const single = grid.rows.length === 1 ? grid.rows[0] : undefined
  const rows = single && single.id === null ? [{ ...single, label: 'All topics' }] : grid.rows
  const link = (hash: string): string => withEngine(hash, engineValue)
  return (
    <section className="ui-panel tl-dash-grid" aria-label="Folders by result">
      {engine?.control ? <div className="tv-toolbar tl-dash-bar">{engine.control}</div> : null}
      <div className="tv-grid-wrap">
        <table className="tv-grid">
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col" className="num">
                Searches
              </th>
              {grid.results.map((result) => (
                <th key={result} scope="col" className="tv-grid-head num">
                  {result === 'not_checked' ? null : <ResultDot result={result} />}
                  {resultLabel(result, words)}
                </th>
              ))}
              <th scope="col" className="num">
                Target cited
              </th>
              <th scope="col" className="num">
                Needs work
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Line key={row.id ?? 'none'} row={row} results={grid.results} link={link} />
            ))}
          </tbody>
          {single ? null : (
            <tfoot>
              <Line row={grid.all} results={grid.results} link={link} total />
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
