import { DEFAULT_SAMPLE_COUNT } from '@shared/domain'
import type {
  ClusterPageList,
  ClusterSummaryList,
  ClusterSummaryRequest,
  InternalLinkSuggestions,
  MergeClustersRequest,
  MovePageRequest,
  ReclusterRequest,
  ReclusterResult,
  RenameClusterRequest,
  SetPageRoleRequest,
  SetSiloRequest,
  StructureView,
  TrackClusterRequest,
  TrackStructureResult
} from '@shared/ipc'
import type { StructureMemberships } from '@shared/domain'
import { completeAssist } from '../engine/assist'
import { withProject, type OpenProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import {
  listClusters,
  replaceClusters,
  restoreClusterSnapshot,
  writeStructureState,
  type StoredCluster
} from '../storage/cluster-records'
import type { SqliteDatabase } from '../storage/database'
import { listSiloSettings, writeSiloSetting } from '../storage/group-records'
import { readProjectSchedule } from '../storage/project-schedule'
import { isWorkingStatus } from '../storage/structure-pages'
import { buildClusterPrompt, pageRefs, parseClaudeClusters } from './claude-prompts'
import {
  clusterBySharedQueries,
  clusterByTopic,
  mergeWithExisting,
  type ClusterInputPage,
  type ProposedCluster
} from './cluster-rules'
import { suggestInternalLinks } from './link-suggest'
import { structureProducts } from './product-context'
import type { StructureRuntime } from './runtime'
import { buildSilos, effectiveMarkets, parentOf } from './silos'
import { defaultMarketIds, trackInProject } from './track'
import {
  buildMemberships,
  buildStructureView,
  clusterPageRows,
  loadStructureData,
  summarizeCluster,
  type ViewContext
} from './view'

/** Import defaults for bulk tracking from Site structure (mock-up: 5 prompts, 1 sample). */
export const BULK_PROMPTS_PER_PAGE = 5

/** Reply cap for auto-cluster: every listed page's ref comes back, plus names and themes. */
const CLUSTER_MAX_TOKENS = 8000

export function structureView(
  rt: StructureRuntime,
  projectId: string,
  channel = 'structure:get'
): Promise<StructureView> {
  return withProject(rt.host, projectId, channel, (opened) =>
    buildStructureView(viewContext(rt, opened))
  )
}

export function clusterPages(
  rt: StructureRuntime,
  projectId: string,
  clusterId: string
): Promise<ClusterPageList> {
  const channel = 'structure:clusterPages'
  return withProject(rt.host, projectId, channel, (opened) => {
    const data = loadStructureData(opened.db)
    const cluster = requireCluster(data.clusters, clusterId, channel)
    return { clusterId, pages: clusterPageRows(data, cluster) }
  })
}

/** FR-19.4. Rules or Claude propose; manual edits are merged back; the old set is saved for undo. */
export async function recluster(
  rt: StructureRuntime,
  request: ReclusterRequest
): Promise<ReclusterResult> {
  const channel = 'structure:recluster'
  if (request.method === 'links') {
    throw new IpcRequestError(
      channel,
      'CiteFox has no internal-link data yet. Cluster by topic or by shared target queries.'
    )
  }
  const { inputs, products } = await withProject(rt.host, request.projectId, channel, (opened) => ({
    inputs: clusterInputs(opened.db),
    products: request.useClaude ? structureProducts(opened.db, opened.project.domain) : null
  }))
  if (inputs.length === 0)
    throw new IpcRequestError(
      channel,
      'There are no pages to cluster yet. Sync your sitemap first.'
    )
  let proposed: ProposedCluster[]
  if (request.useClaude) {
    const ids = new Set(inputs.map((page) => page.id))
    const listed = inputs.map((page) => ({
      id: page.id,
      path: pathOf(page.url),
      title: page.title,
      product: products?.productOf(page) ?? null
    }))
    const refs = pageRefs(listed)
    const prompt = buildClusterPrompt(
      listed,
      request.method,
      request.instruction,
      products?.context
    )
    const reply = await completeAssist(
      rt.host,
      channel,
      prompt,
      (value) => parseClaudeClusters(value, ids, refs) !== null,
      null,
      { assistId: 'structure.clusters', projectId: request.projectId },
      { maxTokens: CLUSTER_MAX_TOKENS }
    )
    const fromClaude = parseClaudeClusters(reply, ids, refs) ?? []
    const covered = new Set(fromClaude.flatMap((cluster) => cluster.pageIds))
    const rest = inputs.filter((page) => !covered.has(page.id))
    proposed = [...fromClaude, ...(rest.length > 0 ? clusterByTopic(rest) : [])]
  } else {
    proposed =
      request.method === 'queries' ? clusterBySharedQueries(inputs) : clusterByTopic(inputs)
  }
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const existing = listClusters(opened.db)
    const plan = mergeWithExisting(existing, proposed, request.useClaude ? 'claude' : 'rules')
    const now = rt.host.now().toISOString()
    const byId = new Map(existing.map((cluster) => [cluster.id, cluster]))
    const next: StoredCluster[] = plan.clusters.map((cluster) => {
      const previous = cluster.id === null ? undefined : byId.get(cluster.id)
      return {
        id: cluster.id ?? `cluster-${rt.host.createId()}`,
        name: cluster.name,
        pillarPageId: cluster.pillarPageId,
        madeBy: cluster.madeBy,
        version: (previous?.version ?? 0) + 1,
        renamedByUser: cluster.renamedByUser,
        editedByUser: cluster.editedByUser,
        trackWhole: cluster.trackWhole,
        topicKey: cluster.topicKey,
        themes: cluster.themes,
        createdAt: previous?.createdAt ?? now,
        pages: cluster.pages
      }
    })
    replaceClusters(opened.db, next, {
      at: now,
      snapshotReason: existing.length > 0 ? 'recluster' : null
    })
    writeStructureState(opened.db, { lastClusteredAt: now, lastClusterMethod: request.method })
    return {
      view: buildStructureView(viewContext(rt, opened)),
      previousCount: existing.length,
      changes: plan.changes
    }
  })
}

