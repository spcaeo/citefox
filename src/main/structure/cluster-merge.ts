import type { ClusterMaker, ClusterRole } from '@shared/domain'
import type { ProposedCluster } from './cluster-rules'

/**
 * FR-19.4 re-clustering that keeps manual edits: clusters the user made and
 * pages the user moved stay; a proposal that overlaps an old cluster reuses
 * its id (and its name when the user renamed it); empty old clusters go.
 */

export interface ExistingClusterPage {
  pageId: string
  role: ClusterRole
  movedByUser: boolean
}

export interface ExistingCluster {
  id: string
  name: string
  madeBy: ClusterMaker
  renamedByUser: boolean
  editedByUser: boolean
  trackWhole: boolean
  topicKey: string | null
  pillarPageId: string | null
  pages: readonly ExistingClusterPage[]
  /** Stored themes. Kept on clusters the plan carries over unchanged. */
  themes?: readonly string[]
}

export interface PlannedCluster {
  /** Null for a new cluster. */
  id: string | null
  name: string
  madeBy: ClusterMaker
  renamedByUser: boolean
  editedByUser: boolean
  trackWhole: boolean
  topicKey: string | null
  pillarPageId: string | null
  themes: string[]
  pages: ExistingClusterPage[]
}

export interface ClusterPlan {
  clusters: PlannedCluster[]
  changes: string[]
}

export function mergeWithExisting(
  existing: readonly ExistingCluster[],
  proposed: readonly ProposedCluster[],
  madeBy: 'rules' | 'claude'
): ClusterPlan {
  const kept: PlannedCluster[] = []
  const locked = new Map<string, { clusterId: string; page: ExistingClusterPage }>()
  for (const cluster of existing) {
    for (const page of cluster.pages) {
      if (cluster.madeBy === 'user' || page.movedByUser)
        locked.set(page.pageId, { clusterId: cluster.id, page })
    }
  }
  const oldCluster = new Map<string, ExistingCluster>()
  for (const cluster of existing)
    for (const page of cluster.pages) oldCluster.set(page.pageId, cluster)

  const proposals = proposed
    .map((cluster) => ({
      cluster,
      ids: cluster.pageIds.filter((id) => !locked.has(id))
    }))
    .filter((entry) => entry.ids.length > 0)
  const machine = existing.filter((cluster) => cluster.madeBy !== 'user')
  const pairs: { proposal: number; cluster: number; score: number }[] = []
  proposals.forEach((entry, proposalIndex) => {
    const set = new Set(entry.ids)
    machine.forEach((cluster, clusterIndex) => {
      const ids = new Set(
        cluster.pages.filter((page) => !page.movedByUser).map((page) => page.pageId)
      )
      const score = overlap(set, ids)
      if (score >= 0.5) pairs.push({ proposal: proposalIndex, cluster: clusterIndex, score })
    })
  })
  pairs.sort(
    (left, right) =>
      right.score - left.score || left.proposal - right.proposal || left.cluster - right.cluster
  )
  const matchOf = new Map<number, ExistingCluster>()
  const usedClusters = new Set<number>()
  for (const pair of pairs) {
    if (matchOf.has(pair.proposal) || usedClusters.has(pair.cluster)) continue
    const cluster = machine[pair.cluster]
    if (!cluster) continue
    matchOf.set(pair.proposal, cluster)
    usedClusters.add(pair.cluster)
  }
  const movedInto = (clusterId: string): ExistingClusterPage[] =>
    [...locked.values()]
      .filter((entry) => entry.clusterId === clusterId && entry.page.movedByUser)
      .map((entry) => ({ ...entry.page }))

  for (const cluster of existing) {
    if (cluster.madeBy !== 'user') continue
    kept.push({
      id: cluster.id,
      name: cluster.name,
      madeBy: cluster.madeBy,
      renamedByUser: cluster.renamedByUser,
      editedByUser: cluster.editedByUser,
      trackWhole: cluster.trackWhole,
      topicKey: cluster.topicKey,
      pillarPageId: cluster.pillarPageId,
      themes: [...(cluster.themes ?? [])],
      pages: cluster.pages.map((page) => ({ ...page }))
    })
  }
  const planned: PlannedCluster[] = []
  proposals.forEach((entry, index) => {
    const match = matchOf.get(index)
    const orphans = new Set(entry.cluster.orphanPageIds)
    const pillar =
      entry.cluster.pillarPageId !== null && entry.ids.includes(entry.cluster.pillarPageId)
        ? entry.cluster.pillarPageId
        : null
    const pages: ExistingClusterPage[] = entry.ids.map((pageId) => ({
      pageId,
      role: pageId === pillar ? 'pillar' : orphans.has(pageId) ? 'orphan' : 'supporting',
      movedByUser: false
    }))
    if (match) pages.push(...movedInto(match.id))
    planned.push({
      id: match?.id ?? null,
      name: match?.renamedByUser ? match.name : entry.cluster.name,
      madeBy,
      renamedByUser: match?.renamedByUser ?? false,
      editedByUser: match?.editedByUser ?? false,
      trackWhole: match?.trackWhole ?? false,
      topicKey: entry.cluster.key,
      pillarPageId: pillar,
      themes: [...entry.cluster.themes],
      pages
    })
  })
  const removed: ExistingCluster[] = []
  machine.forEach((cluster, index) => {
    if (usedClusters.has(index)) return
    const moved = movedInto(cluster.id)
    if (moved.length === 0) {
      removed.push(cluster)
      return
    }
    planned.push({
      id: cluster.id,
      name: cluster.name,
      madeBy: cluster.madeBy,
      renamedByUser: cluster.renamedByUser,
      editedByUser: cluster.editedByUser,
      trackWhole: cluster.trackWhole,
      topicKey: cluster.topicKey,
      pillarPageId: moved.some((page) => page.pageId === cluster.pillarPageId)
        ? cluster.pillarPageId
        : null,
      themes: [...(cluster.themes ?? [])],
      pages: moved
    })
  })
  const clusters = [...kept, ...planned]
  return { clusters, changes: describeChanges(existing, clusters, removed, oldCluster, locked) }
}

