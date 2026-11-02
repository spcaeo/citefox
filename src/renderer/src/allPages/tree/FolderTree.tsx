import { useMemo, type JSX } from 'react'
import type { SiloSummary } from '@shared/domain'
import type { AllPageRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillButton, type ItemDrill } from '../../drill'
import { navigateHash, pagesHash } from '../../shell/routes'
import type { StructureClient } from '../../structure/client'
import type { StructureState } from '../../structure/hooks/useStructure'
import { pagesDrill } from '../../structure/utils/drills'
import { siloMarketItems, siloMarketsText } from '../../structure/utils/siloMenu'
import {
  EmptyState,
  ListGrid,
  RowMenu,
  UrlText,
  type ListColumn,
  type ListTree,
  type ListTreeGroup
} from '../../ui'
import { pathOf } from '../utils/format'
import { rowName, statusText } from '../utils/text'
import { buildPageTree, folderOrder, folderTrails, type TreeFolder } from './model'
import './tree.css'

const WORKING = new Set(['tracked', 'setting_up', 'paused'])

function sum(rows: readonly AllPageRow[], value: (row: AllPageRow) => number | null): number {
  return rows.reduce((total, row) => total + (value(row) ?? 0), 0)
}

/** The pages behind a folder's count, one row each, so the drawer total is the count clicked. */
function folderDrill(
  group: ListTreeGroup<AllPageRow> | null,
  rows: readonly AllPageRow[],
  which: 'all' | 'tracked'
): ItemDrill {
  const where = group ? group.key : 'the whole site'
  const pages = which === 'all' ? rows : rows.filter((row) => WORKING.has(row.status))
  return pagesDrill({
    id: `tree-${which}:${group?.key ?? '/'}`,
    title: which === 'all' ? `Pages in ${where}` : `Tracked pages in ${where}`,
    description:
      which === 'all'
        ? 'Every page in this folder and the folders under it.'
        : 'Pages in this folder and the folders under it that are tracked, setting up or paused.',
    pages: pages.map((row) => ({
      pageId: row.id,
      url: row.url,
      title: rowName(row),
      status: row.status,
      score: row.score
    }))
  })
}

/**
 * Pages · Tree · Folders: every found page in its URL folders, like a site
 * structure report, with totals per folder that add up to the footer. A
 * folder row keeps the old Silos actions: Track all (every page in it, and
 * pages the sitemap adds later) and the markets its new pages get.
 */
