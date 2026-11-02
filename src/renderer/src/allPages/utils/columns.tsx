import { intervalDaysText, intervalLabel, type Market, type PageStatus } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import { membershipColumn, membershipGroup, NO_VALUE } from '../../grid'
import type { GridColumn, GridGroupOption } from '../../grid'
import { pageStatusLabel } from '../../projects/copy'
import { Chip, UrlText } from '../../ui'
import { marketLabel } from '../../shell/model'
import { alertsHash, pageHash, pagesHash } from '../../shell/routes'
import {
  MarketChips,
  MembershipLinks,
  PageCell,
  PageNumber,
  ScoreButton,
  StatusPill
} from './cells'
import type { PageDrillKind } from './drills'
import { rowName, statusText } from './text'
import { dueBucket, type DueBucket } from './views'
import { changeClass, changeLabel, citedLabel, dayLabel, folderLabel } from './format'
import { pluralize } from '@shared/pluralize'
import { LINK_COUNT_LABELS } from '@shared/report-copy'
import { UPDATED_LABEL, updatedBucket, type UpdatedBucket } from '../../pageChanges/model'
import { formatDay, formatMoment } from '../../utils/dates'

export const STATUS_ORDER: readonly PageStatus[] = [
  'tracked',
  'setting_up',
  'paused',
  'not_tracked',
  'removed'
]
const MOVEMENT_ORDER = ['gained', 'lost', 'unchanged', 'not_checked'] as const
const MOVEMENT_LABEL: Record<(typeof MOVEMENT_ORDER)[number], string> = {
  gained: 'Gained',
  lost: 'Lost',
  unchanged: 'Unchanged',
  not_checked: 'Not checked'
}

export function movementOf(row: AllPageRow): (typeof MOVEMENT_ORDER)[number] {
  if (row.change === null) return 'not_checked'
  if (row.change > 0) return 'gained'
  if (row.change < 0) return 'lost'
  return 'unchanged'
}

export function searchText(row: AllPageRow): string {
  return `${row.label ?? ''}\n${row.title ?? ''}\n${row.url}`
}

/**
 * All pages columns (Mockups/Home.dc.html). Score, change and page cited are for
 * each page's default market (FR-20.7). Cluster and Group are membership columns
 * that show "—" until Site structure supplies them.
 */
