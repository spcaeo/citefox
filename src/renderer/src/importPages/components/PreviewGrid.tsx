import { useMemo, useState, type JSX } from 'react'
import type { ImportCandidate } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillLink, openTarget } from '../../drill'
import { pageHash, structureHash } from '../../shell/routes'
import { HeaderActions } from '../../components/HeaderActions'
import {
  Chip,
  IconButton,
  ListGrid,
  type ListColumn,
  type ListFooterInfo,
  type ListGroup,
  type MenuItem,
  UrlText
} from '../../ui'
import { formatLastmod } from '../utils/preview'
import { candidateTarget, folderName } from '../utils/drills'
import { clusterLabel, displayTitle, rowKey } from '../utils/selection'

type Show = 'all' | 'chosen' | 'out' | 'tracked'

function lastmodValue(row: ImportCandidate): number | null {
  if (!row.lastmod) return null
  const at = Date.parse(row.lastmod)
  return Number.isNaN(at) ? null : at
}

const FOLDER_GROUP: ListGroup<ImportCandidate> = {
  key: (row) => ({ key: row.folder, label: folderName(row.folder) }),
  meta: (rows) => `${pluralize(rows.length, 'page')} in this preview`
}

/**
 * The import preview on the v2 list grid: every page that matches the choices,
 * grouped by folder. Each row has one box, which says whether it is tracked; a
 * row click flips it; "Track all shown" and "Leave all shown out" act on what the
 * search and filter show. Already-tracked
 * pages stay shown and keep their markets, prompts and history.
 */