export function FolderTree({
  rows,
  domain,
  client,
  projectId,
  structure,
  onOpenPage,
  onCited
}: {
  rows: readonly AllPageRow[]
  domain: string
  client: StructureClient
  projectId: string
  structure: StructureState
  onOpenPage: (row: AllPageRow) => void
  /** Opens the searches citing one page (All pages' Page cited drill). */
  onCited: (row: AllPageRow) => void
}): JSX.Element {
  const root = useMemo(() => buildPageTree(rows), [rows])
  const trails = useMemo(() => folderTrails(root), [root])
  const order = useMemo(() => folderOrder(root), [root])
  const leaves = useMemo(() => rows.filter((row) => trails.has(row.id)), [rows, trails])
  const silos = useMemo(
    () =>
      new Map<string, SiloSummary>((structure.view?.silos ?? []).map((silo) => [silo.path, silo])),
    [structure.view]
  )
  const disabled = structure.busy !== null

  function trackAll(silo: SiloSummary, on: boolean): void {
    void structure.run('Track silo', () =>
      client['structure:setSilo']({ projectId, path: silo.path, trackAll: on })
    )
  }

  function setMarkets(silo: SiloSummary, marketIds: string[] | null): void {
    void structure.run('Save silo markets', () =>
      client['structure:setSilo']({ projectId, path: silo.path, marketIds })
    )
  }

  const columns: ListColumn<AllPageRow>[] = [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 260,
      sort: (row) => pathOf(row.url).toLowerCase(),
      render: (row) => (
        <span className="apt-page">
          <span className="apt-page-name">{rowName(row)}</span>
          <UrlText path={pathOf(row.url)} siteBase={domain} />
        </span>
      )
    },
    {
      id: 'pages',
      label: 'Pages',
      width: 88,
      numeric: true,
      sort: false,
      render: () => null,
      total: (list, group) => {
        const drill = folderDrill(group, list, 'all')
        return (
          <DrillButton
            className="dg-drill num"
            label={`${pluralize(list.length, 'page')} in ${group?.key ?? 'the whole site'}`}
            drill={drill}
          >
            <span data-nfr-figure={drill.id}>{list.length.toLocaleString('en-US')}</span>
          </DrillButton>
        )
      },
      totalSort: (list) => list.length
    },
    {
      id: 'status',
      label: 'Tracked',
      width: 132,
      sort: (row) => (WORKING.has(row.status) ? 1 : 0),
      render: (row) => <span className="apt-status">{statusText(row)}</span>,
      total: (list, group) => {
        const tracked = list.filter((row) => WORKING.has(row.status)).length
        if (tracked === 0) return <span className="muted">None tracked</span>
        const drill = folderDrill(group, list, 'tracked')
        return (
          <DrillButton
            className="dg-drill"
            label={`${pluralize(tracked, 'tracked page')} in ${group?.key ?? 'the whole site'}`}
            drill={drill}
          >
            <span data-nfr-figure={drill.id}>{tracked.toLocaleString('en-US')}</span> tracked
          </DrillButton>
        )
      },
      totalSort: (list) => list.filter((row) => WORKING.has(row.status)).length
    },
    {
      id: 'cited',
      label: 'Cited in',
      hint: 'Searches whose AI Overview cites the page, in its latest check',
      width: 96,
      numeric: true,
      sort: (row) => row.pageCited,
      drill: (row) =>
        row.pageCited && row.pageCited > 0
          ? {
              label: `${pluralize(row.pageCited, 'search', 'searches')} cite ${rowName(row)}`,
              onOpen: () => onCited(row)
            }
          : null,
      render: (row) => (row.pageCited === null ? '—' : row.pageCited.toLocaleString('en-US')),
      total: (list) => sum(list, (row) => row.pageCited).toLocaleString('en-US'),
      totalSort: (list) => sum(list, (row) => row.pageCited)
    },
    {
      id: 'aio',
      label: 'AI Overviews',
      hint: 'Searches with an AI Overview, in the latest check',
      width: 112,
      numeric: true,
      priority: 'low',
      sort: (row) => row.aioPrompts,
      render: (row) => (row.aioPrompts === null ? '—' : row.aioPrompts.toLocaleString('en-US')),
      total: (list) => sum(list, (row) => row.aioPrompts).toLocaleString('en-US'),
      totalSort: (list) => sum(list, (row) => row.aioPrompts)
    },
    {
      id: 'trackAll',
      label: 'Track all',
      hint: 'Track every page in the folder, and the pages the sitemap adds later',
      width: 88,
      sort: false,
      render: () => null,
      total: (_list, group) => {
        const silo = group ? silos.get(group.key) : undefined
        if (!silo) return null
        return (
          <input
            type="checkbox"
            className="ui-check"
            checked={silo.trackAll}
            disabled={disabled}
            aria-label={`Track every page in ${silo.path}`}
            onChange={(event) => trackAll(silo, event.currentTarget.checked)}
          />
        )
      }
    },
    {
      id: 'markets',
      label: 'Markets for new pages',
      width: 240,
      priority: 'low',
      sort: false,
      render: () => null,
      total: (_list, group) => {
        const silo = group ? silos.get(group.key) : undefined
        if (!silo) return null
        const text = siloMarketsText(silo, structure.markets)
        return (
          <span className="apt-markets">
            <span className="apt-clip" title={text}>
              {text}
            </span>
            <RowMenu
              label={`Actions for ${silo.path}`}
              width={280}
              items={[
                // The list filters by top-level folder only.
                ...(silo.depth === 1
                  ? [
                      {
                        id: 'open',
                        label: 'Open in the list',
                        icon: 'arrow-right' as const,
                        onSelect: () => navigateHash(pagesHash({ view: 'list', folder: silo.path }))
                      }
                    ]
                  : []),
                ...siloMarketItems(silo, structure.markets, disabled, (ids) =>
                  setMarkets(silo, ids)
                ).map((item, index) =>
                  index === 0 ? { ...item, groupStart: silo.depth === 1 } : item
                )
              ]}
            />
          </span>
        )
      }
    }
  ]

  const tree: ListTree<AllPageRow> = {
    path: (row) =>
      (trails.get(row.id) ?? []).map((folder: TreeFolder) => ({
        key: folder.path,
        label: folder.path
      })),
    order,
    renderGroup: (group) => (
      <span className="apt-folder">
        <UrlText path={group.key} siteBase={domain} />
      </span>
    )
  }

  return (
    <div className="apt-folders">
      <ListGrid
        label="Folders"
        noun={['page', 'pages']}
        rows={leaves}
        rowKey={(row) => row.id}
        rowLabel={rowName}
        columns={columns}
        urlKey="tree"
        columnsMenu
        tree={tree}
        search={{
          text: (row) => `${rowName(row)} ${pathOf(row.url)}`,
          placeholder: `Search ${leaves.length.toLocaleString('en-US')} pages`
        }}
        onActivate={onOpenPage}
        footer="always"
        empty={
          <EmptyState
            icon="layers"
            title="No pages yet"
            body="Folders appear after the first sitemap sync."
          />
        }
      />
    </div>
  )
}
