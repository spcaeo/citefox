import type { PageStatus } from '@shared/domain'
import { formatScore } from '../../shell/model'
import { pageHash } from '../../shell/routes'
import { Chip, UrlText, type ListColumn } from '../../ui'
import { isTrackedStatus, pagePath } from '../utils/model'

/** What the cluster and group drawers list for each page. */
export interface MemberRow {
  pageId: string
  url: string
  title: string | null
  status: PageStatus
  score: number | null
}

export function memberName(row: MemberRow): string {
  return row.title ?? pagePath(row.url)
}

const STATUS_LABELS: Readonly<Record<PageStatus, string>> = {
  tracked: 'Tracked',
  setting_up: 'Setting up',
  paused: 'Paused',
  not_tracked: 'Not tracked',
  removed: 'Stopped'
}

/** Page (opens the page), path (copy + open), tracking, and score (opens Progress). */
export function memberColumns<Row extends MemberRow>(): ListColumn<Row>[] {
  return [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 220,
      sort: (row) => memberName(row).toLowerCase(),
      render: (row) => (
        <a className="str-clip str-link-quiet" href={pageHash(row.pageId)}>
          {memberName(row)}
        </a>
      )
    },
    {
      id: 'path',
      label: 'Path',
      width: 200,
      cellClassName: 'str-cell-mono',
      render: (row) => <UrlText url={row.url} label={pagePath(row.url)} />
    },
    {
      id: 'tracked',
      label: 'Tracking',
      width: 112,
      sort: (row) => (isTrackedStatus(row.status) ? 0 : 1),
      render: (row) =>
        isTrackedStatus(row.status) ? (
          <Chip size="sm" tone={row.status === 'paused' ? 'neutral' : 'ok'}>
            {STATUS_LABELS[row.status]}
          </Chip>
        ) : (
          <span className="str-muted">{STATUS_LABELS[row.status]}</span>
        )
    },
    {
      id: 'score',
      label: 'Score',
      width: 72,
      numeric: true,
      sort: (row) => row.score,
      render: (row) =>
        row.score === null ? (
          formatScore(row.score)
        ) : (
          <a
            className="drill-num"
            href={pageHash(row.pageId, 'progress')}
            aria-label={`Score ${formatScore(row.score)}: open Progress for ${memberName(row)}`}
          >
            {formatScore(row.score)}
          </a>
        )
    }
  ]
}

/** Page ids of the rows that are not tracked yet (Track skips the others). */
export function untrackedIds(rows: readonly MemberRow[]): string[] {
  return rows.filter((row) => !isTrackedStatus(row.status)).map((row) => row.pageId)
}

/** Page ids of the rows CiteFox can check now (tracked or setting up, not paused). */
export function checkableIds(rows: readonly MemberRow[]): string[] {
  return rows
    .filter((row) => row.status === 'tracked' || row.status === 'setting_up')
    .map((row) => row.pageId)
}
