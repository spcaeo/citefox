import { useState, type JSX, type KeyboardEvent } from 'react'
import { PAGE_STATUS_LABELS, type PageItem, type QuestionItem } from '@shared/report/review'
import { Button } from '../../ui'
import { formatWhen } from '../../utils/dates'
import { openReportDetail, pageDetail } from './drill'
import { ReportPage } from './copyCells'
import { QuestionList } from './QuestionList'

/** Rows shown before "Show all": long tables stay quick to scroll. */
const FIRST_ROWS = 100

function rowKeys(open: () => void): {
  onClick: () => void
  onKeyDown: (event: KeyboardEvent) => void
  tabIndex: number
} {
  return {
    onClick: open,
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    }
  }
}

function useShown<T>(rows: readonly T[]): { shown: readonly T[]; more: JSX.Element | null } {
  const [all, setAll] = useState(false)
  if (all || rows.length <= FIRST_ROWS) return { shown: rows, more: null }
  return {
    shown: rows.slice(0, FIRST_ROWS),
    more: (
      <div className="rv-more">
        <span className="rv-muted">
          Showing {FIRST_ROWS} of {rows.length}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
          Show all {rows.length}
        </Button>
      </div>
    )
  }
}

/** Every question with its result at both ends. A row opens its answers. */
export function QuestionTable({
  rows,
  fromLabel,
  toLabel,
  funnel = false,
  label
}: {
  rows: readonly QuestionItem[]
  fromLabel: string | null
  toLabel: string
  funnel?: boolean
  label: string
}): JSX.Element {
  return (
    <QuestionList
      rows={rows}
      fromLabel={fromLabel}
      toLabel={toLabel}
      label={label}
      options={{ funnel }}
    />
  )
}

const STATUS_TONE: Readonly<Record<PageItem['status'], string>> = {
  cited: 'up',
  notyet: 'down',
  toonew: 'flat',
  lost: 'down'
}

/** Published pages: kind, live since, days live, index, questions before and now, status. */
export function PageTable({
  rows,
  fromLabel,
  toLabel,
  label
}: {
  rows: readonly PageItem[]
  fromLabel: string | null
  toLabel: string
  label: string
}): JSX.Element {
  const { shown, more } = useShown(rows)
  if (rows.length === 0) return <p className="rv-muted">No pages here.</p>
  return (
    <div className="rv-tbl">
      <table aria-label={label}>
        <thead>
          <tr>
            <th className="rv-n">#</th>
            <th>Page</th>
            <th>Kind</th>
            <th>Live since</th>
            <th className="rv-r">Days live</th>
            <th>Google index</th>
            {fromLabel !== null ? <th className="rv-r">Questions {fromLabel}</th> : null}
            <th className="rv-r">{toLabel}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr
              key={row.url}
              className="rv-click"
              data-row={row.url}
              {...rowKeys(() => openReportDetail(pageDetail(row.url)))}
            >
              <td className="rv-n num">{index + 1}</td>
              <td>
                <b>{row.title ?? row.path}</b>
                <div className="rv-muted">
                  <ReportPage url={row.url} label={row.path} drill={false} />
                </div>
              </td>
              <td>{row.kind === 'new' ? 'New' : row.kind === 'rewrite' ? 'Rewrite' : '—'}</td>
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
              {fromLabel !== null ? <td className="rv-r num">{row.before ?? '—'}</td> : null}
              <td className="rv-r num">
                <b>{row.now}</b>
              </td>
              <td>
                <span className={`rv-pill rv-pill-${STATUS_TONE[row.status]}`}>
                  {PAGE_STATUS_LABELS[row.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </div>
  )
}
