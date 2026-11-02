import type { SitemapRecord } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'
import {
  deleteSitemap,
  getSitemapByUrl,
  insertSitemap,
  isLowValueSitemap,
  listSitemaps,
  recordSitemapRead
} from '../storage/sitemap-records'
import { sharedReadPool } from '../pipeline/read-pool'
import { fetchSitemapText, type SitemapFetchDeps } from './fetch'
import { sitemapsFromRobots } from './robots'
import { parseSitemapXml, SitemapParseError, type SitemapUrlEntry } from './sitemap-parse'
import { bareDomain, isOwnDomainUrl, normalizePageUrl } from './url-rules'

/** FR-19.1. Nested sitemap indexes are followed this deep (the top index is depth 0). */
export const MAX_INDEX_DEPTH = 3
/** Sitemap files read in one sync. */
export const MAX_SITEMAPS_PER_SYNC = 200
/** Page URLs kept from one sync, across every sitemap. */
export const MAX_URLS_PER_SYNC = 100_000
/** Sitemap files fetched together before they are handled in order. */
export const SITEMAPS_AT_ONCE = 4

export interface CrawlContext {
  db: SqliteDatabase
  fetch: SitemapFetchDeps
  domain: string
  includeSubdomains: boolean
  now: string
  createId: () => string
}

export interface SeenUrl {
  sitemapId: string
  lastmod: string | null
}

export interface CrawlResult {
  seen: Map<string, SeenUrl>
  /** Included sitemaps that could not be read this time. Their old entries are not removed. */
  failedIds: Set<string>
  readCount: number
  otherDomainCount: number
  problems: string[]
  truncated: boolean
}

/**
 * Finds sitemaps through robots.txt (then `/sitemap.xml` and
 * `/sitemap_index.xml`). Adds what it finds; returns how many were new.
 */
export async function discoverSitemaps(
  ctx: CrawlContext
): Promise<{ added: number; problem: string | null }> {
  const origin = `https://${bareDomain(ctx.domain)}`
  const robotsUrl = `${origin}/robots.txt`
  const robots = await fetchSitemapText(ctx.fetch, robotsUrl, 'robots')
  let urls: string[] = robots.ok ? sitemapsFromRobots(robots.text, robots.finalUrl) : []
  let source: 'robots' | 'guess' = 'robots'
  if (urls.length === 0) {
    source = 'guess'
    for (const guess of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]) {
      const probe = await fetchSitemapText(ctx.fetch, guess, 'sitemap')
      if (!probe.ok) continue
      try {
        parseSitemapXml(probe.text)
        urls = [guess]
        break
      } catch {
        continue
      }
    }
  }
  let added = 0
  for (const raw of urls) {
    const url = normalizePageUrl(raw)
    if (url === null || getSitemapByUrl(ctx.db, url) !== null) continue
    insertSitemap(ctx.db, {
      id: `sitemap-${ctx.createId()}`,
      url,
      parentId: null,
      source,
      included: !isLowValueSitemap(url),
      createdAt: ctx.now
    })
    added += 1
  }
  if (urls.length === 0) {
    return {
      added,
      problem: `No sitemap found in ${bareDomain(ctx.domain)}/robots.txt or at /sitemap.xml.`
    }
  }
  return { added, problem: null }
}

