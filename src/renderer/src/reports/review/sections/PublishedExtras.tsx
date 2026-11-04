import { useMemo, type JSX } from 'react'
import {
  PAGE_STATUS_LABELS,
  type DaysRow,
  type KindRow,
  type PageItem,
  type ReviewReport
} from '@shared/report/review'
import { SearchBox } from '../../../ui'
import { formatWhen } from '../../../utils/dates'
import { useQueryState, useQuerySortChoice } from '../../../utils/queryState'
import { openReportDetail, pageDetail } from '../drill'
import { ReportPage } from '../copyCells'
import { Fig } from '../Figures'

/**
 * Published pages in the app: the "New pages and rewrites" and "By days live" tables,
 * and the page table with search, sortable headers, New / Rewrite chips, and number-one
 * and average-position columns. A row opens the page's before → after story.
 */

export function KindTable({ report }: { report: ReviewReport }): JSX.Element | null {
  const rows = report.impact.kinds
  if (rows.length === 0) return null
  const comparing = report.comparing && report.fromLabel !== null
  return (
    <section className="rv-panel" aria-labelledby="rv-kinds-title">
      <h3 id="rv-kinds-title">New pages and rewrites</h3>
      <p className="rv-sub">
        Questions citing each kind of page, and where you are the top source.
      </p>
      <div className="rv-tbl">
        <table aria-label="New pages and rewrites">
          <thead>
            <tr>
              <th>Kind</th>
              <th className="rv-r">Pages</th>
              <th className="rv-r">Cited now</th>
              {comparing ? <th className="rv-r">Questions {report.fromLabel}</th> : null}
              <th className="rv-r">Questions {report.toLabel}</th>
              <th className="rv-r">#1 spots</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: KindRow) => (
              <tr key={row.label}>
                <td>
                  <b>{row.label}</b>
                </td>
                <td className="rv-r">
                  <Fig num={row.pages} />
                </td>
                <td className="rv-r">
                  <Fig num={row.cited} />
                </td>
                {comparing ? (
                  <td className="rv-r">{row.before ? <Fig num={row.before} /> : '—'}</td>
                ) : null}
                <td className="rv-r">
                  <Fig num={row.now} />
                </td>
                <td className="rv-r">
                  <Fig num={row.first} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function DaysTable({ report }: { report: ReviewReport }): JSX.Element | null {
  const rows = report.impact.days
  if (rows.length === 0) return null
  return (
    <section className="rv-panel" aria-labelledby="rv-days-title">
      <h3 id="rv-days-title">By days live</h3>
      <p className="rv-sub">
        How long each page has been live on {report.toLabel}, and what it earned.
      </p>
      <div className="rv-tbl">
        <table aria-label="By days live">
          <thead>
            <tr>
              <th>Live</th>
              <th className="rv-r">Pages</th>
              <th className="rv-r">Cited now</th>
              <th className="rv-r">Questions citing them</th>
              <th className="rv-r">#1 spots</th>
              <th className="rv-r">Not indexed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: DaysRow) => (
              <tr key={row.label}>
                <td>
                  <b>{row.label}</b>
                </td>
                <td className="rv-r">
                  <Fig num={row.pages} />
                </td>
                <td className="rv-r">
                  <Fig num={row.cited} />
                </td>
                <td className="rv-r">
                  <Fig num={row.questions} />
                </td>
                <td className="rv-r">
                  <Fig num={row.first} />
                </td>
                <td className="rv-r">
                  <Fig num={row.notIndexed} className={row.notIndexed.n > 0 ? 'rv-bad' : ''} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type SortKey =
  'page' | 'kind' | 'live' | 'days' | 'index' | 'before' | 'now' | 'first' | 'avg' | 'status'

const SORT_KEYS: readonly SortKey[] = [
  'page',
  'kind',
  'live',
  'days',
  'index',
  'before',
  'now',
  'first',
  'avg',
  'status'
]

const STATUS_TONE: Readonly<Record<PageItem['status'], string>> = {
  cited: 'up',
  notyet: 'down',
  toonew: 'flat',
  lost: 'down'
}

function sortValue(
  row: PageItem,
  key: SortKey,
  stats: ReviewReport['impact']['pageStats']
): string | number {
  const stat = stats[row.url]
  switch (key) {
    case 'page':
      return (row.title ?? row.path).toLowerCase()
    case 'kind':
      return row.kind ?? ''
    case 'live':
      return row.liveSince ?? ''
    case 'days':
      return row.daysLive ?? -1
    case 'index':
      return row.indexed === null ? 1 : row.indexed ? 2 : 0
    case 'before':
      return row.before ?? -1
    case 'now':
      return row.now
    case 'first':
      return stat?.first ?? 0
    case 'avg':
      return stat?.avg ?? Number.POSITIVE_INFINITY
    case 'status':
      return PAGE_STATUS_LABELS[row.status]
  }
}

/** Every published page: search, sort any column, open a page's story. */
export function PublishedTable({
  report,
  rows,
  label
}: {
  report: ReviewReport
  rows: readonly PageItem[]
  label: string
}): JSX.Element {
  // The search is `?pq=` and the sort `?psort=<column>:<asc|desc>`.
  const [searchValue, setSearchValue] = useQueryState('pq')
  const search = searchValue ?? ''
  const setSearch = (value: string): void => setSearchValue(value || null)
  const [urlSort, setUrlSort] = useQuerySortChoice('psort', SORT_KEYS)
  const sort = useMemo(() => (urlSort ? { key: urlSort.key, up: !urlSort.down } : null), [urlSort])
  const setSort = (next: { key: SortKey; up: boolean }): void =>
    setUrlSort({ key: next.key, down: !next.up })
  const stats = report.impact.pageStats
  const words = search.trim().toLowerCase()
  const found = rows.filter(
    (row) => words === '' || `${row.title ?? ''} ${row.url}`.toLowerCase().includes(words)
  )
  const shown =
    sort === null
      ? found
      : [...found].sort((a, b) => {
          const left = sortValue(a, sort.key, stats)
          const right = sortValue(b, sort.key, stats)
          const order =
            typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right))
          return sort.up ? order : -order
        })
  const header = (key: SortKey, text: string, right = false): JSX.Element => {
    const on = sort?.key === key
    return (
      <th
        className={right ? 'rv-r' : undefined}
        aria-sort={on ? (sort?.up ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className="rv-sort"
          onClick={() => setSort({ key, up: on ? !sort?.up : !right })}
        >
          {text}
          <span aria-hidden="true">{on ? (sort?.up ? ' ▲' : ' ▼') : ''}</span>
        </button>
      </th>
    )
  }
  const comparing = report.fromLabel !== null
  return (
    <>
      <SearchBox label="Find a page" value={search} onChange={setSearch} className="rv-search" />
      {shown.length === 0 ? (
        <p className="rv-muted">No pages here.</p>
      ) : (
        <div className="rv-tbl">
          <table aria-label={label}>
            <thead>
              <tr>
                <th className="rv-n">#</th>
                {header('page', 'Page')}
                {header('kind', 'Kind')}
                {header('live', 'Live since')}
                {header('days', 'Days live', true)}
                {header('index', 'Google index')}
                {comparing ? header('before', `Questions ${report.fromLabel}`, true) : null}
                {header('now', report.toLabel, true)}
                {header('first', '#1 spots', true)}
                {header('avg', 'Avg position', true)}
                {header('status', 'Status')}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => {
                const stat = stats[row.url]
                const open = (): void => openReportDetail(pageDetail(row.url))
                return (
                  <tr
                    key={row.url}
                    className="rv-click"
                    data-row={row.url}
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open()
                      }
                    }}
                  >
                    <td className="rv-n num">{index + 1}</td>
                    <td>
                      <b>{row.title ?? row.path}</b>
                      <div className="rv-muted">
                        <ReportPage url={row.url} label={row.path} drill={false} />
                      </div>
                    </td>
                    <td>
                      {row.kind === null ? (
                        '—'
                      ) : (
                        <span className={`rv-kind rv-kind-${row.kind}`}>
                          {row.kind === 'new' ? 'New' : 'Rewrite'}
                        </span>
                      )}
                    </td>
                    <td>{row.liveSince === null ? '—' : formatWhen(row.liveSince)}</td>
                    <td className="rv-r num">{row.daysLive ?? '—'}</td>
                    <td>
                      {row.indexed === null ? (
                        <span className="rv-muted">Not checked</span>
                      ) : (
                        <span className={`rv-pill rv-pill-${row.indexed ? 'up' : 'down'}`}>
                          {row.indexed ? 'Indexed' : 'Not indexed'}
                        </span>
                      )}
                    </td>
                    {comparing ? <td className="rv-r num">{row.before ?? '—'}</td> : null}
                    <td className="rv-r num">
                      <b>{row.now}</b>
                    </td>
                    <td className="rv-r num">{stat?.first ?? 0}</td>
                    <td className="rv-r num">
                      {stat?.avg === null || stat?.avg === undefined ? '—' : stat.avg.toFixed(1)}
                    </td>
                    <td>
                      <span className={`rv-pill rv-pill-${STATUS_TONE[row.status]}`}>
                        {PAGE_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
