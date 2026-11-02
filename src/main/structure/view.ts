import type {
  ClusterMethod,
  ClusterPageRow,
  ClusterSummary,
  GroupSummary,
  StructureMemberships,
  WeakestMarket
} from '@shared/domain'
import type { StructureView } from '@shared/ipc'
import type { SqliteDatabase } from '../storage/database'
import {
  hasClusterSnapshot,
  listClusters,
  readStructureState,
  type StoredCluster
} from '../storage/cluster-records'
import { listGroups, listSiloSettings, type StoredGroup } from '../storage/group-records'
import { sitemapFactsByPage, latestSyncReport } from '../storage/sitemap-records'
import {
  isWorkingStatus,
  listStructurePages,
  type StructurePageRow
} from '../storage/structure-pages'
import { findInsights, type InsightPage, type OwnCitationPair } from './insights'
import { latestFinishedRuns, marketScores, mean, type MarketScore } from './scores'
import { buildSilos } from './silos'
import { clusterThemes } from './themes'
import { defaultMarketIds } from './track'
import { listMarkets, readProjectProfile } from '../storage/project-profile'

export interface ViewContext {
  db: SqliteDatabase
  projectId: string
  domain: string
  now: string
}

/** Everything a structure read needs, loaded once per call. */
export interface StructureData {
  pages: StructurePageRow[]
  byId: Map<string, StructurePageRow>
  clusters: StoredCluster[]
  groups: StoredGroup[]
  runs: Map<string, Map<string, string>>
}

export function loadStructureData(db: SqliteDatabase): StructureData {
  const pages = listStructurePages(db)
  const byId = new Map(pages.map((page) => [page.id, page]))
  const clusters = listClusters(db).map((cluster) => ({
    ...cluster,
    pages: cluster.pages.filter((member) => byId.has(member.pageId))
  }))
  return { pages, byId, clusters, groups: listGroups(db), runs: latestFinishedRuns(db) }
}

export function buildStructureView(
  ctx: ViewContext,
  data = loadStructureData(ctx.db)
): StructureView {
  const state = readStructureState(ctx.db)
  const silos = buildSilos(
    data.pages.map((page) => ({
      id: page.id,
      url: page.url,
      working: isWorkingStatus(page.status)
    })),
    listSiloSettings(ctx.db),
    defaultMarketIds(ctx.db)
  )
  const clusters = data.clusters.map((cluster) => summarizeCluster(ctx, data, cluster))
  const methods: ClusterMethod[] = ['topic']
  if (hasPromptData(ctx.db)) methods.push('queries')
  return {
    projectId: ctx.projectId,
    clusters,
    silos: silos.silos,
    groups: data.groups.map((group) => summarizeGroup(data, group)),
    insights: findInsights({
      pages: insightPages(ctx.db, data),
      clusters: data.clusters.map((cluster) => ({
        id: cluster.id,
        name: cluster.name,
        pageIds: cluster.pages.map((member) => member.pageId)
      })),
      ownCitations: ownCitations(ctx.db, data)
    }),
    canUndoClusters: hasClusterSnapshot(ctx.db),
    lastClusteredAt: state.lastClusteredAt,
    lastClusterMethod: state.lastClusterMethod,
    availableMethods: methods,
    foundPageCount: data.pages.length,
    trackedPageCount: data.pages.filter((page) => isWorkingStatus(page.status)).length,
    markets: marketsDefaultFirst(ctx.db)
  }
}

function marketsDefaultFirst(db: SqliteDatabase): StructureView['markets'] {
  const defaultId = readProjectProfile(db)?.market.id ?? null
  const markets = listMarkets(db)
  return [
    ...markets.filter((market) => market.id === defaultId),
    ...markets.filter((market) => market.id !== defaultId)
  ]
}

