import { useMemo, useState, type JSX } from 'react'
import type { ClusterMaker, ClusterSummary } from '@shared/domain'
import type { StructureView } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { useAiContext } from '../../assistant/context/useAiContext'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { openDrawer, useDrawerStack } from '../../shell/drawers'
import { pageHash } from '../../shell/routes'
import {
  Button,
  Chip,
  Confirm,
  EmptyState,
  ListGrid,
  SegmentedControl,
  type ListColumn,
  type MenuItem
} from '../../ui'
import type { StructureClient } from '../client'
import type { MoveResult } from '../drawers'
import { VIEW_HINTS } from '../constants'
import type { StructureDrills } from '../hooks/useStructureDrills'
import type { ClusterTracking, RunAction } from '../types'
import { clusterTracking, pagePath, scoreChangeLabel, TRACKING_LABELS } from '../utils/model'
import { AutoCluster } from './AutoCluster'
import { ClusterEditBar, type ClusterEdit } from './ClusterEditBar'
import { AverageScore, PageCount, ThemeTags } from './ClusterDrills'

const TRACKINGS: readonly ClusterTracking[] = ['whole', 'some', 'none']
const MAKERS: readonly ClusterMaker[] = ['rules', 'claude', 'user']
const MAKER_SHORT: Readonly<Record<ClusterMaker, string>> = {
  rules: 'CiteFox',
  claude: 'CiteFox AI',
  user: 'You'
}

function pillarName(cluster: ClusterSummary): string | null {
  if (!cluster.pillarTitle && !cluster.pillarUrl) return null
  return cluster.pillarTitle ?? pagePath(cluster.pillarUrl ?? '')
}

/**
 * FR-19.5. Clusters as one list grid. A cluster's pages open in the 80%
 * cluster drawer (`drawer=cluster&cluster.id=…`); New cluster picks its pages
 * in the page picker drawer.
 */