export function undoClusters(rt: StructureRuntime, projectId: string): Promise<StructureView> {
  const channel = 'structure:undoClusters'
  return withProject(rt.host, projectId, channel, (opened) => {
    if (!restoreClusterSnapshot(opened.db))
      throw new IpcRequestError(channel, 'There is nothing to undo.')
    return buildStructureView(viewContext(rt, opened))
  })
}

export function renameCluster(
  rt: StructureRuntime,
  request: RenameClusterRequest
): Promise<StructureView> {
  return editClusters(
    rt,
    request.projectId,
    'structure:renameCluster',
    null,
    (clusters, channel) => {
      const cluster = requireCluster(clusters, request.clusterId, channel)
      cluster.name = request.name
      cluster.renamedByUser = true
      cluster.editedByUser = true
    }
  )
}

export function mergeClusters(
  rt: StructureRuntime,
  request: MergeClustersRequest
): Promise<StructureView> {
  return editClusters(
    rt,
    request.projectId,
    'structure:mergeClusters',
    'merge',
    (clusters, channel) => {
      if (request.fromClusterId === request.intoClusterId)
        throw new IpcRequestError(channel, 'Pick another cluster to merge into.')
      const from = requireCluster(clusters, request.fromClusterId, channel)
      const into = requireCluster(clusters, request.intoClusterId, channel)
      for (const page of from.pages) {
        into.pages.push({ ...page, role: page.role === 'pillar' ? 'supporting' : page.role })
      }
      into.editedByUser = true
      into.trackWhole = into.trackWhole || from.trackWhole
      into.themes = [...new Set([...into.themes, ...from.themes])].slice(0, 3)
      clusters.splice(clusters.indexOf(from), 1)
    }
  )
}

export function movePage(rt: StructureRuntime, request: MovePageRequest): Promise<StructureView> {
  return editClusters(rt, request.projectId, 'structure:movePage', null, (clusters, channel) => {
    const target = requireCluster(clusters, request.clusterId, channel)
    const source = clusters.find((cluster) =>
      cluster.pages.some((page) => page.pageId === request.pageId)
    )
    if (source === target) return
    if (source !== undefined) {
      source.pages = source.pages.filter((page) => page.pageId !== request.pageId)
      if (source.pillarPageId === request.pageId) source.pillarPageId = null
      source.editedByUser = true
    }
    target.pages.push({ pageId: request.pageId, role: 'supporting', movedByUser: true })
    target.editedByUser = true
  })
}

