import { useMemo, type JSX, type ReactNode } from 'react'
import { pluralize } from '@shared/pluralize'
import { topicHash } from '../../../shell/routes'
import {
  IconButton,
  ListGrid,
  MenuButton,
  ResultBar,
  type ListColumn,
  type ListTree,
  type ListTreeGroup,
  type ListEngineFilter,
  type MenuItem
} from '../../../ui'
import { formatMoment } from '../../../utils/dates'
import { useGridQueryState } from '../../../utils/queryState'
import type { EngineFilter } from '../../../engines/model'
import { addTotals, withEngine, type DashFolder, type Totals } from '../../views/model'
import { TopicNameCell } from '../components/TopicNameCell'
import type { TopicLine } from '../model'
import { folderKey, folderListHash, folderResultHash, type DashRow } from './rows'

const FOLDER = 'folder:'

const n = (value: number): string => value.toLocaleString('en-US')

function totalsOf(rows: readonly DashRow[]): Totals {
  return addTotals(rows.map((row) => row.topic.totals))
}

function latest(rows: readonly DashRow[]): string | null {
  return rows.reduce<string | null>(
    (at, row) =>
      row.topic.checkedAt !== null && (at === null || row.topic.checkedAt > at)
        ? row.topic.checkedAt
        : at,
    null
  )
}

/**
 * The dashboard's Tree (board Main): Folder › Topic, each folder row with its topics'
 * totals in the same columns, collapsed at first, with Expand all. A topic's
 * counts open the topic; a folder's open its topics in the List. A made folder has a
 * ⋯ with Rename and Delete.
 */
