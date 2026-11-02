import { useMemo, type JSX } from 'react'

import type { ClusterSummary, Market } from '@shared/domain'
import type { ClusterSummaryList } from '@shared/ipc'
import { NO_VALUE } from '../../grid'
import { pageHash, pagesHash, structureHash } from '../../shell/routes'
import { marketLabel } from '../../shell/model'
import { ListGrid, SectionHead, type ListColumn, type MenuItem } from '../../ui'
import { changeClass, changeLabel } from '../utils/format'
import { pluralize } from '@shared/pluralize'

/**
 * Clusters at a glance (Mockups/Home.dc.html "Clusters") on the v2 list grid:
 * each name opens the cluster in Site structure, the page count filters the
 * pages list to its pages, and the weakest market opens the pillar page's
 * Markets tab in that market.
 */
export function ClustersSection({
  list,
  markets,
  onShowGrid
}: {
  list: ClusterSummaryList
  markets: ReadonlyMap<string, Market>
  onShowGrid: () => void
}): JSX.Element | null {
  const columns = useMemo<ListColumn<ClusterSummary>[]>(
    () => [
      {
        id: 'name',
        label: 'Cluster',
        width: 'fill',
        minWidth: 180,
        sort: (cluster) => cluster.name.toLowerCase(),
        render: (cluster) => (
          <a className="dg-link" href={structureHash(cluster.id)}>
            {cluster.name}
          </a>
        )
      },
      {
        id: 'tracked',
        label: 'Tracked',
        width: 96,
        numeric: true,
        sort: (cluster) => cluster.trackedCount,
        render: (cluster) => (
          <a
            className="drill-num"
            href={pagesHash({ cluster: cluster.id })}
            aria-label={`${cluster.trackedCount} of ${pluralize(cluster.pageCount, 'page')} tracked in ${cluster.name}: show its pages`}
            onClick={onShowGrid}
          >
            {cluster.trackedCount} of {cluster.pageCount}
          </a>
        )
      },
      {
        id: 'score',
        label: 'Avg score',
        width: 88,
        numeric: true,
        sort: (cluster) => cluster.averageScore,
        render: (cluster) => cluster.averageScore ?? NO_VALUE
      },
      {
        id: 'change',
        label: 'Change',
        width: 80,
        numeric: true,
        sort: (cluster) => cluster.scoreChange,
        render: (cluster) => (
          <span className={changeClass(cluster.scoreChange)}>
            {changeLabel(cluster.scoreChange)}
          </span>
        )
      },
      {
        id: 'weakest',
        label: 'Weakest market',
        width: 180,
        sort: (cluster) => cluster.weakestMarket?.score ?? null,
        render: (cluster) => <Weakest cluster={cluster} markets={markets} />
      }
    ],
    [markets, onShowGrid]
  )
  if (list.clusters.length === 0) return null
  const more = list.totalClusters - list.clusters.length

  function rowMenu(cluster: ClusterSummary): MenuItem[] {
    const go = (hash: string) => () => {
      window.location.hash = hash
    }
    const items: MenuItem[] = [
      {
        id: 'structure',
        label: 'Open in Site structure',
        icon: 'layers',
        onSelect: go(structureHash(cluster.id))
      },
      {
        id: 'pages',
        label: 'Show its pages',
        icon: 'eye',
        onSelect: () => {
          window.location.hash = pagesHash({ cluster: cluster.id })
          onShowGrid()
        }
      }
    ]
    const weakest = cluster.weakestMarket
    if (weakest && cluster.pillarPageId) {
      items.push({
        id: 'weakest',
        label: 'Open the weakest market',
        icon: 'target',
        onSelect: go(pageHash(cluster.pillarPageId, 'markets', { marketId: weakest.marketId }))
      })
    }
    return items
  }

  return (
    <section className="ap-section" aria-labelledby="ap-clusters-title">
      <SectionHead
        id="ap-clusters-title"
        title="Clusters"
        description={
          <>
            Topic clusters from Site structure. Scores are the mean of tracked pages in each
            page&apos;s default market.
            {more > 0 ? (
              <>
                {' '}
                Showing {list.clusters.length} of {pluralize(list.totalClusters, 'cluster')}.{' '}
                <a className="dg-link" href={structureHash()}>
                  See all in Site structure
                </a>
              </>
            ) : null}
          </>
        }
      />
      <ListGrid<ClusterSummary>
        label="Clusters"
        noun={['cluster', 'clusters']}
        rows={list.clusters}
        rowKey={(cluster) => cluster.id}
        rowLabel={(cluster) => cluster.name}
        columns={columns}
        rowMenu={rowMenu}
        pageSize="all"
        // At most 8 clusters: drawn in full, so the page is the only scroll (deep audit 7h).
        virtualize={false}
        empty={<p className="ap-empty">No clusters yet.</p>}
      />
    </section>
  )
}

function Weakest({
  cluster,
  markets
}: {
  cluster: ClusterSummary
  markets: ReadonlyMap<string, Market>
}): JSX.Element {
  const weakest = cluster.weakestMarket
  if (weakest === null) return <span className="faint">{NO_VALUE}</span>
  const market = markets.get(weakest.marketId)
  const name = market ? marketLabel(market) : weakest.marketId
  if (!cluster.pillarPageId) {
    return (
      <span>
        {name} · {weakest.score}
      </span>
    )
  }
  return (
    <a
      className="dg-link"
      href={pageHash(cluster.pillarPageId, 'markets', { marketId: weakest.marketId })}
      aria-label={`${name} · ${weakest.score}: weakest market, open the pillar page's Markets tab`}
    >
      {name} · {weakest.score}
    </a>
  )
}
