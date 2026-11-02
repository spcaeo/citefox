import type {
  ClusterChangeResult,
  ClusterIdRequest,
  CreateClusterRequest,
  MovePagesRequest,
  SplitClusterRequest,
  StructureView
} from '@shared/ipc'
import { withProject, type OpenProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { listClusters, replaceClusters, type StoredCluster } from '../storage/cluster-records'
import type { StructureRuntime } from './runtime'
import { requireCluster, viewContext } from './service-structure'
import { buildStructureView, loadStructureData } from './view'

/**
 * Clusters the user makes, deletes and splits by hand (FR-19.5), and moving
 * many pages at once. Every change saves the previous set first, so
 * `structure:undoClusters` puts it back.
 */

export function movePages(rt: StructureRuntime, request: MovePagesRequest): Promise<StructureView> {
  const channel = 'structure:movePages'
  return changeClusters(rt, request.projectId, channel, 'move', (clusters, opened) => {
    const ids = knownPages(opened, request.pageIds)
    if (ids.length === 0) throw new IpcRequestError(channel, 'Pick at least one page.')
    const target =
      request.clusterId === null ? null : requireCluster(clusters, request.clusterId, channel)
    const moving = new Set(target === null ? ids : ids.filter((id) => !inCluster(target, id)))
    takeOut(clusters, moving)
    if (target !== null) addPages(target, [...moving])
    return null
  }).then(({ view }) => view)
}

export function createCluster(
  rt: StructureRuntime,
  request: CreateClusterRequest
): Promise<ClusterChangeResult> {
  const channel = 'structure:createCluster'
  return changeClusters(rt, request.projectId, channel, 'create', (clusters, opened) => {
    const name = uniqueName(clusters, request.name, channel)
    const ids = knownPages(opened, request.pageIds)
    if (ids.length === 0) throw new IpcRequestError(channel, 'Pick at least one page.')
    return newCluster(rt, clusters, name, ids)
  }).then(({ view, extra }) => ({ view, ...extra }))
}

export function deleteCluster(
  rt: StructureRuntime,
  request: ClusterIdRequest
): Promise<StructureView> {
  const channel = 'structure:deleteCluster'
  return changeClusters(rt, request.projectId, channel, 'delete', (clusters) => {
    const cluster = requireCluster(clusters, request.clusterId, channel)
    clusters.splice(clusters.indexOf(cluster), 1)
    return null
  }).then(({ view }) => view)
}

export function splitCluster(
  rt: StructureRuntime,
  request: SplitClusterRequest
): Promise<ClusterChangeResult> {
  const channel = 'structure:splitCluster'
  return changeClusters(rt, request.projectId, channel, 'split', (clusters) => {
    const source = requireCluster(clusters, request.clusterId, channel)
    if (request.pageIds.length === 0) throw new IpcRequestError(channel, 'Pick at least one page.')
    if (!request.pageIds.every((id) => inCluster(source, id)))
      throw new IpcRequestError(channel, 'Those pages are not all in this cluster.')
    const moving = new Set(request.pageIds)
    if (source.pages.every((page) => moving.has(page.pageId)))
      throw new IpcRequestError(
        channel,
        'Leave at least one page in the cluster, or rename it instead.'
      )
    const name = uniqueName(clusters, request.name, channel)
    return newCluster(rt, clusters, name, [...moving])
  }).then(({ view, extra }) => ({ view, ...extra }))
}

// ---------- helpers ----------

/**
 * Loads the clusters, lets `edit` change them in place (it may refuse with an
 * error, and nothing is saved), saves them with a snapshot for undo, then
 * builds the view from the saved rows.
 */
function changeClusters<T>(
  rt: StructureRuntime,
  projectId: string,
  channel: string,
  snapshotReason: string,
  edit: (clusters: StoredCluster[], opened: OpenProject) => T
): Promise<{ view: StructureView; extra: T }> {
  return withProject(rt.host, projectId, channel, (opened) => {
    const clusters = listClusters(opened.db)
    const extra = edit(clusters, opened)
    replaceClusters(opened.db, clusters, { at: rt.host.now().toISOString(), snapshotReason })
    return { view: buildStructureView(viewContext(rt, opened)), extra }
  })
}

function knownPages(opened: OpenProject, pageIds: readonly string[]): string[] {
  const data = loadStructureData(opened.db)
  return [...new Set(pageIds)].filter((id) => data.byId.has(id))
}

function inCluster(cluster: StoredCluster, pageId: string): boolean {
  return cluster.pages.some((page) => page.pageId === pageId)
}

function takeOut(clusters: StoredCluster[], moving: ReadonlySet<string>): void {
  for (const cluster of clusters) {
    const before = cluster.pages.length
    cluster.pages = cluster.pages.filter((page) => !moving.has(page.pageId))
    if (cluster.pages.length === before) continue
    if (cluster.pillarPageId !== null && moving.has(cluster.pillarPageId))
      cluster.pillarPageId = null
    cluster.editedByUser = true
  }
}

function addPages(cluster: StoredCluster, pageIds: readonly string[]): void {
  for (const pageId of pageIds) {
    cluster.pages.push({ pageId, role: 'supporting', movedByUser: true })
  }
  if (pageIds.length > 0) cluster.editedByUser = true
}

function uniqueName(clusters: readonly StoredCluster[], value: string, channel: string): string {
  const name = value.trim()
  if (name.length === 0) throw new IpcRequestError(channel, 'Give the cluster a name.')
  if (clusters.some((cluster) => cluster.name.toLowerCase() === name.toLowerCase()))
    throw new IpcRequestError(channel, 'A cluster with this name already exists.')
  return name
}

function newCluster(
  rt: StructureRuntime,
  clusters: StoredCluster[],
  name: string,
  pageIds: readonly string[]
): { clusterId: string; movedCount: number } {
  const moving = new Set(pageIds)
  takeOut(clusters, moving)
  const cluster: StoredCluster = {
    id: `cluster-${rt.host.createId()}`,
    name,
    pillarPageId: null,
    madeBy: 'user',
    version: 1,
    renamedByUser: true,
    editedByUser: true,
    trackWhole: false,
    topicKey: null,
    themes: [],
    createdAt: rt.host.now().toISOString(),
    pages: []
  }
  addPages(cluster, [...moving])
  clusters.push(cluster)
  return { clusterId: cluster.id, movedCount: moving.size }
}