export function allPagesColumns(options: {
  markets: ReadonlyMap<string, Market>
  hasClusters: boolean
  hasGroups: boolean
  now: Date
  /** Opens the drawer behind a page's Page cited, Links to this page or Score. */
  onDrill: (kind: PageDrillKind, row: AllPageRow) => void
}): GridColumn<AllPageRow>[] {
  const { markets, onDrill } = options
  return [
    {
      id: 'page',
      label: 'Page',
      fixed: true,
      width: 300,
      minWidth: 180,
      sort: (row) => rowName(row),
      defaultDir: 'asc',
      render: (row) => <PageCell row={row} />,
      csv: (row) => rowName(row)
    },
    {
      id: 'url',
      label: 'URL',
      width: 280,
      hiddenByDefault: true,
      sort: (row) => row.url,
      defaultDir: 'asc',
      render: (row) => <UrlText url={row.url} />,
      csv: (row) => row.url
    },
    {
      id: 'folder',
      label: 'Folder',
      width: 128,
      sort: (row) => row.folder,
      defaultDir: 'asc',
      filter: {
        kind: 'facet',
        values: (row) => [row.folder ?? ''],
        label: (value) => folderLabel(value)
      },
      render: (row) => <span className="mono">{folderLabel(row.folder)}</span>,
      csv: (row) => folderLabel(row.folder),
      drill: (row) => ({
        label: `Show only pages in ${folderLabel(row.folder)}`,
        href: pagesHash({ folder: row.folder ? row.folder : '/' })
      })
    },
    {
      ...membershipColumn<AllPageRow>({
        id: 'cluster',
        label: 'Cluster',
        width: 160,
        get: (row) => row.clusters,
        ...(options.hasClusters ? {} : { note: 'From Site structure' })
      }),
      render: (row) => <MembershipLinks items={row.clusters} kind="cluster" />
    },
    {
      ...membershipColumn<AllPageRow>({
        id: 'group',
        label: 'Group',
        width: 150,
        hiddenByDefault: !options.hasGroups,
        get: (row) => row.groups,
        note: 'Your own lists'
      }),
      render: (row) => <MembershipLinks items={row.groups} kind="group" />
    },
    {
      id: 'markets',
      label: 'Markets',
      width: 168,
      sort: (row) => (row.marketIds.length === 0 ? null : row.marketIds.length),
      defaultDir: 'desc',
      filter: {
        kind: 'facet',
        values: (row) => row.marketIds,
        label: (id) => {
          const market = markets.get(id)
          return market ? marketLabel(market) : id
        },
        chip: 'Market'
      },
      render: (row) => <MarketChips row={row} markets={markets} />,
      csv: (row) =>
        row.marketIds
          .map((id) => {
            const market = markets.get(id)
            return market ? marketLabel(market) : id
          })
          .join(' | ') || null
    },
    {
      id: 'score',
      label: 'Score',
      note: 'Default market',
      width: 140,
      align: 'end',
      sort: (row) => row.score,
      defaultDir: 'desc',
      filter: {
        kind: 'range',
        value: (row) => row.score,
        hint: 'Pages without a score are hidden while a range is set.'
      },
      render: (row) => <ScoreButton row={row} onOpen={onDrill} />,
      csv: (row) => row.score
    },
    {
      id: 'change',
      label: 'Change',
      note: 'Since the previous check',
      width: 136,
      align: 'end',
      sort: (row) => row.change,
      defaultDir: 'desc',
      filter: {
        kind: 'facet',
        values: (row) => [movementOf(row)],
        label: (value) => MOVEMENT_LABEL[value as (typeof MOVEMENT_ORDER)[number]] ?? value,
        order: MOVEMENT_ORDER,
        chip: 'Movement'
      },
      render: (row) => (
        <span className={`mono ${changeClass(row.change)}`}>{changeLabel(row.change)}</span>
      ),
      csv: (row) => row.change,
      drill: (row) =>
        row.change === null
          ? null
          : {
              label: `Change ${changeLabel(row.change)} for ${rowName(row)}: open Progress`,
              href: pageHash(row.id, 'progress')
            }
    },
    {
      id: 'cited',
      label: 'Page cited',
      note: 'Questions, of those with an AI Overview',
      width: 124,
      align: 'end',
      sort: (row) =>
        row.pageCited === null || !row.aioPrompts ? null : row.pageCited / row.aioPrompts,
      defaultDir: 'desc',
      render: (row) =>
        row.pageCited === null || row.aioPrompts === null ? (
          <span className="mono">{citedLabel(row.pageCited, row.aioPrompts)}</span>
        ) : (
          <PageNumber
            row={row}
            kind="cited"
            figure={row.pageCited}
            rest={` of ${row.aioPrompts}`}
            label={`Page cited in ${row.pageCited} of ${pluralize(row.aioPrompts, 'question')} for ${rowName(row)}: show them`}
            onOpen={onDrill}
          />
        ),
      csv: (row) => (row.pageCited === null ? null : citedLabel(row.pageCited, row.aioPrompts))
    },
    {
      id: 'citations',
      label: LINK_COUNT_LABELS.thisPage,
      note: 'Each link once per AI Overview',
      width: 152,
      align: 'end',
      sort: (row) => row.citations,
      defaultDir: 'desc',
      render: (row) =>
        row.citations === null ? (
          <span className="mono">{NO_VALUE}</span>
        ) : (
          <PageNumber
            row={row}
            kind="links"
            figure={row.citations}
            label={`${row.citations} ${row.citations === 1 ? 'link' : 'links'} to ${rowName(row)}: show them`}
            onOpen={onDrill}
          />
        ),
      csv: (row) => row.citations
    },
    {
      id: 'last',
      label: 'Last check',
      width: 128,
      sort: (row) => row.lastCheckedAt,
      defaultDir: 'desc',
      render: (row) => dayLabel(row.lastCheckedAt, options.now),
      csv: (row) => row.lastCheckedAt,
      drill: (row) =>
        row.lastCheckedAt === null
          ? null
          : {
              label: `Last check ${dayLabel(row.lastCheckedAt, options.now)} for ${rowName(row)}: open History`,
              href: pageHash(row.id, 'history')
            }
    },
    {
      id: 'updated',
      label: 'Updated',
      note: 'The "Updated" date the page states, from its latest read',
      width: 128,
      sort: (row) => row.modifiedAt ?? null,
      defaultDir: 'desc',
      filter: {
        kind: 'facet',
        values: (row) => [updatedBucket(row.modifiedAt, options.now)],
        label: (value) => UPDATED_LABEL[value as UpdatedBucket] ?? value,
        order: ['recent', 'stale', 'none'],
        chip: 'Updated'
      },
      render: (row) =>
        row.modifiedAt ? (
          <span className={updatedBucket(row.modifiedAt, options.now) === 'stale' ? 'ap-down' : ''}>
            {formatDay(row.modifiedAt)}
          </span>
        ) : (
          <span className="faint">{NO_VALUE}</span>
        ),
      csv: (row) => row.modifiedAt ?? null,
      drill: (row) =>
        row.lastReadAt
          ? {
              label: `Page versions of ${rowName(row)}: open History`,
              href: versionsHref(row.id)
            }
          : null
    },
    {
      id: 'published',
      label: 'Published',
      note: 'The date the page states it was published',
      width: 128,
      hiddenByDefault: true,
      sort: (row) => row.publishedAt ?? null,
      defaultDir: 'desc',
      render: (row) =>
        row.publishedAt ? formatDay(row.publishedAt) : <span className="faint">{NO_VALUE}</span>,
      csv: (row) => row.publishedAt ?? null
    },
    {
      id: 'read',
      label: 'Last read',
      note: 'When CiteFox last read the page',
      width: 160,
      hiddenByDefault: true,
      sort: (row) => row.lastReadAt ?? null,
      defaultDir: 'desc',
      render: (row) =>
        row.lastReadAt ? formatMoment(row.lastReadAt) : <span className="faint">{NO_VALUE}</span>,
      csv: (row) => row.lastReadAt ?? null,
      drill: (row) =>
        row.lastReadAt
          ? { label: `Page versions of ${rowName(row)}: open History`, href: versionsHref(row.id) }
          : null
    },
    {
      id: 'unlogged',
      label: 'Page change',
      note: 'Changes seen on the page that nobody logged as a fix',
      width: 176,
      hiddenByDefault: true,
      sort: (row) => row.unloggedChanges ?? 0,
      defaultDir: 'desc',
      filter: {
        kind: 'facet',
        values: (row) => [(row.unloggedChanges ?? 0) > 0 ? 'yes' : 'no'],
        label: (value) => (value === 'yes' ? 'Changed, not logged' : 'Nothing waiting'),
        order: ['yes', 'no'],
        chip: 'Page change'
      },
      render: (row) =>
        (row.unloggedChanges ?? 0) > 0 ? (
          <Chip tone="fox" size="sm">
            {row.unloggedChanges === 1
              ? 'Changed, not logged'
              : `${row.unloggedChanges} changes, not logged`}
          </Chip>
        ) : (
          <span className="faint">{NO_VALUE}</span>
        ),
      csv: (row) => row.unloggedChanges ?? 0,
      drill: (row) =>
        (row.unloggedChanges ?? 0) > 0
          ? { label: `Page versions of ${rowName(row)}: open History`, href: versionsHref(row.id) }
          : null
    },
    {
      id: 'next',
      label: 'Next check',
      width: 160,
      sort: (row) => row.nextCheckAt,
      defaultDir: 'asc',
      filter: {
        kind: 'facet',
        values: (row) => [dueBucket(row, options.now)],
        label: (value) => DUE_LABEL[value as DueBucket] ?? value,
        order: ['today', 'week', 'later', 'none'],
        chip: 'Next check'
      },
      drill: (row) =>
        row.nextCheckAt === null
          ? null
          : {
              label: `Next check ${dayLabel(row.nextCheckAt, options.now)}: open Check timing`,
              href: alertsHash('schedule')
            },
      render: (row) => {
        const label = dayLabel(row.nextCheckAt, options.now)
        return <span className={label === 'Today' ? 'ap-down' : ''}>{label}</span>
      },
      csv: (row) => row.nextCheckAt
    },
    {
      id: 'prompts',
      label: 'Questions',
      width: 96,
      align: 'end',
      hiddenByDefault: true,
      sort: (row) => row.promptCount,
      defaultDir: 'desc',
      render: (row) => <span className="mono">{row.promptCount}</span>,
      csv: (row) => row.promptCount,
      drill: (row) =>
        row.status === 'not_tracked' || row.status === 'removed'
          ? null
          : {
              label: `${pluralize(row.promptCount, 'question')} for ${rowName(row)}: open Questions`,
              href: pageHash(row.id, 'prompts')
            }
    },
    {
      id: 'interval',
      label: 'Interval',
      width: 104,
      hiddenByDefault: true,
      sort: (row) => row.intervalDays,
      defaultDir: 'asc',
      filter: {
        kind: 'facet',
        values: (row) => [String(row.intervalDays)],
        label: (value) => `Every ${value} days`,
        order: ['14', '30', '60', '90']
      },
      render: (row) => intervalDaysText(row.intervalDays),
      csv: (row) => row.intervalDays,
      drill: (row) => ({
        label: `${intervalLabel(row.intervalDays)}: open Check timing`,
        href: alertsHash('schedule')
      })
    },
    {
      id: 'status',
      label: 'Status',
      width: 150,
      sort: (row) => STATUS_ORDER.indexOf(row.status),
      defaultDir: 'asc',
      filter: {
        kind: 'facet',
        values: (row) => [row.status],
        label: (value) => pageStatusLabel(value as PageStatus),
        order: STATUS_ORDER
      },
      render: (row) => <StatusPill row={row} />,
      csv: (row) => statusText(row)
    },
    {
      id: 'pin',
      label: 'Pin',
      note: 'Pinned pages show in the sidebar',
      width: 92,
      filter: {
        kind: 'facet',
        values: (row) => [row.pinned ? 'pinned' : 'not_pinned'],
        label: (value) => (value === 'pinned' ? 'Pinned' : 'Not pinned'),
        order: ['pinned', 'not_pinned']
      },
      render: (row) =>
        row.pinned ? (
          <Chip tone="info" size="sm">
            Pinned
          </Chip>
        ) : (
          <span className="faint">{NO_VALUE}</span>
        ),
      csv: (row) => (row.pinned ? 'pinned' : null)
    }
  ]
}