export function setPageRole(
  rt: StructureRuntime,
  request: SetPageRoleRequest
): Promise<StructureView> {
  return editClusters(rt, request.projectId, 'structure:setPageRole', null, (clusters, channel) => {
    const cluster = requireCluster(clusters, request.clusterId, channel)
    const page = cluster.pages.find((member) => member.pageId === request.pageId)
    if (page === undefined) throw new IpcRequestError(channel, 'That page is not in this cluster.')
    if (request.role === 'pillar') {
      for (const member of cluster.pages) if (member.role === 'pillar') member.role = 'supporting'
      cluster.pillarPageId = page.pageId
    } else if (cluster.pillarPageId === page.pageId) {
      cluster.pillarPageId = null
    }
    page.role = request.role
    cluster.editedByUser = true
  })
}

/** FR-19.5 "Track cluster": tracks its pages now and new pages the sync adds to it. */
export function trackCluster(
  rt: StructureRuntime,
  request: TrackClusterRequest
): Promise<TrackStructureResult> {
  const channel = 'structure:trackCluster'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const clusters = listClusters(opened.db)
    const cluster = requireCluster(clusters, request.clusterId, channel)
    cluster.trackWhole = request.track
    replaceClusters(opened.db, clusters, { at: rt.host.now().toISOString(), snapshotReason: null })
    let trackedCount = 0
    if (request.track) {
      trackedCount = bulkTrack(
        rt,
        opened,
        cluster.pages.map((page) => page.pageId),
        defaultMarketIds(opened.db),
        channel
      )
    }
    return { view: buildStructureView(viewContext(rt, opened)), trackedCount }
  })
}

/** FR-19.6. Silo markets ("Same as parent folder" is null) and "track every page in it". */
export function setSilo(
  rt: StructureRuntime,
  request: SetSiloRequest
): Promise<TrackStructureResult> {
  const channel = 'structure:setSilo'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const db = opened.db
    const settings = listSiloSettings(db)
    const current = settings.get(request.path) ?? {
      path: request.path,
      trackAll: false,
      marketIds: null
    }
    const markets = new Set(
      db
        .prepare<unknown[], { id: string }>(`SELECT id FROM markets`)
        .all()
        .map((row) => row.id)
    )
    if (request.marketIds !== undefined && request.marketIds !== null) {
      if (request.marketIds.some((id) => !markets.has(id)))
        throw new IpcRequestError(channel, 'That market is not in this project.')
    }
    const next = {
      path: request.path,
      trackAll: request.trackAll ?? current.trackAll,
      marketIds: request.marketIds === undefined ? current.marketIds : request.marketIds
    }
    writeSiloSetting(db, next)
    settings.set(next.path, next)
    let trackedCount = 0
    if (request.trackAll === true) {
      const data = loadStructureData(db)
      const tree = buildSilos(
        data.pages.map((page) => ({
          id: page.id,
          url: page.url,
          working: isWorkingStatus(page.status)
        })),
        settings,
        defaultMarketIds(db)
      )
      const inside = data.pages.filter((page) =>
        isUnder(tree.pathOf.get(page.id) ?? '/', request.path)
      )
      trackedCount = bulkTrack(
        rt,
        opened,
        inside.map((page) => page.id),
        effectiveMarkets(request.path, settings, defaultMarketIds(db)),
        channel
      )
    }
    return { view: buildStructureView(viewContext(rt, opened)), trackedCount }
  })
}

export function memberships(
  rt: StructureRuntime,
  projectId: string
): Promise<StructureMemberships> {
  return withProject(rt.host, projectId, 'structure:listMemberships', (opened) =>
    buildMemberships(viewContext(rt, opened))
  )
}

/** FR-20.8: the largest clusters first, with the total. */
export function clusterSummary(
  rt: StructureRuntime,
  request: ClusterSummaryRequest
): Promise<ClusterSummaryList> {
  return withProject(rt.host, request.projectId, 'structure:clusterSummary', (opened) => {
    const ctx = viewContext(rt, opened)
    const data = loadStructureData(opened.db)
    const largest = [...data.clusters]
      .sort(
        (left, right) =>
          right.pages.length - left.pages.length || left.name.localeCompare(right.name)
      )
      .slice(0, request.limit)
    return {
      clusters: largest.map((cluster) => summarizeCluster(ctx, data, cluster)),
      totalClusters: data.clusters.length
    }
  })
}

