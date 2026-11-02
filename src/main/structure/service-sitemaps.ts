import type { SitemapSyncReport } from '@shared/domain'
import type {
  DiscoverSitemapsRequest,
  SetSitemapIncludedRequest,
  SetSitemapRulesRequest,
  SitemapIdRequest,
  SitemapOverview,
  SitemapUrlRequest
} from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'
import {
  deleteSitemap,
  getSitemap,
  latestSyncReport,
  listSitemapEntries,
  listSitemaps,
  readSitemapSettings,
  recordSitemapRead,
  setSitemapIncluded,
  upsertSitemapEntries,
  writeSitemapRules
} from '../storage/sitemap-records'
import { isWorkingStatus, listStructurePages, setPageStatuses } from '../storage/structure-pages'
import { addUserSitemap, type StructureRuntime } from './runtime'

const DAY_MS = 86_400_000

/** FR-19.1 to FR-19.3: the Sitemaps card, sync settings, and last report. */
export function sitemapOverview(
  rt: StructureRuntime,
  projectId: string,
  channel: string
): Promise<SitemapOverview> {
  return withProject(rt.host, projectId, channel, (opened) => overviewOf(rt, opened.db, projectId))
}

export function overviewOf(
  rt: StructureRuntime,
  db: SqliteDatabase,
  projectId: string
): SitemapOverview {
  const settings = readSitemapSettings(db)
  const pages = listStructurePages(db)
  return {
    projectId,
    sitemaps: listSitemaps(db),
    rules: settings.rules,
    foundPageCount: pages.length,
    trackedPageCount: pages.filter((page) => isWorkingStatus(page.status)).length,
    lastSync: latestSyncReport(db),
    nextSyncAt: nextSyncAt(settings.rules.frequency, settings.lastSyncAt, rt.host.now()),
    syncing: rt.isSyncing(projectId)
  }
}

export function nextSyncAt(
  frequency: 'daily' | 'weekly' | 'manual',
  lastSyncAt: string | null,
  now: Date
): string | null {
  if (frequency === 'manual') return null
  if (lastSyncAt === null) return now.toISOString()
  const step = frequency === 'daily' ? DAY_MS : 7 * DAY_MS
  return new Date(Date.parse(lastSyncAt) + step).toISOString()
}

export function discoverSitemaps(
  rt: StructureRuntime,
  request: DiscoverSitemapsRequest
): Promise<SitemapSyncReport> {
  const url = request.url === null || request.url.length === 0 ? null : request.url
  return rt.sync(request.projectId, 'manual', { url })
}

export function syncNow(rt: StructureRuntime, projectId: string): Promise<SitemapSyncReport> {
  return rt.sync(projectId, 'manual')
}

/** Adds a sitemap URL. It is read on the next sync ("Read on the next sync"). */
export function addSitemap(
  rt: StructureRuntime,
  request: SitemapUrlRequest
): Promise<SitemapOverview> {
  const channel = 'sitemaps:add'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const id = addUserSitemap(
      {
        db: opened.db,
        fetch: rt.fetchDeps(),
        domain: opened.project.domain,
        includeSubdomains: false,
        now: rt.host.now().toISOString(),
        createId: rt.host.createId
      },
      request.url,
      channel
    )
    const sitemap = getSitemap(opened.db, id)
    if (sitemap !== null && !sitemap.included) setSitemapIncluded(opened.db, id, true)
    return overviewOf(rt, opened.db, request.projectId)
  })
}

/** Only sitemaps the user added can be removed. Found ones are skipped instead. */
export function removeSitemap(
  rt: StructureRuntime,
  request: SitemapIdRequest
): Promise<SitemapOverview> {
  const channel = 'sitemaps:remove'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const sitemap = getSitemap(opened.db, request.sitemapId)
    if (sitemap === null) throw new IpcRequestError(channel, 'That sitemap was not found')
    if (sitemap.source !== 'user') {
      throw new IpcRequestError(
        channel,
        'CiteFox found this sitemap. Untick it to leave its pages out.'
      )
    }
    opened.db.transaction(() => {
      leaveOut(
        opened.db,
        request.projectId,
        sitemapFamily(opened.db, sitemap.id),
        rt.host.now().toISOString()
      )
      deleteSitemap(opened.db, sitemap.id)
    })()
    return overviewOf(rt, opened.db, request.projectId)
  })
}

/**
 * FR-19.1 include or skip. Skipping leaves the sitemap's untracked pages out
 * at once (tracked pages keep their history and stay). Including again reads
 * it on the next sync.
 */
export function setIncluded(
  rt: StructureRuntime,
  request: SetSitemapIncludedRequest
): Promise<SitemapOverview> {
  const channel = 'sitemaps:setIncluded'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const sitemap = getSitemap(opened.db, request.sitemapId)
    if (sitemap === null) throw new IpcRequestError(channel, 'That sitemap was not found')
    if (sitemap.kind === 'index' && !request.included) {
      throw new IpcRequestError(
        channel,
        'The sitemap index is always read. Untick the sitemaps it lists instead.'
      )
    }
    opened.db.transaction(() => {
      setSitemapIncluded(opened.db, sitemap.id, request.included)
      if (request.included) {
        recordSitemapRead(opened.db, sitemap.id, {
          kind: sitemap.kind,
          state: 'pending',
          lastReadAt: null,
          lastChangedAt: null,
          pageCount: sitemap.pageCount,
          error: null
        })
      } else {
        leaveOut(
          opened.db,
          request.projectId,
          sitemapFamily(opened.db, sitemap.id),
          rt.host.now().toISOString()
        )
      }
    })()
    return overviewOf(rt, opened.db, request.projectId)
  })
}

export function setRules(
  rt: StructureRuntime,
  request: SetSitemapRulesRequest
): Promise<SitemapOverview> {
  return withProject(rt.host, request.projectId, 'sitemaps:setRules', (opened) => {
    writeSitemapRules(opened.db, request.rules)
    return overviewOf(rt, opened.db, request.projectId)
  })
}

function sitemapFamily(db: SqliteDatabase, id: string): Set<string> {
  const family = new Set<string>([id])
  for (const sitemap of listSitemaps(db)) if (sitemap.parentId === id) family.add(sitemap.id)
  return family
}

/** Untracked pages listed only by these sitemaps are left out; their entries are closed. */
function leaveOut(
  db: SqliteDatabase,
  projectId: string,
  sitemapIds: ReadonlySet<string>,
  at: string
): void {
  const pages = new Map(listStructurePages(db).map((page) => [page.id, page]))
  const entries = listSitemapEntries(db).filter(
    (entry) => entry.removedAt === null && sitemapIds.has(entry.sitemapId)
  )
  const untracked: string[] = []
  for (const entry of entries) {
    const page = entry.pageId === null ? undefined : pages.get(entry.pageId)
    if (page !== undefined && !isWorkingStatus(page.status)) untracked.push(page.id)
  }
  upsertSitemapEntries(
    db,
    entries.map((entry) => ({ ...entry, removedAt: at }))
  )
  if (untracked.length > 0) setPageStatuses(db, projectId, untracked, 'removed')
}