export function summarizeCluster(
  ctx: ViewContext,
  data: StructureData,
  cluster: StoredCluster
): ClusterSummary {
  const members = cluster.pages.map((member) => data.byId.get(member.pageId)).filter(isPage)
  const tracked = members.filter((page) => isWorkingStatus(page.status))
  const pillar = cluster.pillarPageId === null ? undefined : data.byId.get(cluster.pillarPageId)
  const scored = tracked.filter((page) => page.score !== null)
  const changes: number[] = []
  const perMarket = new Map<string, number[]>()
  for (const page of tracked) {
    const scores = pageMarketScores(ctx, data, page.id)
    for (const entry of scores) {
      if (entry.score !== null) {
        const list = perMarket.get(entry.marketId) ?? []
        list.push(entry.score)
        perMarket.set(entry.marketId, list)
      }
      if (entry.marketId === page.defaultMarketId && entry.change !== null)
        changes.push(entry.change)
    }
  }
  return {
    id: cluster.id,
    name: cluster.name,
    madeBy: cluster.madeBy,
    editedByUser: cluster.editedByUser || cluster.renamedByUser,
    pillarPageId: pillar?.id ?? null,
    pillarTitle: pillar?.title ?? null,
    pillarUrl: pillar?.url ?? null,
    pageCount: members.length,
    trackedCount: tracked.length,
    averageScore: mean(scored.map((page) => page.score ?? 0)),
    scoreChange: mean(changes),
    weakestMarket: weakest(perMarket),
    themes: cluster.themes.slice(0, 3),
    themePrompts: clusterThemes(ctx.db, cluster.themes.slice(0, 3), members),
    trackWhole: cluster.trackWhole
  }
}

export function clusterPageRows(data: StructureData, cluster: StoredCluster): ClusterPageRow[] {
  return cluster.pages.flatMap((member): ClusterPageRow[] => {
    const page = data.byId.get(member.pageId)
    if (page === undefined) return []
    return [
      {
        pageId: page.id,
        url: page.url,
        title: page.title,
        role: member.role,
        movedByUser: member.movedByUser,
        status: page.status,
        score: page.score
      }
    ]
  })
}

export function summarizeGroup(data: StructureData, group: StoredGroup): GroupSummary {
  const pages = group.pageIds.map((id) => data.byId.get(id)).filter(isPage)
  const tracked = pages.filter((page) => isWorkingStatus(page.status))
  return {
    id: group.id,
    name: group.name,
    note: group.note,
    pageCount: pages.length,
    trackedCount: tracked.length,
    averageScore: mean(tracked.flatMap((page) => (page.score === null ? [] : [page.score]))),
    createdAt: group.createdAt
  }
}

export function buildMemberships(
  ctx: ViewContext,
  data = loadStructureData(ctx.db)
): StructureMemberships {
  const silos = buildSilos(
    data.pages.map((page) => ({
      id: page.id,
      url: page.url,
      working: isWorkingStatus(page.status)
    })),
    listSiloSettings(ctx.db),
    defaultMarketIds(ctx.db)
  )
  const clusterOf = new Map<string, { id: string; role: ClusterPageRow['role'] }>()
  for (const cluster of data.clusters) {
    for (const member of cluster.pages)
      clusterOf.set(member.pageId, { id: cluster.id, role: member.role })
  }
  const groupsOf = new Map<string, string[]>()
  for (const group of data.groups) {
    for (const pageId of group.pageIds)
      groupsOf.set(pageId, [...(groupsOf.get(pageId) ?? []), group.id])
  }
  const facts = sitemapFactsByPage(ctx.db)
  const lastSync = latestSyncReport(ctx.db)
  return {
    projectId: ctx.projectId,
    clusters: data.clusters.map((cluster) => ({ id: cluster.id, name: cluster.name })),
    groups: data.groups.map((group) => ({ id: group.id, name: group.name })),
    silos: silos.silos.map((silo) => silo.path),
    pages: data.pages.map((page) => {
      const cluster = clusterOf.get(page.id)
      const fact = facts.get(page.id)
      return {
        pageId: page.id,
        clusterId: cluster?.id ?? null,
        role: cluster?.role ?? null,
        siloPath: silos.pathOf.get(page.id) ?? '/',
        groupIds: groupsOf.get(page.id) ?? [],
        isNew:
          lastSync !== null &&
          lastSync.trigger !== 'first_read' &&
          fact !== undefined &&
          fact.firstSeenAt >= lastSync.startedAt,
        lastmod: fact?.lastmod ?? null
      }
    })
  }
}