function describeChanges(
  existing: readonly ExistingCluster[],
  clusters: readonly PlannedCluster[],
  removed: readonly ExistingCluster[],
  oldCluster: ReadonlyMap<string, ExistingCluster>,
  locked: ReadonlyMap<string, { clusterId: string; page: ExistingClusterPage }>
): string[] {
  const lines: string[] = []
  for (const cluster of clusters) {
    if (cluster.id === null)
      lines.push(`New cluster "${cluster.name}" (${pluralPages(cluster.pages.length)}).`)
  }
  const moves = new Map<string, { from: string; to: string; count: number }>()
  for (const cluster of clusters) {
    if (cluster.id === null) continue
    for (const page of cluster.pages) {
      const before = oldCluster.get(page.pageId)
      if (!before || before.id === cluster.id) continue
      const key = `${before.id}\u0000${cluster.id}`
      const found = moves.get(key)
      if (found) found.count += 1
      else moves.set(key, { from: before.name, to: cluster.name, count: 1 })
    }
  }
  for (const move of [...moves.values()].sort((left, right) => right.count - left.count)) {
    lines.push(
      `${move.count === 1 ? '1 page moves' : `${move.count} pages move`} from "${move.from}" to "${move.to}".`
    )
  }
  for (const cluster of removed) lines.push(`Removed cluster "${cluster.name}".`)
  const renamed = existing.filter(
    (cluster) => cluster.renamedByUser && cluster.madeBy !== 'user'
  ).length
  const made = existing.filter((cluster) => cluster.madeBy === 'user').length
  const moved = [...locked.values()].filter((entry) => entry.page.movedByUser).length
  const parts: string[] = []
  if (renamed > 0) parts.push(renamed === 1 ? '1 renamed cluster' : `${renamed} renamed clusters`)
  if (made > 0) parts.push(made === 1 ? '1 cluster you made' : `${made} clusters you made`)
  if (moved > 0) parts.push(moved === 1 ? '1 page you moved' : `${moved} pages you moved`)
  const manual = parts.length === 0 ? null : `Your manual edits are kept: ${joinParts(parts)}.`
  const limit = manual === null ? 8 : 7
  const out = lines.slice(0, limit)
  if (lines.length > limit) out[limit - 1] = `…and ${lines.length - limit + 1} more changes.`
  if (manual !== null) out.push(manual)
  return out
}

function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`
}

function pluralPages(count: number): string {
  return count === 1 ? '1 page' : `${count} pages`
}

function overlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const item of left) if (right.has(item)) shared += 1
  return shared / (left.size + right.size - shared)
}