/** Reads every included top-level sitemap and follows indexes (depth-limited). */
export async function crawlSitemaps(ctx: CrawlContext): Promise<CrawlResult> {
  const result: CrawlResult = {
    seen: new Map(),
    failedIds: new Set(),
    readCount: 0,
    otherDomainCount: 0,
    problems: [],
    truncated: false
  }
  const visited = new Set<string>()
  const queue: Array<{ sitemap: SitemapRecord; depth: number }> = listSitemaps(ctx.db)
    .filter((sitemap) => sitemap.parentId === null && sitemap.included)
    .map((sitemap) => ({ sitemap, depth: 0 }))
  // Sitemaps are fetched a few at a time (the read pool keeps it to two on the site) and
  // handled one by one in queue order, so what is saved matches a one-by-one crawl.
  const wave: Array<{ sitemap: SitemapRecord; depth: number }> = []
  const fetchedWave: Array<Awaited<ReturnType<typeof fetchSitemapText>>> = []
  let stopped = false
  while (wave.length > 0 || (!stopped && queue.length > 0)) {
    if (wave.length === 0) {
      while (queue.length > 0 && wave.length < SITEMAPS_AT_ONCE) {
        const queued = queue.shift()
        if (queued === undefined || visited.has(queued.sitemap.url)) continue
        visited.add(queued.sitemap.url)
        if (visited.size > MAX_SITEMAPS_PER_SYNC) {
          result.truncated = true
          result.problems.push(`Stopped after ${MAX_SITEMAPS_PER_SYNC} sitemaps.`)
          stopped = true
          break
        }
        wave.push(queued)
      }
      fetchedWave.push(
        ...(await Promise.all(
          wave.map(({ sitemap }) =>
            sharedReadPool().run(sitemap.url, () =>
              fetchSitemapText(ctx.fetch, sitemap.url, 'sitemap')
            )
          )
        ))
      )
    }
    const next = wave.shift()
    const fetched = fetchedWave.shift()
    if (next === undefined || fetched === undefined) continue
    const { sitemap, depth } = next
    if (!fetched.ok) {
      fail(ctx, result, sitemap, fetched.message)
      continue
    }
    let parsed
    try {
      parsed = parseSitemapXml(fetched.text)
    } catch (error) {
      fail(
        ctx,
        result,
        sitemap,
        error instanceof SitemapParseError ? error.message : 'This file is not a sitemap.'
      )
      continue
    }
    result.readCount += 1
    if (parsed.kind === 'index') {
      const children = syncChildren(ctx, sitemap, parsed.sitemaps)
      recordSitemapRead(ctx.db, sitemap.id, {
        kind: 'index',
        state: 'read',
        lastReadAt: ctx.now,
        lastChangedAt: newest(parsed.sitemaps),
        pageCount: children.length,
        error: null
      })
      if (depth + 1 > MAX_INDEX_DEPTH) {
        result.problems.push(
          `${fileName(sitemap.url)} nests sitemap indexes too deeply; deeper ones were skipped.`
        )
        continue
      }
      for (const child of children) {
        if (child.included) queue.push({ sitemap: child, depth: depth + 1 })
      }
      continue
    }
    let kept = 0
    for (const entry of parsed.urls) {
      const url = normalizePageUrl(entry.loc)
      if (url === null) continue
      if (!isOwnDomainUrl(url, ctx.domain, ctx.includeSubdomains)) {
        result.otherDomainCount += 1
        continue
      }
      if (result.seen.size >= MAX_URLS_PER_SYNC) {
        result.truncated = true
        break
      }
      if (!result.seen.has(url)) {
        result.seen.set(url, { sitemapId: sitemap.id, lastmod: entry.lastmod })
        kept += 1
      }
    }
    if (parsed.truncated)
      result.problems.push(
        `${fileName(sitemap.url)} lists more URLs than CiteFox reads from one file.`
      )
    recordSitemapRead(ctx.db, sitemap.id, {
      kind: 'urlset',
      state: 'read',
      lastReadAt: ctx.now,
      lastChangedAt: newest(parsed.urls),
      pageCount: kept,
      error: null
    })
  }
  if (result.truncated && !result.problems.some((line) => line.startsWith('Stopped'))) {
    result.problems.push(`Kept the first ${MAX_URLS_PER_SYNC.toLocaleString('en-US')} page URLs.`)
  }
  return result
}

/** Adds child sitemaps an index lists and drops ones it no longer lists. */
function syncChildren(
  ctx: CrawlContext,
  parent: SitemapRecord,
  listed: readonly SitemapUrlEntry[]
): SitemapRecord[] {
  const urls = new Set<string>()
  for (const entry of listed) {
    const url = normalizePageUrl(entry.loc)
    if (url !== null && url !== parent.url) urls.add(url)
  }
  const existing = listSitemaps(ctx.db).filter((sitemap) => sitemap.parentId === parent.id)
  for (const child of existing) {
    if (!urls.has(child.url)) deleteSitemap(ctx.db, child.id)
  }
  for (const url of urls) {
    if (getSitemapByUrl(ctx.db, url) !== null) continue
    insertSitemap(ctx.db, {
      id: `sitemap-${ctx.createId()}`,
      url,
      parentId: parent.id,
      source: 'index',
      included: !isLowValueSitemap(url),
      createdAt: ctx.now
    })
  }
  return listSitemaps(ctx.db).filter((sitemap) => sitemap.parentId === parent.id)
}

function fail(
  ctx: CrawlContext,
  result: CrawlResult,
  sitemap: SitemapRecord,
  message: string
): void {
  result.failedIds.add(sitemap.id)
  for (const child of listSitemaps(ctx.db)) {
    if (child.parentId === sitemap.id) result.failedIds.add(child.id)
  }
  result.problems.push(`${fileName(sitemap.url)}: ${message}`)
  recordSitemapRead(ctx.db, sitemap.id, {
    kind: sitemap.kind,
    state: 'error',
    lastReadAt: null,
    lastChangedAt: null,
    pageCount: sitemap.pageCount,
    error: message
  })
}

function newest(entries: readonly SitemapUrlEntry[]): string | null {
  let best: string | null = null
  for (const entry of entries) {
    if (entry.lastmod !== null && (best === null || entry.lastmod > best)) best = entry.lastmod
  }
  return best
}

export function fileName(url: string): string {
  try {
    const path = new URL(url).pathname
    return (
      path
        .split('/')
        .filter((part) => part.length > 0)
        .pop() ?? url
    )
  } catch {
    return url
  }
}