export function DashTree({
  rows,
  folders,
  editing,
  onEdit,
  onOpen,
  onRename,
  menu,
  folderMenu,
  current,
  engine,
  engineValue = 'all'
}: {
  rows: readonly DashRow[]
  /** Every folder, in order (the tree orders its groups the same way). */
  folders: readonly DashFolder[]
  editing: string | null
  onEdit: (topicId: string | null) => void
  onOpen: (line: TopicLine) => void
  onRename: (line: TopicLine, name: string) => Promise<void>
  menu: (line: TopicLine) => readonly MenuItem[]
  folderMenu: (folder: DashFolder) => readonly MenuItem[]
  current: string | null
  /** The engine filter, in the toolbar's engine spot (audit #4). */
  engine?: ListEngineFilter
  /** The picked engine: every count's link keeps it. */
  engineValue?: EngineFilter
}): JSX.Element {
  const link = (hash: string): string => withEngine(hash, engineValue)
  // Search and sort ride in the URL (`tt.q`, `tt.sort`): a link keeps them.
  const grid = useGridQueryState('tt')
  const byKey = useMemo(
    () => new Map(folders.map((folder) => [`${FOLDER}${folderKey(folder)}`, folder])),
    [folders]
  )
  // With no folder made, every topic sits in "No folder": the folder level and the
  // All row would only repeat the topic rows (second monday review #14), so the
  // tree is a flat list then.
  const hasFolders = folders.some((folder) => folder.id !== null)
  const tree = useMemo<ListTree<DashRow>>(
    () => ({
      path: (row) => [{ key: `${FOLDER}${folderKey(row.folder)}`, label: row.folder.name }],
      order: folders.map((folder) => `${FOLDER}${folderKey(folder)}`),
      totalRow: 'All',
      moreAfter: 5,
      renderGroup: (group) => {
        const folder = byKey.get(group.key)
        return folder ? (
          <FolderLabel folder={folder} group={group} menu={folderMenu} />
        ) : (
          group.label
        )
      }
    }),
    [folders, byKey, folderMenu]
  )
  const columns = useMemo<ListColumn<DashRow>[]>(
    () => [
      {
        id: 'topic',
        label: 'Topic',
        width: 'fill',
        minWidth: 220,
        sort: (row) => row.topic.name.toLowerCase(),
        render: (row) => (
          <TopicNameCell
            name={row.topic.name}
            meta={null}
            paused={row.topic.status === 'paused'}
            editing={editing === row.id}
            onEdit={() => onEdit(row.id)}
            onOpen={() => onOpen(row.line)}
            onSave={(name) => onRename(row.line, name).then(() => onEdit(null))}
            onCancel={() => onEdit(null)}
          />
        )
      },
      {
        id: 'searches',
        label: 'Searches',
        width: 92,
        numeric: true,
        sort: (row) => row.topic.totals.searches,
        render: (row) => (
          <a
            className="tl-count num"
            href={link(topicHash(row.id))}
            aria-label={`${row.topic.name}: open its ${n(row.topic.totals.searches)} searches`}
          >
            {n(row.topic.totals.searches)}
          </a>
        ),
        total: (rows, group) => {
          const count = totalsOf(rows as readonly DashRow[]).searches
          const folder = group ? byKey.get(group.key) : undefined
          return folder ? (
            <a
              className="tl-count num"
              href={link(folderListHash(folder))}
              // The name holds the number shown, so voice control finds the link by what it shows.
              aria-label={`${folder.name}: ${n(count)} searches, list its ${rows.length} topics`}
            >
              {n(count)}
            </a>
          ) : (
            n(count)
          )
        },
        totalSort: (rows) => totalsOf(rows as readonly DashRow[]).searches
      },
      {
        id: 'results',
        label: 'Results',
        width: 156,
        sort: false,
        render: (row) => (
          <ResultBar
            counts={row.topic.totals.counts}
            label={`${row.topic.name} searches`}
            hrefFor={(result) => link(topicsResultHref(row.id, result))}
          />
        ),
        total: (rows, group) => (
          <ResultBar
            counts={totalsOf(rows as readonly DashRow[]).counts}
            label={`${group?.label ?? 'All'} searches`}
          />
        )
      },
      {
        id: 'target',
        label: 'Target cited',
        width: 104,
        numeric: true,
        sort: (row) => row.topic.totals.targetPct,
        render: (row) => (
          <DrillCount
            count={row.topic.totals.counts.target}
            text={pct(row.topic.totals.targetPct)}
            href={link(topicsResultHref(row.id, 'target'))}
            label={`${row.topic.name} · Target cited ${pct(row.topic.totals.targetPct)}: open these ${n(row.topic.totals.counts.target)} searches`}
          />
        ),
        total: (rows, group) => {
          const totals = totalsOf(rows as readonly DashRow[])
          const folder = group ? byKey.get(group.key) : undefined
          return folder ? (
            <DrillCount
              count={totals.counts.target}
              text={pct(totals.targetPct)}
              href={link(folderResultHash(folder.id, 'target'))}
              label={`${folder.name} · Target cited ${pct(totals.targetPct)}: open these ${n(totals.counts.target)} searches`}
            />
          ) : (
            pct(totals.targetPct)
          )
        },
        totalSort: (rows) => totalsOf(rows as readonly DashRow[]).targetPct
      },
      {
        id: 'work',
        label: 'Needs work',
        width: 100,
        numeric: true,
        sort: (row) => row.topic.totals.needsWork,
        render: (row) => (
          <DrillCount
            count={row.topic.totals.needsWork}
            href={link(`${topicHash(row.id)}?work=1`)}
            label={`${row.topic.name} · Needs work: open these ${n(row.topic.totals.needsWork)} searches`}
          />
        ),
        total: (rows, group) => {
          const count = totalsOf(rows as readonly DashRow[]).needsWork
          const folder = group ? byKey.get(group.key) : undefined
          return folder ? (
            <DrillCount
              count={count}
              href={link(folderResultHash(folder.id, null, true))}
              label={`${folder.name} · Needs work: open these ${n(count)} searches`}
            />
          ) : (
            n(count)
          )
        },
        totalSort: (rows) => totalsOf(rows as readonly DashRow[]).needsWork
      },
      {
        id: 'checked',
        label: 'Last check',
        width: 150,
        // The first to go on a narrow window, so the list never scrolls sideways.
        priority: 'low',
        sort: (row) => row.topic.checkedAt ?? '',
        render: (row) => checkedCell(row.topic.checkedAt),
        total: (rows) => checkedCell(latest(rows as readonly DashRow[]))
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `link` follows engineValue
    [editing, onEdit, onOpen, onRename, byKey, engineValue]
  )
  return (
    <ListGrid<DashRow>
      {...grid.listProps}
      label={hasFolders ? 'Topics by folder' : 'All topics'}
      noun={['topic', 'topics']}
      rows={rows}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.topic.name}
      {...(engine ? { engine } : {})}
      columns={columns}
      {...(hasFolders ? { tree } : {})}
      search={{
        text: (row) => row.topic.name,
        placeholder: `Search ${pluralize(rows.length, 'topic')}`
      }}
      rowMenu={(row) => menu(row.line)}
      onActivate={(row) => {
        if (editing !== row.id) onOpen(row.line)
      }}
      isRowCurrent={(row) => row.id === current}
      empty={<p className="faint">No topics match.</p>}
    />
  )
}

/** A topic's drill for one result (`#/topics/<id>?result=not_cited`). */
function topicsResultHref(topicId: string, result: string): string {
  return `${topicHash(topicId)}?result=${encodeURIComponent(result)}`
}

/** A count (or a share) that opens the searches behind it; nothing to open stays plain. */
function DrillCount({
  count,
  text = n(count),
  href,
  label
}: {
  count: number
  text?: string
  href: string
  label: string
}): JSX.Element {
  if (count === 0) return <span className="num">{text}</span>
  return (
    <a className="tl-count num" href={href} aria-label={label} title={label}>
      {text}
    </a>
  )
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

function checkedCell(iso: string | null): ReactNode {
  return iso === null ? <span className="faint">Not checked yet</span> : formatMoment(iso)
}

/** "Carrier shutdowns · 3 topics · 310 searches · 184 need work", and the folder's ⋯. */
function FolderLabel({
  folder,
  group,
  menu
}: {
  folder: DashFolder
  group: ListTreeGroup<DashRow>
  menu: (folder: DashFolder) => readonly MenuItem[]
}): JSX.Element {
  const totals = totalsOf(group.rows)
  const items = menu(folder)
  return (
    <span className="tl-folder">
      <span className="tl-folder-name">{folder.name}</span>
      <span className="tl-folder-meta num">
        {group.rows.length} {group.rows.length === 1 ? 'topic' : 'topics'} · {n(totals.searches)}{' '}
        searches · {n(totals.needsWork)} need work
      </span>
      {items.length > 0 ? (
        // The menu is the folder's own; a click on it must not open or close the row.
        <span
          className="tl-folder-menu"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <MenuButton
            label={`Folder actions for ${folder.name}`}
            items={items}
            trigger={({ ref, ...props }) => (
              <IconButton
                ref={ref}
                {...props}
                icon="dots"
                label={`Folder actions for ${folder.name}`}
                size="sm"
              />
            )}
          />
        </span>
      ) : null}
    </span>
  )
}
