import {
  DEFAULT_PROMPT_COUNT,
  DEFAULT_SAMPLE_COUNT,
  type PageStatus,
  type SitemapSyncReport,
  type SitemapSyncRules,
  type SitemapSyncTrigger,
  type SyncPageAction,
  type SyncPageChange
} from '@shared/domain'
import { addPageToCluster, listClusters } from '../storage/cluster-records'
import type { SqliteDatabase } from '../storage/database'
import { listSiloSettings } from '../storage/group-records'
import { readProjectSchedule } from '../storage/project-schedule'
import {
  getSitemap,
  insertSyncReport,
  listSitemapEntries,
  listSitemaps,
  readSitemapSettings,
  upsertSitemapEntries,
  writeLastSyncAt,
  type SitemapEntry
} from '../storage/sitemap-records'
import {
  insertUntrackedPage,
  isWorkingStatus,
  listStructurePages,
  setPageStatuses,
  type StructurePageRow
} from '../storage/structure-pages'
import { assignToCluster } from './cluster-rules'
import { crawlSitemaps, type CrawlContext, type CrawlResult } from './crawl'
import { candidateChain, effectiveMarkets, siloTracksAll } from './silos'
import { defaultMarketIds, trackInProject } from './track'
import { topFolderOf } from './url-rules'

/** Page rows listed per section of a report. Counts are not capped. */
export const REPORT_LIST_CAP = 200

export interface SyncInput extends CrawlContext {
  projectId: string
  trigger: SitemapSyncTrigger
  reportId: string
  startedAt: string
}

/** Pages a sync wants re-read after it is saved (FR-19.2 changed lastmod). */
export interface SyncOutcome {
  report: SitemapSyncReport
  reread: Array<{ pageId: string; withGaps: boolean }>
}

/**
 * One sitemap sync (FR-19.1 to FR-19.3, FR-19.6): read the included sitemaps,
 * compare with the stored entries, apply the rules, and save the report.
 * The first read of a project is a baseline: every page is added as not
 * tracked and no rule runs. A sitemap that failed this time keeps its pages.
 */
export async function runSitemapSync(input: SyncInput): Promise<SyncOutcome> {
  const crawl = await crawlSitemaps(input)
  const { db } = input
  const settings = readSitemapSettings(db)
  const entries = listSitemapEntries(db)
  const firstRead = !entries.some((entry) => entry.removedAt === null)
  const trigger: SitemapSyncTrigger = firstRead ? 'first_read' : input.trigger
  const plan = db.transaction(() => applyDiff(input, crawl, entries, settings.rules, firstRead))()
  const finishedAt = input.now
  const failed = crawl.failedIds.size
  const status: SitemapSyncReport['status'] =
    crawl.readCount === 0 && failed > 0 ? 'error' : failed > 0 ? 'partial' : 'ok'
  const report: SitemapSyncReport = {
    id: input.reportId,
    trigger,
    startedAt: input.startedAt,
    finishedAt,
    status,
    sitemapsRead: crawl.readCount,
    sitemapsFailed: failed,
    pageCount: crawl.seen.size,
    otherDomainCount: crawl.otherDomainCount,
    newCount: plan.newPages.length,
    removedCount: plan.removedPages.length,
    changedCount: plan.changedPages.length,
    newPages: plan.newPages.slice(0, REPORT_LIST_CAP),
    removedPages: plan.removedPages.slice(0, REPORT_LIST_CAP),
    changedPages: plan.changedPages.slice(0, REPORT_LIST_CAP),
    problems: crawl.problems.slice(0, 20),
    nextStep:
      status === 'error'
        ? 'Check the sitemap address on Site structure, then press Sync now.'
        : status === 'partial'
          ? 'Some sitemaps could not be read. Their pages were kept; sync again later.'
          : listSitemaps(db).length === 0
            ? 'Add your sitemap URL on Site structure.'
            : null
  }
  db.transaction(() => {
    insertSyncReport(db, report)
    writeLastSyncAt(db, finishedAt)
  })()
  return { report, reread: plan.reread }
}

