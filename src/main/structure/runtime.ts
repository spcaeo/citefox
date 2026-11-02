import type { SitemapSyncReport, SitemapSyncTrigger } from '@shared/domain'
import { generateGaps } from '../engine/gaps'
import type { EngineHost } from '../engine/host'
import { startPageRead } from '../engine/page-read'
import { withProject } from '../engine/project-db'
import { emitMainEvent } from '../ipc-events'
import { IpcRequestError } from '../ipc-request'
import type { AddressLookup } from '../pipeline/fetch-guard'
import type { HttpTransport } from '../providers/http'
import { readProjectProfile } from '../storage/project-profile'
import { getSitemapByUrl, insertSitemap } from '../storage/sitemap-records'
import { discoverSitemaps, type CrawlContext } from './crawl'
import type { SitemapFetchDeps } from './fetch'
import { runSitemapSync } from './sync'
import { normalizePageUrl } from './url-rules'

/**
 * What the structure handlers and the scheduled sync loop share: the guarded
 * sitemap transport, the re-read hook for changed pages, and one sync at a
 * time per project.
 */
export interface StructureRuntimeOptions {
  /** Test and dev-build seam: the sitemap transport and DNS. Production uses the host's. */
  sitemapFetch?: { http: HttpTransport; dns: AddressLookup }
  /** Re-reads one tracked page after its lastmod changed. Defaults to a page read (and gaps). */
  reread?: (projectId: string, pageId: string, withGaps: boolean) => Promise<void>
}

export interface StructureRuntime {
  host: EngineHost
  fetchDeps(): SitemapFetchDeps
  isSyncing(projectId: string): boolean
  /** `discover`: null reads robots.txt first; a URL adds that sitemap first. */
  sync(
    projectId: string,
    trigger: Exclude<SitemapSyncTrigger, 'first_read'>,
    discover?: { url: string | null }
  ): Promise<SitemapSyncReport>
  /** Resolves when queued re-reads for the project are done (tests). */
  rereadsIdle(projectId: string): Promise<void>
}

export function createStructureRuntime(
  host: EngineHost,
  options: StructureRuntimeOptions = {}
): StructureRuntime {
  const running = new Map<string, Promise<SitemapSyncReport>>()
  const rereadChains = new Map<string, Promise<void>>()
  const reread =
    options.reread ??
    (async (projectId: string, pageId: string, withGaps: boolean): Promise<void> => {
      await startPageRead(host, { projectId, pageId, reader: 'auto', suppliedText: null })
      if (withGaps) await generateGaps(host, { projectId, pageId })
    })

  const fetchDeps = (): SitemapFetchDeps => ({
    http: options.sitemapFetch?.http ?? host.http,
    ...(options.sitemapFetch !== undefined
      ? { dns: options.sitemapFetch.dns }
      : host.pageDns !== undefined
        ? { dns: host.pageDns }
        : {}),
    logger: host.logger,
    secrets: host.knownSecrets
  })

  function queueRereads(
    projectId: string,
    pages: ReadonlyArray<{ pageId: string; withGaps: boolean }>
  ): void {
    if (pages.length === 0) return
    let chain = rereadChains.get(projectId) ?? Promise.resolve()
    for (const page of pages) {
      chain = chain.then(() =>
        reread(projectId, page.pageId, page.withGaps).catch((error: unknown) => {
          host.logger.warn('sitemap re-read failed', {
            message: error instanceof Error ? error.message : 'failed'
          })
        })
      )
    }
    rereadChains.set(projectId, chain)
  }

  async function runSync(
    projectId: string,
    trigger: Exclude<SitemapSyncTrigger, 'first_read'>,
    discover: { url: string | null } | undefined
  ): Promise<SitemapSyncReport> {
    const channel = trigger === 'scheduled' ? 'sitemaps:scheduled' : 'sitemaps:sync'
    const startedAt = host.now().toISOString()
    const outcome = await withProject(host, projectId, channel, async (opened) => {
      const profile = readProjectProfile(opened.db)
      const ctx: CrawlContext = {
        db: opened.db,
        fetch: fetchDeps(),
        domain: opened.project.domain,
        includeSubdomains: profile?.includeSubdomains ?? false,
        now: startedAt,
        createId: host.createId
      }
      const problems: string[] = []
      if (discover !== undefined) {
        if (discover.url === null) {
          const found = await discoverSitemaps(ctx)
          if (found.problem !== null) problems.push(found.problem)
        } else {
          addUserSitemap(ctx, discover.url, channel)
        }
      } else if (!opened.db.prepare(`SELECT 1 AS ok FROM sitemaps LIMIT 1`).get()) {
        const found = await discoverSitemaps(ctx)
        if (found.problem !== null) problems.push(found.problem)
      }
      const result = await runSitemapSync({
        ...ctx,
        now: host.now().toISOString(),
        projectId,
        trigger,
        reportId: `sync-${host.createId()}`,
        startedAt
      })
      if (problems.length === 0) return result
      return {
        ...result,
        report: { ...result.report, problems: [...problems, ...result.report.problems] }
      }
    })
    queueRereads(projectId, outcome.reread)
    emitMainEvent('sitemaps:syncFinished', { projectId, report: outcome.report })
    return outcome.report
  }

  return {
    host,
    fetchDeps,
    isSyncing: (projectId) => running.has(projectId),
    sync(projectId, trigger, discover) {
      const current = running.get(projectId)
      if (current !== undefined) return current
      const next = runSync(projectId, trigger, discover).finally(() => {
        running.delete(projectId)
      })
      running.set(projectId, next)
      return next
    },
    rereadsIdle: (projectId) => rereadChains.get(projectId) ?? Promise.resolve()
  }
}

/** Adds a sitemap the user typed (FR-19.1). Own-domain rules apply to its pages, not to it. */
export function addUserSitemap(ctx: CrawlContext, raw: string, channel: string): string {
  const url = normalizePageUrl(raw)
  if (url === null)
    throw new IpcRequestError(channel, 'Enter the sitemap’s full http or https address.')
  const existing = getSitemapByUrl(ctx.db, url)
  if (existing !== null) return existing.id
  const id = `sitemap-${ctx.createId()}`
  insertSitemap(ctx.db, {
    id,
    url,
    parentId: null,
    source: 'user',
    included: true,
    createdAt: ctx.now
  })
  return id
}
