import { useMemo, useState, type JSX } from 'react'
import type { ClusterSummary, SitemapSyncReport, SyncPageChange } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { openTarget } from '../../drill'
import { pagesHash, structureHash } from '../../shell/routes'
import {
  Button,
  Chip,
  EmptyState,
  ListGrid,
  UrlText,
  type ListColumn,
  type MenuItem
} from '../../ui'
import type { StructureClient } from '../client'
import { FULL_PAGE_BODY, PAGE_ROWS, QUICK_TRACK } from '../constants'
import type { RunAction } from '../types'
import { count, dayTime, pagePath, sitemapFile, syncCounts } from '../utils/model'

type ChangeKind = 'new' | 'removed' | 'changed'

interface ChangeRow {
  kind: ChangeKind
  change: SyncPageChange
}

const KIND_LABELS: Readonly<Record<ChangeKind, string>> = {
  new: 'New pages',
  removed: 'Removed',
  changed: 'Changed'
}

function where(change: SyncPageChange): string {
  const parts: string[] = []
  if (change.sitemapUrl) parts.push(sitemapFile(change.sitemapUrl))
  if (change.lastmod) parts.push(`lastmod ${change.lastmod.slice(0, 10)}`)
  return parts.join(' · ')
}

/** The Last sync tab: new, removed and changed pages as one grid grouped by change. */
export function SyncReport({
  client,
  projectId,
  report,
  marketLabel,
  clusters = [],
  run,
  busy
}: {
  client: StructureClient
  projectId: string
  report: SitemapSyncReport | null
  marketLabel: string
  /** To link a page's cluster tag to that cluster's pages. */
  clusters?: readonly ClusterSummary[]
  run: RunAction
  busy: string | null
}): JSX.Element {
  const [trackedNow, setTrackedNow] = useState<ReadonlySet<string>>(new Set())
  const rows = useMemo<ChangeRow[]>(
    () =>
      report
        ? [
            ...report.newPages.map((change) => ({ kind: 'new' as const, change })),
            ...report.removedPages.map((change) => ({ kind: 'removed' as const, change })),
            ...report.changedPages
              .filter((change) => change.wasTracked)
              .map((change) => ({ kind: 'changed' as const, change }))
          ]
        : [],
    [report]
  )

  if (!report) {
    return (
      <section className="ui-lg" aria-label="Last sync">
        <EmptyState
          icon="refresh"
          title="No sync yet"
          body="Sync now reads your sitemaps and lists the pages that came, went or changed."
        />
      </section>
    )
  }

  const isTracked = (change: SyncPageChange): boolean =>
    change.action === 'tracked' || (change.pageId !== null && trackedNow.has(change.pageId))
  const canTrack = (row: ChangeRow): boolean =>
    row.kind === 'new' && row.change.pageId !== null && !isTracked(row.change)
  const waiting = rows.filter(canTrack)
  const disabled = busy !== null
  const changedUntracked = report.changedCount - rows.filter((row) => row.kind === 'changed').length

  async function track(pageIds: string[]): Promise<boolean> {
    const result = await run('Track pages', () =>
      client['import:track']({ projectId, pageIds, urls: [], markets: [], ...QUICK_TRACK })
    )
    if (result) setTrackedNow((current) => new Set([...current, ...pageIds]))
    return result !== null
  }

  function status(row: ChangeRow): JSX.Element {
    const { change } = row
    if (row.kind === 'new') {
      return isTracked(change) ? (
        <Chip tone="ok" size="sm">
          Tracked · {marketLabel}
        </Chip>
      ) : (
        <span className="str-muted">Not tracked</span>
      )
    }
    if (row.kind === 'removed') {
      return (
        <span className="str-muted">
          {change.action === 'paused' ? 'Tracking paused · history kept' : 'Removed'}
        </span>
      )
    }
    return (
      <span className="str-muted">
        {change.action === 'reread_queued' ? 'Page re-read queued' : 'New date saved'}
      </span>
    )
  }

  const columns: ListColumn<ChangeRow>[] = [
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 220,
      sort: (row) => pagePath(row.change.url),
      render: (row) => <UrlText url={row.change.url} label={pagePath(row.change.url)} />
    },
    {
      id: 'where',
      label: 'Where',
      width: 200,
      render: (row) => (
        <span className="str-muted str-clip">
          {row.kind === 'removed'
            ? row.change.sitemapUrl
              ? `Gone from ${sitemapFile(row.change.sitemapUrl)}`
              : 'Gone'
            : where(row.change)}
        </span>
      )
    },
    {
      id: 'cluster',
      label: 'Cluster',
      width: 160,
      render: (row) =>
        row.change.clusterName ? (
          <ClusterTag name={row.change.clusterName} clusters={clusters} />
        ) : row.kind === 'removed' && row.change.wasTracked ? (
          <Chip size="sm">Was tracked</Chip>
        ) : (
          <span className="str-muted">—</span>
        )
    },
    { id: 'status', label: 'Status', width: 200, render: status }
  ]

  function rowMenu(row: ChangeRow): MenuItem[] {
    const { change } = row
    const items: MenuItem[] = []
    if (canTrack(row)) {
      items.push({
        id: 'track',
        label: `Track · ${marketLabel}`,
        icon: 'plus',
        disabled,
        onSelect: () => void track([change.pageId ?? ''])
      })
    }
    items.push(
      change.pageId !== null
        ? {
            id: 'open',
            label: 'Open the page',
            icon: 'arrow-right',
            onSelect: () => openTarget({ kind: 'page', pageId: change.pageId ?? '' })
          }
        : {
            id: 'open',
            label: 'Open in your browser',
            icon: 'external',
            onSelect: () => openTarget({ kind: 'url', url: change.url })
          }
    )
    return items
  }

  const more = report.newCount - report.newPages.length

  return (
    <div className="page-stack str-sync">
      {report.problems.length > 0 || report.nextStep ? (
        <div className="str-alert" role="status">
          <div>
            {report.problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
            {report.nextStep ? <p>{report.nextStep}</p> : null}
          </div>
        </div>
      ) : null}
      <ListGrid
        label={`Sync report · ${dayTime(report.finishedAt)}`}
        noun={['page', 'pages']}
        rows={rows}
        rowKey={(row) => `${row.kind}:${row.change.url}`}
        rowLabel={(row) => pagePath(row.change.url)}
        columns={columns}
        search={{ text: (row) => row.change.url, placeholder: 'Search pages in this sync' }}
        toolbar={
          <span className="str-bar-note">
            {pluralize(report.sitemapsRead, 'sitemap')} read · {pluralize(report.pageCount, 'page')}
          </span>
        }
        actions={
          waiting.length > 1 ? (
            <Button
              size="sm"
              icon="plus"
              disabled={disabled}
              onClick={() =>
                void track(waiting.flatMap((row) => (row.change.pageId ? [row.change.pageId] : [])))
              }
            >
              Track all {count(waiting.length)} · {marketLabel}
            </Button>
          ) : null
        }
        group={{
          key: (row) => ({ key: row.kind, label: KIND_LABELS[row.kind] }),
          order: ['new', 'removed', 'changed'],
          meta: (_rows, key) =>
            key === 'new' && more > 0
              ? `${count(report.newCount)} in all`
              : key === 'changed' && changedUntracked > 0
                ? `${pluralize(changedUntracked, 'untracked page')} got their new date`
                : null
        }}
        bulk={({ selected, clear }) => {
          const ids = selected.filter(canTrack).flatMap((row) => row.change.pageId ?? [])
          return (
            <Button
              size="sm"
              icon="plus"
              disabled={disabled || ids.length === 0}
              onClick={() =>
                void track(ids).then((ok) => {
                  if (ok) clear()
                })
              }
            >
              Track {ids.length > 0 ? pluralize(ids.length, 'page') : 'pages'} · {marketLabel}
            </Button>
          )
        }}
        rowMenu={rowMenu}
        onActivate={(row) =>
          openTarget(
            row.change.pageId !== null
              ? { kind: 'page', pageId: row.change.pageId }
              : { kind: 'url', url: row.change.url }
          )
        }
        pageSize={PAGE_ROWS}
        maxBodyHeight={FULL_PAGE_BODY}
        summary={() => (
          <>
            {syncCounts(report)}
            {more > 0 ? (
              <>
                {' · '}
                <a href={pagesHash({ view: 'untracked' })}>And {count(more)} more in All pages.</a>
              </>
            ) : null}
          </>
        )}
        empty={
          <EmptyState
            icon="check"
            title="Nothing changed in this sync"
            body={`${pluralize(report.sitemapsRead, 'sitemap')} read · ${pluralize(report.pageCount, 'page')}`}
          />
        }
      />
    </div>
  )
}

function ClusterTag({
  name,
  clusters
}: {
  name: string
  clusters: readonly ClusterSummary[]
}): JSX.Element {
  const cluster = clusters.find((item) => item.name === name)
  if (!cluster) return <span className="str-muted str-clip">Cluster: {name}</span>
  return (
    <a
      className="str-tag-link str-clip"
      href={structureHash(cluster.id)}
      aria-label={`Cluster: ${name}. Show its pages`}
    >
      {name}
    </a>
  )
}