function pageMarketScores(ctx: ViewContext, data: StructureData, pageId: string): MarketScore[] {
  return marketScores(ctx.db, {
    projectId: ctx.projectId,
    domain: ctx.domain,
    pageId,
    runs: data.runs.get(pageId),
    builtAt: ctx.now
  })
}

function weakest(perMarket: ReadonlyMap<string, number[]>): WeakestMarket | null {
  let best: WeakestMarket | null = null
  if (perMarket.size < 2) return null
  for (const [marketId, scores] of perMarket) {
    const score = mean(scores)
    if (score === null) continue
    if (best === null || score < best.score) best = { marketId, score }
  }
  return best
}

function hasPromptData(db: SqliteDatabase): boolean {
  return (
    db.prepare(`SELECT 1 AS ok FROM prompt_sets WHERE is_active = 1 LIMIT 1`).get() !== undefined
  )
}

function insightPages(db: SqliteDatabase, data: StructureData): InsightPage[] {
  const words = new Map(
    db
      .prepare<unknown[], { page_id: string; word_count: number }>(
        `SELECT s.page_id, s.word_count FROM snapshots s
         WHERE s.fetched_at = (SELECT MAX(fetched_at) FROM snapshots t WHERE t.page_id = s.page_id)`
      )
      .all()
      .map((row) => [row.page_id, row.word_count])
  )
  const prompts = new Map(
    db
      .prepare<unknown[], { page_id: string; count: number }>(
        `SELECT ps.page_id, COUNT(p.id) AS count FROM prompt_sets ps
         JOIN prompts p ON p.prompt_set_id = ps.id
         WHERE ps.is_active = 1 AND p.enabled = 1 GROUP BY ps.page_id`
      )
      .all()
      .map((row) => [row.page_id, row.count])
  )
  const clusterOf = new Map<string, { id: string; role: InsightPage['role'] }>()
  for (const cluster of data.clusters) {
    for (const member of cluster.pages)
      clusterOf.set(member.pageId, { id: cluster.id, role: member.role })
  }
  return data.pages.map((page) => ({
    id: page.id,
    url: page.url,
    title: page.title,
    tracked: isWorkingStatus(page.status),
    clusterId: clusterOf.get(page.id)?.id ?? null,
    role: clusterOf.get(page.id)?.role ?? null,
    wordCount: words.get(page.id) ?? null,
    promptCount: prompts.get(page.id) ?? 0
  }))
}

/** "Another own page cited instead": the page a prompt belongs to, and the own page Google cited. */
function ownCitations(db: SqliteDatabase, data: StructureData): OwnCitationPair[] {
  const byUrl = new Map(data.pages.map((page) => [normalize(page.url), page.id]))
  const rows = db
    .prepare<unknown[], { page_id: string; url: string; label: string }>(
      `SELECT DISTINCT r.page_id, a.url, p.label
       FROM aio_references a
       JOIN serp_results s ON s.id = a.serp_result_id
       JOIN runs r ON r.id = s.run_id
       JOIN prompts p ON p.id = s.prompt_id
       WHERE a.classification = 'own' AND r.status = 'finished'
       LIMIT 2000`
    )
    .all()
  const pairs: OwnCitationPair[] = []
  for (const row of rows) {
    const cited = byUrl.get(normalize(row.url))
    if (cited === undefined || cited === row.page_id) continue
    pairs.push({ pageId: row.page_id, citedPageId: cited, promptLabel: row.label })
  }
  return pairs
}

function normalize(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const path = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`
    return `${host}${path}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function isPage(page: StructurePageRow | undefined): page is StructurePageRow {
  return page !== undefined
}