/** A page's History › Page versions. */
function versionsHref(pageId: string): string {
  return `${pageHash(pageId, 'history')}?view=versions`
}

const DUE_LABEL: Record<DueBucket, string> = {
  today: 'Due today',
  week: 'Within 7 days',
  later: 'Later',
  none: 'Not scheduled'
}

export const FOLDER_GROUP: GridGroupOption<AllPageRow> = {
  id: 'folder',
  label: 'Folder',
  key: (row) => ({ key: row.folder ?? '', label: folderLabel(row.folder) })
}

export const STATUS_GROUP: GridGroupOption<AllPageRow> = {
  id: 'status',
  label: 'Status',
  key: (row) => ({ key: row.status, label: pageStatusLabel(row.status) }),
  order: STATUS_ORDER
}

export const CLUSTER_GROUP = membershipGroup<AllPageRow>({
  id: 'cluster',
  label: 'Cluster',
  get: (row) => row.clusters
})

/** "12 pages · avg score 41 · 8 tracked" for a group or tree node. */
export function groupSummary(rows: readonly AllPageRow[]): string {
  const scored = rows.filter((row) => row.score !== null)
  const average =
    scored.length === 0
      ? NO_VALUE
      : String(Math.round(scored.reduce((sum, row) => sum + (row.score ?? 0), 0) / scored.length))
  const tracked = rows.filter((row) => row.status === 'tracked').length
  const pages = rows.length === 1 ? '1 page' : `${rows.length.toLocaleString('en-US')} pages`
  return `${pages} · avg score ${average} · ${tracked.toLocaleString('en-US')} tracked`
}
