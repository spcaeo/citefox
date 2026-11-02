import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import type { ProjectDetail } from '@shared/ipc'
import { useAiContext } from '../assistant/context/useAiContext'
import { LoadError } from '../components/LoadError'
import { marketLabel } from '../shell/model'
import { drawerHref, useDrawerStack } from '../shell/drawers'
import {
  navigateHash,
  replaceHash,
  sectionHash,
  structureHash,
  type StructurePart
} from '../shell/routes'
import { pluralize } from '@shared/pluralize'
import { formatMoment } from '../utils/dates'
import { Button, Dropdown, IconButton, MenuButton, ToolButton } from '../ui'
import type { StructureClient } from './client'
import { ClustersView } from './components/ClustersView'
import { GroupsView } from './components/GroupsView'
import { Insights } from './components/Insights'
import { SitemapsTab } from './components/SitemapsCard'
import { SyncReport } from './components/SyncReport'
import { useStructure, type StructureState } from './hooks/useStructure'
import { useStructureDrills, type StructureDrills } from './hooks/useStructureDrills'
import { usePagesRevision } from './drawers'
import './structure.css'

/** A part of Site structure, or `folders`: the folder tree the Tree view shows first. */
export type SiteStructurePart = StructurePart | 'folders'

/** The ways to group the tree, in the toolbar's "Group: … ▾" (one row of tabs, Vibe). */
const GROUP_PARTS = ['folders', 'clusters', 'groups'] as const

/** Shown from the status line, each with a way back to the tree. */
const STATUS_LABEL: Readonly<Record<'sitemaps' | 'sync' | 'noticed', string>> = {
  sitemaps: 'Sitemaps',
  sync: 'Last sync',
  noticed: 'CiteFox AI noticed'
}

function isGroupPart(part: SiteStructurePart): part is (typeof GROUP_PARTS)[number] {
  return GROUP_PARTS.some((item) => item === part)
}

/** What the Folders part draws with: the structure data and its actions. */
export interface FoldersContext {
  state: StructureState
  drills: StructureDrills
}

/**
 * Site structure (SRS 4.19), inside All pages' Tree view: the folder tree
 * first (the old Silos, with Track all and markets per folder). One toolbar row
 * (Group by): "Group: Folders ▾" picks folders, clusters or groups; one
 * status line names the sitemaps, the last sync and what CiteFox AI noticed, each
 * a link to its part; Sync now and ⋯ (Import pages) sit at the end. The part is
 * in the URL (`#/pages?view=tree&part=clusters`); `focus` is an old cluster or
 * group link, whose drawer opens over its part.
 */