export function suggestLinks(
  rt: StructureRuntime,
  projectId: string,
  clusterId: string
): Promise<InternalLinkSuggestions> {
  const channel = 'structure:suggestLinks'
  return withProject(rt.host, projectId, channel, (opened) => {
    const data = loadStructureData(opened.db)
    const cluster = requireCluster(data.clusters, clusterId, channel)
    const pillar = cluster.pillarPageId === null ? undefined : data.byId.get(cluster.pillarPageId)
    const pages = cluster.pages.flatMap((member) => {
      const page = data.byId.get(member.pageId)
      return page === undefined
        ? []
        : [{ id: page.id, url: page.url, title: page.title, role: member.role }]
    })
    return {
      clusterId,
      links: suggestInternalLinks({
        pillar:
          pillar === undefined ? null : { id: pillar.id, url: pillar.url, title: pillar.title },
        pages
      })
    }
  })
}

// ---------- helpers ----------

export function viewContext(rt: StructureRuntime, opened: OpenProject): ViewContext {
  return {
    db: opened.db,
    projectId: opened.project.id,
    domain: opened.project.domain,
    now: rt.host.now().toISOString()
  }
}

export function editClusters(
  rt: StructureRuntime,
  projectId: string,
  channel: string,
  snapshotReason: string | null,
  edit: (clusters: StoredCluster[], channel: string) => void
): Promise<StructureView> {
  return withProject(rt.host, projectId, channel, (opened) => {
    const clusters = listClusters(opened.db)
    edit(clusters, channel)
    replaceClusters(opened.db, clusters, { at: rt.host.now().toISOString(), snapshotReason })
    return buildStructureView(viewContext(rt, opened))
  })
}

export function requireCluster<T extends { id: string }>(
  clusters: readonly T[],
  id: string,
  channel: string
): T {
  const cluster = clusters.find((item) => item.id === id)
  if (cluster === undefined)
    throw new IpcRequestError(channel, 'That cluster was not found. Reload Site structure.')
  return cluster
}

function bulkTrack(
  rt: StructureRuntime,
  opened: OpenProject,
  pageIds: readonly string[],
  marketIds: readonly string[],
  channel: string
): number {
  if (marketIds.length === 0)
    throw new IpcRequestError(channel, 'Set a default market for the project first.')
  const schedule = readProjectSchedule(opened.db, opened.project.id)
  return trackInProject(rt.host, opened.db, pageIds, {
    marketIds,
    intervalDays: schedule.defaultIntervalDays,
    samples: DEFAULT_SAMPLE_COUNT,
    promptCount: BULK_PROMPTS_PER_PAGE,
    stagger: true
  }).changed.length
}

function isUnder(path: string, ancestor: string): boolean {
  let current: string | null = path
  while (current !== null) {
    if (current === ancestor) return true
    current = parentOf(current)
  }
  return false
}

function clusterInputs(db: SqliteDatabase): ClusterInputPage[] {
  const data = loadStructureData(db)
  const prompts = new Map<string, string[]>()
  const rows = db
    .prepare<unknown[], { page_id: string; label: string; text: string | null }>(
      `SELECT ps.page_id, p.label, v.text FROM prompt_sets ps
       JOIN prompts p ON p.prompt_set_id = ps.id
       LEFT JOIN prompt_variants v ON v.prompt_id = p.id
       WHERE ps.is_active = 1 AND p.enabled = 1`
    )
    .all()
  for (const row of rows) {
    const list = prompts.get(row.page_id) ?? []
    if (!list.includes(row.label)) list.push(row.label)
    if (row.text !== null && !list.includes(row.text)) list.push(row.text)
    prompts.set(row.page_id, list)
  }
  return data.pages.map((page) => ({
    id: page.id,
    url: page.url,
    title: page.title,
    promptTexts: prompts.get(page.id) ?? [],
    tracked: isWorkingStatus(page.status)
  }))
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}