interface DiffPlan {
  newPages: SyncPageChange[]
  removedPages: SyncPageChange[]
  changedPages: SyncPageChange[]
  reread: Array<{ pageId: string; withGaps: boolean }>
}

function applyDiff(
  input: SyncInput,
  crawl: CrawlResult,
  entries: readonly SitemapEntry[],
  rules: SitemapSyncRules,
  firstRead: boolean
): DiffPlan {
  const { db } = input
  const pages = listStructurePages(db, { includeRemoved: true })
  const byUrl = new Map(pages.map((page) => [page.url, page]))
  const byId = new Map(pages.map((page) => [page.id, page]))
  const active = new Map(
    entries.filter((entry) => entry.removedAt === null).map((entry) => [entry.url, entry])
  )
  const known = new Map(entries.map((entry) => [entry.url, entry]))
  const sitemapUrl = sitemapUrlLookup(db)
  const clusters = listClusters(db)
  const clusterName = new Map(clusters.map((cluster) => [cluster.id, cluster.name]))
  const pageCluster = new Map<string, string>()
  for (const cluster of clusters)
    for (const member of cluster.pages) pageCluster.set(member.pageId, cluster.id)
  const silos = listSiloSettings(db)
  const defaults = defaultMarketIds(db)
  const schedule = readProjectSchedule(db, input.projectId)
  const plan: DiffPlan = { newPages: [], removedPages: [], changedPages: [], reread: [] }
  const writes: SitemapEntry[] = []
  const toTrack = new Map<string, string[]>()

  for (const [url, seen] of crawl.seen) {
    const previous = active.get(url)
    let page = byUrl.get(url)
    if (previous !== undefined) {
      const changed = previous.lastmod !== seen.lastmod && seen.lastmod !== null
      writes.push({
        ...previous,
        sitemapId: seen.sitemapId,
        pageId: page?.id ?? previous.pageId,
        lastmod: seen.lastmod,
        lastSeenAt: input.now,
        removedAt: null
      })
      if (changed && previous.lastmod !== null && page !== undefined && page.status !== 'removed') {
        const tracked = isWorkingStatus(page.status)
        let action: SyncPageAction = 'date_updated'
        if (tracked && rules.onChanged !== 'nothing') {
          action = 'reread_queued'
          plan.reread.push({ pageId: page.id, withGaps: rules.onChanged === 'reread_gaps' })
        }
        plan.changedPages.push(
          change(
            page.id,
            url,
            sitemapUrl(seen.sitemapId),
            seen.lastmod,
            tracked,
            action,
            clusterOf(page.id)
          )
        )
      }
      continue
    }
    // New to the sitemap.
    let action: SyncPageAction = 'added_untracked'
    let wasTracked = false
    if (page === undefined) {
      const id = `page-${input.createId()}`
      insertUntrackedPage(
        db,
        { id, projectId: input.projectId, url, folder: folderName(url) },
        {
          intervalDays: schedule.defaultIntervalDays,
          samples: DEFAULT_SAMPLE_COUNT,
          promptCount: DEFAULT_PROMPT_COUNT
        }
      )
      page = { id, url, title: null, status: 'not_tracked', score: null, defaultMarketId: null }
      byUrl.set(url, page)
      byId.set(id, page)
    } else if (page.status === 'removed') {
      setPageStatuses(db, input.projectId, [page.id], 'not_tracked')
      page = { ...page, status: 'not_tracked' }
    } else {
      wasTracked = isWorkingStatus(page.status)
      if (wasTracked) action = 'tracked'
    }
    const prior = known.get(url)
    writes.push({
      url,
      sitemapId: seen.sitemapId,
      pageId: page.id,
      lastmod: seen.lastmod,
      firstSeenAt: prior?.firstSeenAt ?? input.now,
      lastSeenAt: input.now,
      removedAt: null
    })
    if (!pageCluster.has(page.id) && clusters.length > 0) {
      const clusterId = assignToCluster({ url, title: page.title }, clusters)
      if (clusterId !== null && addPageToCluster(db, clusterId, page.id, 'supporting')) {
        pageCluster.set(page.id, clusterId)
      }
    }
    if (!firstRead && !wasTracked) {
      const silo = deepestChain(url)
      const cluster = clusters.find((item) => item.id === pageCluster.get(page.id))
      const markets = effectiveMarkets(silo, silos, defaults)
      if (
        siloTracksAll(silo, silos) ||
        cluster?.trackWhole === true ||
        rules.onNew === 'track_default'
      ) {
        queueTrack(toTrack, markets, page.id)
        action = 'tracked'
      } else if (rules.onNew === 'ask') {
        action = 'awaiting_you'
      }
    }
    plan.newPages.push(
      change(
        page.id,
        url,
        sitemapUrl(seen.sitemapId),
        seen.lastmod,
        wasTracked,
        action,
        clusterOf(page.id)
      )
    )
  }

  const excluded = new Set(
    listSitemaps(db)
      .filter((sitemap) => !sitemap.included)
      .map((sitemap) => sitemap.id)
  )
  const leftOut: string[] = []
  for (const [url, previous] of active) {
    if (crawl.seen.has(url) || crawl.failedIds.has(previous.sitemapId)) continue
    const page = previous.pageId === null ? undefined : byId.get(previous.pageId)
    writes.push({ ...previous, removedAt: input.now })
    if (page === undefined || page.status === 'removed') continue
    const tracked = isWorkingStatus(page.status)
    if (excluded.has(previous.sitemapId) && getSitemap(db, previous.sitemapId) !== null) {
      // The user skipped this sitemap: leave untracked pages out, keep tracked ones.
      if (!tracked) leftOut.push(page.id)
      continue
    }
    let action: SyncPageAction = 'removed'
    let status: PageStatus = 'removed'
    if (tracked && rules.onRemoved === 'pause') {
      action = 'paused'
      status = 'paused'
    }
    if (page.status !== status) setPageStatuses(db, input.projectId, [page.id], status)
    plan.removedPages.push(
      change(
        page.id,
        url,
        sitemapUrl(previous.sitemapId),
        previous.lastmod,
        tracked,
        action,
        clusterOf(page.id)
      )
    )
  }
  if (leftOut.length > 0) setPageStatuses(db, input.projectId, leftOut, 'removed')
  upsertSitemapEntries(db, writes)

  for (const [key, ids] of toTrack) {
    const marketIds = key.length === 0 ? defaults : key.split(',')
    if (marketIds.length === 0) continue
    trackInProject({ now: () => new Date(input.now) }, db, ids, {
      marketIds,
      intervalDays: schedule.defaultIntervalDays,
      samples: DEFAULT_SAMPLE_COUNT,
      promptCount: DEFAULT_PROMPT_COUNT,
      stagger: ids.length > 1
    })
  }
  return plan

  function clusterOf(pageId: string): string | null {
    const id = pageCluster.get(pageId)
    return id === undefined ? null : (clusterName.get(id) ?? null)
  }
}

function queueTrack(
  map: Map<string, string[]>,
  marketIds: readonly string[],
  pageId: string
): void {
  const key = marketIds.join(',')
  const list = map.get(key) ?? []
  list.push(pageId)
  map.set(key, list)
}

function change(
  pageId: string,
  url: string,
  sitemapUrl: string | null,
  lastmod: string | null,
  wasTracked: boolean,
  action: SyncPageAction,
  clusterName: string | null
): SyncPageChange {
  return { pageId, url, sitemapUrl, lastmod, wasTracked, action, clusterName }
}

function sitemapUrlLookup(db: SqliteDatabase): (id: string) => string | null {
  const urls = new Map(listSitemaps(db).map((sitemap) => [sitemap.id, sitemap.url]))
  return (id) => urls.get(id) ?? null
}

function deepestChain(url: string): string {
  return candidateChain(url).at(-1) ?? '/'
}

/** `pages.folder` keeps the top-level folder name without slashes, like AddPage. */
function folderName(url: string): string | null {
  const folder = topFolderOf(url)
  return folder === '/' ? null : folder.slice(1, -1)
}

export type { StructurePageRow }