export function ClustersView({
  client,
  projectId,
  view,
  marketLabel,
  drills,
  run,
  busy
}: {
  client: StructureClient
  projectId: string
  view: StructureView
  marketLabel: string
  drills: StructureDrills
  run: RunAction
  busy: string | null
}): JSX.Element {
  const [tracking, setTracking] = useState<ClusterTracking | 'all'>('all')
  const [maker, setMaker] = useState<ClusterMaker | 'all'>('all')
  const { stack } = useDrawerStack()
  const openId = stack.find((entry) => entry.id === 'cluster')?.params['cluster.id'] ?? null
  const openPages = (clusterId: string): void => openDrawer('cluster', { 'cluster.id': clusterId })
  const [edit, setEdit] = useState<ClusterEdit | null>(null)
  const [merge, setMerge] = useState<{ text: string } | null>(null)
  const [deleting, setDeleting] = useState<ClusterSummary | null>(null)
  const disabled = busy !== null

  const rows = useMemo(
    () =>
      view.clusters.filter(
        (cluster) =>
          (tracking === 'all' || clusterTracking(cluster) === tracking) &&
          (maker === 'all' || cluster.madeBy === maker)
      ),
    [view.clusters, tracking, maker]
  )

  useAiContext({
    filters: tracking === 'all' ? {} : { tracking: TRACKING_LABELS[tracking] }
  })
  const columns: ListColumn<ClusterSummary>[] = [
    {
      id: 'name',
      label: 'Cluster',
      width: 'fill',
      minWidth: 180,
      sort: (cluster) => cluster.name.toLowerCase(),
      render: (cluster) => (
        <span className="str-name-cell">
          <button
            type="button"
            className="str-row-link"
            aria-label={`Show pages of ${cluster.name}`}
            onClick={() => openPages(cluster.id)}
          >
            {cluster.name}
          </button>
          {cluster.madeBy === 'claude' ? (
            <Chip size="sm" label="Made by">
              CiteFox AI
            </Chip>
          ) : null}
          {cluster.editedByUser && cluster.madeBy !== 'user' ? (
            <Chip size="sm" tone="info">
              Edited by you
            </Chip>
          ) : null}
        </span>
      )
    },
    {
      id: 'pillar',
      label: 'Pillar',
      width: 180,
      sort: (cluster) => pillarName(cluster)?.toLowerCase() ?? null,
      render: (cluster) => {
        const name = pillarName(cluster)
        if (!name) return <span className="str-muted">Not chosen yet</span>
        return cluster.pillarPageId ? (
          <a className="str-clip str-link-quiet" href={pageHash(cluster.pillarPageId)}>
            {name}
          </a>
        ) : (
          <span className="str-clip">{name}</span>
        )
      }
    },
    {
      id: 'pages',
      label: 'Pages',
      width: 72,
      numeric: true,
      sort: (cluster) => cluster.pageCount,
      render: (cluster) => <PageCount drills={drills} cluster={cluster} part="all" />
    },
    {
      id: 'tracked',
      label: 'Tracked',
      width: 72,
      numeric: true,
      sort: (cluster) => cluster.trackedCount,
      render: (cluster) => <PageCount drills={drills} cluster={cluster} part="tracked" />
    },
    {
      id: 'score',
      label: 'Avg score',
      width: 104,
      numeric: true,
      sort: (cluster) => cluster.averageScore,
      render: (cluster) => {
        const change = scoreChangeLabel(cluster.scoreChange)
        return (
          <span className="str-score">
            <AverageScore drills={drills} cluster={cluster} />
            {change ? <span className="str-change">{change}</span> : null}
          </span>
        )
      }
    },
    {
      id: 'themes',
      label: 'Themes',
      width: 190,
      render: (cluster) =>
        cluster.themes.length > 0 ? (
          <span className="str-clip">
            <ThemeTags cluster={cluster} separator=" · " />
          </span>
        ) : (
          <span className="str-muted">—</span>
        )
    }
  ]

  /** Pick pages for a cluster (new, add, pillar); its message shows on the note line. */
  function pick(target: string): void {
    openDrawer(
      'pick-pages',
      { 'pick.for': target },
      {
        onResult: (result) => {
          const message = (result as MoveResult | undefined)?.message
          if (message) setMerge({ text: message })
        }
      }
    )
  }

  function rowMenu(cluster: ClusterSummary): MenuItem[] {
    const items: MenuItem[] = [
      {
        id: 'pages',
        label: 'Show pages',
        icon: 'layers',
        onSelect: () => openPages(cluster.id)
      },
      {
        id: 'pillar',
        label: cluster.pillarPageId ? 'Change pillar…' : 'Set pillar…',
        icon: 'target',
        disabled: cluster.pageCount === 0,
        onSelect: () => pick(`pillar:${cluster.id}`)
      },
      {
        id: 'add',
        label: 'Add pages…',
        icon: 'plus',
        onSelect: () => pick(`cluster:${cluster.id}`)
      },
      {
        id: 'track',
        label: cluster.trackWhole ? 'Stop tracking the whole cluster' : 'Track cluster',
        icon: cluster.trackWhole ? 'x' : 'plus',
        disabled,
        onSelect: () =>
          void run('Track cluster', () =>
            client['structure:trackCluster']({
              projectId,
              clusterId: cluster.id,
              track: !cluster.trackWhole
            })
          )
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'pencil',
        onSelect: () => setEdit({ mode: 'rename', cluster })
      }
    ]
    if (view.clusters.length > 1) {
      items.push({
        id: 'merge',
        label: 'Merge into another cluster',
        icon: 'merge',
        onSelect: () => setEdit({ mode: 'merge', cluster })
      })
    }
    items.push({
      id: 'delete',
      label: 'Delete cluster',
      icon: 'trash',
      tone: 'danger',
      groupStart: true,
      onSelect: () => setDeleting(cluster)
    })
    return items
  }

  async function deleteCluster(cluster: ClusterSummary): Promise<void> {
    const done = await run('Delete cluster', () =>
      client['structure:deleteCluster']({ projectId, clusterId: cluster.id })
    )
    setDeleting(null)
    if (done) setMerge({ text: `Deleted “${cluster.name}”. Its pages are unclustered now.` })
  }

  const trackingOptions = [
    { value: 'all', label: 'All', count: view.clusters.length },
    ...TRACKINGS.map((item) => ({
      value: item,
      label: TRACKING_LABELS[item],
      count: view.clusters.filter((cluster) => clusterTracking(cluster) === item).length
    }))
  ]

  return (
    <div className="page-stack str-clusters">
      <AutoCluster client={client} projectId={projectId} view={view} run={run} busy={busy} />
      {merge ? (
        <div className="str-note" role="status">
          <p>{merge.text}</p>
          {view.canUndoClusters ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                void run('Undo clusters', () =>
                  client['structure:undoClusters']({ projectId })
                ).then((done) => {
                  if (done) setMerge(null)
                })
              }
            >
              Undo
            </Button>
          ) : null}
        </div>
      ) : null}
      {edit ? (
        <ClusterEditBar
          key={`${edit.mode}:${edit.cluster.id}`}
          client={client}
          projectId={projectId}
          edit={edit}
          clusters={view.clusters}
          run={run}
          busy={busy}
          onDone={(note) => {
            setEdit(null)
            if (note) setMerge({ text: `Merged “${note.fromName}” into “${note.intoName}”.` })
          }}
        />
      ) : null}
      <ListGrid
        label="Clusters"
        noun={['cluster', 'clusters']}
        rows={rows}
        rowKey={(cluster) => cluster.id}
        rowLabel={(cluster) => cluster.name}
        columns={[
          ...columns,
          askColumn<ClusterSummary>((cluster) => ({
            kind: 'group',
            id: cluster.id,
            label: cluster.name,
            detail: `Cluster · ${pluralize(cluster.pageCount, 'page')}`
          }))
        ]}
        search={{
          text: (cluster) => [cluster.name, cluster.pillarTitle ?? '', ...cluster.themes].join(' '),
          placeholder: 'Search clusters, pillars or themes'
        }}
        filter={{
          label: 'Tracking',
          options: trackingOptions,
          value: tracking,
          onChange: (value) => setTracking(value as ClusterTracking | 'all')
        }}
        actions={
          <Button size="sm" icon="plus" onClick={() => pick('cluster:new')}>
            New cluster
          </Button>
        }
        toolbar={
          <SegmentedControl
            label="Made by"
            size="sm"
            options={[
              { value: 'all', label: 'Anyone' },
              ...MAKERS.map((item) => ({
                value: item,
                label: MAKER_SHORT[item],
                count: view.clusters.filter((cluster) => cluster.madeBy === item).length
              }))
            ]}
            value={maker}
            onChange={(value) => setMaker(value as ClusterMaker | 'all')}
          />
        }
        rowMenu={rowMenu}
        onActivate={(cluster) => openPages(cluster.id)}
        isRowCurrent={(cluster) => cluster.id === openId}
        initialSort={[{ key: 'pages', dir: 'desc' }]}
        summary={(info) =>
          `${pluralize(info.matching, 'cluster')} · ${view.clusters.filter((c) => c.trackWhole).length} tracked whole in ${marketLabel}`
        }
        empty={
          view.clusters.length === 0 ? (
            <EmptyState
              icon="layers"
              title="No clusters yet"
              body="Use “Group by rules” for a quick start, or Auto-cluster with CiteFox AI from the AI menu."
            />
          ) : (
            <EmptyState
              title="No clusters match these filters"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setTracking('all')
                    setMaker('all')
                  }}
                >
                  Show all clusters
                </Button>
              }
            />
          )
        }
      />
      <p className="str-hint">{VIEW_HINTS.clusters}</p>
      {deleting ? (
        <Confirm
          title={`Delete ${deleting.name}?`}
          body={`Its ${pluralize(deleting.pageCount, 'page')} become unclustered. Pages, tracking and history stay. Undo brings it back.`}
          confirmLabel="Delete cluster"
          busy={busy === 'Delete cluster'}
          onConfirm={() => void deleteCluster(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  )
}