export function SiteStructure({
  client,
  project,
  part,
  focus,
  onPart,
  hrefFor,
  folders,
  onChanged
}: {
  client: StructureClient
  project: ProjectDetail
  /** The part the URL names; null starts on Folders, or on Sitemaps while there are none. */
  part: SiteStructurePart | null
  focus: string | null
  onPart: (part: SiteStructurePart) => void
  hrefFor: (part: SiteStructurePart) => string
  folders: (context: FoldersContext) => ReactNode
  /** The structure reloaded after the first load (an action, a sync): pages may have changed. */
  onChanged?: () => void
}): JSX.Element {
  const projectId = project.id
  const state = useStructure(client, projectId)
  const { overview, view, run, busy } = state
  const drills = useStructureDrills(client, projectId, view)
  // A drawer (cluster, group, Move pages) changed pages or clusters: reload in place.
  const pagesRevision = usePagesRevision()
  const { reload } = state
  useEffect(() => {
    if (pagesRevision > 0) void reload()
  }, [pagesRevision, reload])
  // Find sitemaps, a sync or Track all changed the pages: the page list reloads too.
  const loadedOnce = useRef(false)
  const changed = useRef(onChanged)
  useEffect(() => {
    changed.current = onChanged
  }, [onChanged])
  useEffect(() => {
    if (!overview || !view) return
    if (loadedOnce.current) changed.current?.()
    loadedOnce.current = true
  }, [overview, view])
  // An old cluster or group link opens its drawer over its part.
  useEffect(() => {
    if (!view || !focus) return
    if (view.clusters.some((cluster) => cluster.id === focus)) {
      replaceHash(drawerHref('cluster', { 'cluster.id': focus }, structureHash('clusters')))
    } else if (view.groups.some((group) => group.id === focus)) {
      replaceHash(drawerHref('group', { 'group.id': focus }, structureHash('groups')))
    }
  }, [view, focus])
  // What Ask CiteFox knows here: the part and the cluster or group open in its drawer.
  const { stack } = useDrawerStack()
  const openSet = stack.find((entry) => entry.id === 'cluster' || entry.id === 'group')
  const openSetId = openSet?.params['cluster.id'] ?? openSet?.params['group.id'] ?? focus
  const focused =
    view?.clusters.find((cluster) => cluster.id === openSetId) ??
    view?.groups.find((group) => group.id === openSetId)
  useAiContext({
    entities: focused ? [{ kind: 'group', id: focused.id, label: focused.name }] : [],
    filters: { tab: part ?? 'folders' }
  })
  const defaultMarket = project.defaultMarket
    ? marketLabel(project.defaultMarket)
    : 'the default market'

  const counts: Readonly<Record<(typeof GROUP_PARTS)[number], number>> | null = view
    ? {
        folders: view.silos.filter((silo) => silo.parentPath !== null).length,
        clusters: view.clusters.length,
        groups: view.groups.length
      }
    : null
  const groupLabel = { folders: 'Folders', clusters: 'Clusters', groups: 'Groups' } as const
  const available = (item: SiteStructurePart): boolean =>
    item !== 'noticed' || (view?.insights.length ?? 0) > 0
  // The folders come first, even before any sitemap: imported pages have folders too.
  const shown: SiteStructurePart = part !== null && available(part) ? part : 'folders'
  const lastSync = overview?.lastSync ?? null
  const syncChanges = lastSync
    ? lastSync.newCount + lastSync.removedCount + lastSync.changedCount
    : 0
  const statusLinks: { id: 'sitemaps' | 'sync' | 'noticed'; text: string }[] = overview
    ? [
        { id: 'sitemaps', text: pluralize(overview.sitemaps.length, 'sitemap') },
        {
          id: 'sync',
          text: lastSync
            ? `Last sync ${formatMoment(lastSync.finishedAt)} · ${pluralize(syncChanges, 'change')}`
            : 'Not synced yet'
        },
        ...((view?.insights.length ?? 0) > 0
          ? [
              {
                id: 'noticed' as const,
                text: `CiteFox AI noticed ${(view?.insights.length ?? 0).toLocaleString('en-US')}`
              }
            ]
          : [])
      ]
    : []

  return (
    <div className="page-stack str-screen">
      <div aria-live="polite" className="sr-only">
        {busy ? `${busy}…` : ''}
      </div>
      {state.actionError ? (
        <div className="str-alert" role="alert">
          <p>{state.actionError}</p>
          <Button variant="ghost" size="sm" onClick={state.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {state.loadError ? (
        <LoadError
          title="CiteFox could not load the site structure."
          message={state.loadError}
          onRetry={() => void state.reload()}
        />
      ) : null}
      {!overview || !view ? (
        state.loadError ? null : (
          <p role="status">Loading site structure…</p>
        )
      ) : (
        <div className="str-tabs">
          <div className="str-tabs-row">
            <Dropdown
              size="sm"
              prefix="Group"
              // On a part from the status line no grouping is picked, so any pick
              // (Folders too) goes back to the tree.
              value={isGroupPart(shown) ? shown : ''}
              onChange={(next) => onPart(next as SiteStructurePart)}
              options={GROUP_PARTS.map((item) => ({
                value: item,
                label: `${groupLabel[item]} (${(counts?.[item] ?? 0).toLocaleString('en-US')})`
              }))}
            />
            <p className="str-status" aria-label="Site structure status">
              {statusLinks.map((item, index) => (
                <span key={item.id}>
                  {index > 0 ? (
                    <span className="str-status-sep" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  <a
                    href={hrefFor(item.id)}
                    aria-current={shown === item.id ? 'page' : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      onPart(item.id)
                    }}
                  >
                    {item.text}
                  </a>
                </span>
              ))}
            </p>
            <div className="str-tabs-actions">
              <ToolButton
                kind="refresh"
                label="Sync now"
                busy={busy === 'Sync now'}
                disabled={busy !== null}
                onClick={() =>
                  void run('Sync now', () => client['sitemaps:sync']({ projectId })).then(
                    (done) => {
                      if (done) onPart('sync')
                    }
                  )
                }
              />
              <MenuButton
                label="More site structure actions"
                items={[
                  {
                    id: 'import',
                    label: 'Import pages',
                    icon: 'download',
                    onSelect: () => navigateHash(sectionHash('import-pages'))
                  }
                ]}
                trigger={({ ref, ...props }) => (
                  <IconButton
                    ref={ref}
                    icon="dots"
                    size="sm"
                    label="More site structure actions"
                    {...props}
                  />
                )}
              />
            </div>
          </div>
          <div className="str-panel" data-part={shown}>
            {isGroupPart(shown) ? (
              <h2 className="sr-only">{groupLabel[shown]}</h2>
            ) : (
              <div className="str-part-head">
                {shown === 'noticed' ? null : <h2>{STATUS_LABEL[shown]}</h2>}
                <a
                  href={hrefFor('folders')}
                  className="str-back"
                  onClick={(event) => {
                    event.preventDefault()
                    onPart('folders')
                  }}
                >
                  Back to the tree
                </a>
              </div>
            )}
            {shown === 'folders' ? (
              folders({ state, drills })
            ) : shown === 'clusters' ? (
              <ClustersView
                client={client}
                projectId={projectId}
                view={view}
                marketLabel={defaultMarket}
                drills={drills}
                run={run}
                busy={busy}
              />
            ) : shown === 'groups' ? (
              <GroupsView
                client={client}
                projectId={projectId}
                view={view}
                drills={drills}
                run={run}
                busy={busy}
              />
            ) : shown === 'sitemaps' ? (
              <SitemapsTab
                client={client}
                projectId={projectId}
                domain={project.domain}
                overview={overview}
                drills={drills}
                run={run}
                busy={busy}
              />
            ) : shown === 'sync' ? (
              <SyncReport
                key={overview.lastSync?.id ?? 'none'}
                client={client}
                projectId={projectId}
                report={overview.lastSync}
                marketLabel={defaultMarket}
                clusters={view.clusters}
                run={run}
                busy={busy}
              />
            ) : (
              <Insights insights={view.insights} drills={drills} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