export function PreviewGrid({
  rows,
  off,
  selectedCount,
  onToggle,
  onSetOff
}: {
  rows: readonly ImportCandidate[]
  off: readonly string[]
  selectedCount: number
  onToggle: (key: string) => void
  onSetOff: (keys: readonly string[], off: boolean) => void
}): JSX.Element {
  const [show, setShow] = useState<Show>('all')
  const [grouped, setGrouped] = useState(true)
  const unticked = useMemo(() => new Set(off), [off])
  const isOn = (row: ImportCandidate): boolean => row.alreadyTracked || !unticked.has(rowKey(row))
  const counts = useMemo(() => {
    let out = 0
    let tracked = 0
    for (const row of rows) {
      if (row.alreadyTracked) tracked += 1
      else if (unticked.has(rowKey(row))) out += 1
    }
    return { all: rows.length, chosen: rows.length - out - tracked, out, tracked }
  }, [rows, unticked])
  const shown = useMemo(
    () =>
      rows.filter((row) => {
        if (show === 'tracked') return row.alreadyTracked
        if (show === 'out') return !row.alreadyTracked && unticked.has(rowKey(row))
        if (show === 'chosen') return !row.alreadyTracked && !unticked.has(rowKey(row))
        return true
      }),
    [rows, show, unticked]
  )
  // One box per row says whether it is tracked; these act on every row the filter shows.
  const shownOn = useMemo(
    () => shown.filter((row) => !row.alreadyTracked && !unticked.has(rowKey(row))).map(rowKey),
    [shown, unticked]
  )
  const shownOff = useMemo(
    () => shown.filter((row) => !row.alreadyTracked && unticked.has(rowKey(row))).map(rowKey),
    [shown, unticked]
  )

  const columns = useMemo<ListColumn<ImportCandidate>[]>(
    () => [
      {
        id: 'track',
        label: 'Track',
        hideLabel: true,
        width: 20,
        render: (row) => (
          <RowCheck
            row={row}
            on={row.alreadyTracked || !unticked.has(rowKey(row))}
            onToggle={onToggle}
          />
        )
      },
      {
        id: 'page',
        label: 'Page',
        width: 'fill',
        minWidth: 220,
        sort: (row) => displayTitle(row).toLowerCase(),
        render: (row) => (
          <span className="imp-page">
            <PageTitle row={row} />
            <UrlText url={row.url} label={row.path} className="imp-path" />
          </span>
        )
      },
      {
        id: 'folder',
        label: 'Folder',
        width: 120,
        cellClassName: 'mono',
        sort: (row) => row.folder.toLowerCase(),
        render: (row) => folderName(row.folder)
      },
      {
        id: 'cluster',
        label: 'Cluster',
        width: 160,
        sort: (row) => row.clusterName?.toLowerCase() ?? null,
        render: (row) => <ClusterLink row={row} />
      },
      {
        id: 'modified',
        label: 'Last modified',
        width: 120,
        sort: lastmodValue,
        render: (row) => formatLastmod(row.lastmod)
      },
      {
        id: 'tracked',
        label: 'Already tracked',
        width: 120,
        sort: (row) => (row.alreadyTracked ? 0 : 1),
        render: (row) =>
          row.alreadyTracked && row.pageId ? (
            <a
              className="imp-tracked-link"
              href={pageHash(row.pageId)}
              aria-label={`Already tracked: open ${displayTitle(row)}`}
            >
              <Chip tone="ok" size="sm">
                Yes
              </Chip>
            </a>
          ) : row.alreadyTracked ? (
            <Chip tone="ok" size="sm">
              Yes
            </Chip>
          ) : (
            <span className="faint">No</span>
          )
      }
    ],
    [unticked, onToggle]
  )

  function rowMenu(row: ImportCandidate): MenuItem[] {
    const items: MenuItem[] = []
    const target = candidateTarget(row)
    if (target) {
      items.push({
        id: 'open',
        label: row.alreadyTracked ? 'Open in CiteFox' : 'Open in your browser',
        icon: row.alreadyTracked ? 'eye' : 'external',
        onSelect: () => openTarget(target)
      })
    }
    if (!row.alreadyTracked) {
      const on = isOn(row)
      items.push({
        id: 'toggle',
        label: on ? 'Leave out' : 'Track this page',
        icon: on ? 'x' : 'plus',
        onSelect: () => onToggle(rowKey(row))
      })
    }
    const clusterId = row.clusterId
    if (clusterId) {
      items.push({
        id: 'cluster',
        label: 'Open its cluster',
        icon: 'layers',
        onSelect: () => {
          window.location.hash = structureHash(clusterId)
        }
      })
    }
    return items
  }

  const summary = (info: ListFooterInfo): string =>
    info.matching < rows.length
      ? `Showing ${info.matching.toLocaleString('en-US')} of ${pluralize(rows.length, 'page')} · ${selectedCount.toLocaleString('en-US')} chosen`
      : `${pluralize(rows.length, 'page')} in this preview · ${selectedCount.toLocaleString('en-US')} chosen`

  return (
    <div className="imp-preview">
      <ListGrid<ImportCandidate>
        label="Pages that match your choices"
        noun={['page', 'pages']}
        rows={shown}
        rowKey={rowKey}
        rowLabel={displayTitle}
        columns={columns}
        search={{
          text: (row) => `${displayTitle(row)}\n${row.path}`,
          placeholder: 'Search the preview by title or path'
        }}
        filter={{
          label: 'Show',
          options: [
            { value: 'all', label: 'All', count: counts.all },
            { value: 'chosen', label: 'Chosen', count: counts.chosen },
            { value: 'out', label: 'Left out', count: counts.out },
            { value: 'tracked', label: 'Already tracked', count: counts.tracked }
          ],
          value: show,
          onChange: (value) => setShow(value as Show)
        }}
        actions={
          <>
            <IconButton
              icon="layers"
              size="sm"
              label="Group by folder"
              data-tip="Group by folder"
              aria-pressed={grouped}
              onClick={() => setGrouped((on) => !on)}
            />
            <HeaderActions
              more={[
                {
                  id: 'pv-track-all',
                  label: 'Track all shown',
                  icon: 'check',
                  disabled: shownOff.length === 0,
                  onSelect: () => onSetOff(shownOff, false)
                },
                {
                  id: 'pv-leave-all',
                  label: 'Leave all shown out',
                  icon: 'x',
                  disabled: shownOn.length === 0,
                  onSelect: () => onSetOff(shownOn, true)
                }
              ]}
              moreLabel="Preview actions"
            />
          </>
        }
        {...(grouped ? { group: FOLDER_GROUP } : {})}
        initialSort={[{ key: 'modified', dir: 'desc' }]}
        pageSize="all"
        maxBodyHeight={440}
        summary={summary}
        rowMenu={rowMenu}
        onActivate={(row) => {
          if (!row.alreadyTracked) onToggle(rowKey(row))
        }}
        empty={
          <p className="imp-empty muted">
            No pages chosen yet. Tick a folder, add a rule or use a quick pick.
          </p>
        }
      />
      <p className="hint">
        Pages already tracked keep their current markets, questions and history. A page you leave
        out stays out while it&apos;s hidden by search or the filter.
      </p>
    </div>
  )
}

function RowCheck({
  row,
  on,
  onToggle
}: {
  row: ImportCandidate
  on: boolean
  onToggle: (key: string) => void
}): JSX.Element {
  const title = displayTitle(row)
  return (
    <input
      type="checkbox"
      className="ui-check"
      checked={on}
      disabled={row.alreadyTracked}
      aria-label={row.alreadyTracked ? `${title} is already tracked` : `Track ${title}`}
      onChange={() => onToggle(rowKey(row))}
      onKeyDown={(event) => event.stopPropagation()}
    />
  )
}

/** A tracked page opens in CiteFox; any other page opens in the browser. */
function PageTitle({ row }: { row: ImportCandidate }): JSX.Element {
  const target = candidateTarget(row)
  if (!target) return <span className="imp-title">{displayTitle(row)}</span>
  return (
    <DrillLink className="imp-title" target={target}>
      {displayTitle(row)}
    </DrillLink>
  )
}

/** The cluster opens its pages on Site structure. */
function ClusterLink({ row }: { row: ImportCandidate }): JSX.Element {
  if (!row.clusterId) return <span className="faint">{clusterLabel(row)}</span>
  return (
    <a
      className="imp-cluster"
      href={structureHash(row.clusterId)}
      aria-label={`Cluster ${clusterLabel(row)} on Site structure`}
    >
      {clusterLabel(row)}
    </a>
  )
}
