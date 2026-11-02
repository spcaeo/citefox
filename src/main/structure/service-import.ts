import { DEFAULT_SAMPLE_COUNT, type Market } from '@shared/domain'
import type {
  ClaudePickRequest,
  ClaudePickResult,
  ImportCandidate,
  ImportCandidateList,
  ImportEstimate,
  ImportEstimateRequest,
  ImportTrackRequest,
  ImportTrackResult,
  ParsedImportUrls,
  ParseImportUrlsRequest
} from '@shared/ipc'
import { searchesLeft } from '../connection-status'
import { completeAssist } from '../engine/assist'
import { resolveMarkets } from '../engine/pages'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { estimateCheckSearches } from '../queue/estimate'
import { listClusters } from '../storage/cluster-records'
import type { SqliteDatabase } from '../storage/database'
import { listSiloSettings } from '../storage/group-records'
import { usageMonth } from '../keys/present'
import { withCountedSearches } from '../storage/key-usage'
import { getPage, updateStoredPage } from '../storage/pages'
import { listApiKeys } from '../storage/records'
import { listMarkets, readProjectProfile } from '../storage/project-profile'
import { readProjectSchedule, readProjectScheduleCap } from '../storage/project-schedule'
import { listSitemaps, sitemapFactsByPage } from '../storage/sitemap-records'
import {
  insertUntrackedPage,
  isWorkingStatus,
  listStructurePages,
  type StructurePageRow
} from '../storage/structure-pages'
import { buildPickPrompt, pageRefs, parseClaudePick } from './claude-prompts'
import { fileName } from './crawl'
import { structureProducts, withTrackedCounts } from './product-context'
import type { StructureRuntime } from './runtime'
import { buildSilos } from './silos'
import { defaultMarketIds, trackInProject } from './track'
import {
  isMoneyPage,
  isOwnDomainUrl,
  normalizePageUrl,
  parseImportText,
  topFolderOf,
  validateImportEntries
} from './url-rules'

/** FR-20.6. Claude work to set one page up: page summary, buyer profile, and prompts. */
export const CLAUDE_CALLS_PER_PAGE = 3
const STAGGER_DAYS = 7

/** Every page found, with what the selection rules need. */
export function importCandidates(
  rt: StructureRuntime,
  projectId: string
): Promise<ImportCandidateList> {
  return withProject(rt.host, projectId, 'import:candidates', (opened) => {
    const db = opened.db
    const pages = listStructurePages(db)
    const rows = candidateRows(db, pages)
    const folders = new Map<string, { pageCount: number; trackedCount: number }>()
    for (const row of rows) {
      const entry = folders.get(row.folder) ?? { pageCount: 0, trackedCount: 0 }
      entry.pageCount += 1
      if (row.alreadyTracked) entry.trackedCount += 1
      folders.set(row.folder, entry)
    }
    const sitemaps = listSitemaps(db)
    const clusters = listClusters(db)
    const pageIds = new Set(pages.map((page) => page.id))
    return {
      projectId,
      rows,
      folders: [...folders.entries()]
        .map(([folder, count]) => ({ folder, ...count }))
        .sort(
          (left, right) =>
            right.pageCount - left.pageCount || left.folder.localeCompare(right.folder)
        ),
      clusters: clusters
        .map((cluster) => ({
          id: cluster.id,
          name: cluster.name,
          pageCount: cluster.pages.filter((member) => pageIds.has(member.pageId)).length
        }))
        .filter((cluster) => cluster.pageCount > 0),
      hasLinkData: false,
      sitemapCount: sitemaps.filter((sitemap) => sitemap.included && sitemap.kind === 'urlset')
        .length,
      skippedSitemaps: sitemaps
        .filter((sitemap) => !sitemap.included)
        .map((sitemap) => fileName(sitemap.url)),
      trackedCount: rows.filter((row) => row.alreadyTracked).length,
      markets: projectMarkets(db)
    }
  })
}

/** Pasted URLs or a CSV `url` column, own domain only (FR-20.6). */
export function parseImportUrls(
  rt: StructureRuntime,
  request: ParseImportUrlsRequest
): Promise<ParsedImportUrls> {
  const channel = 'import:parseUrls'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const parsed = parseImportText(request.text, request.format)
    if (parsed.error !== null && parsed.entries.length === 0)
      throw new IpcRequestError(channel, parsed.error)
    const includeSubdomains = readProjectProfile(opened.db)?.includeSubdomains ?? false
    const checked = validateImportEntries(parsed.entries, opened.project.domain, includeSubdomains)
    const pages = listStructurePages(opened.db)
    const known = new Map(candidateRows(opened.db, pages).map((row) => [row.url, row]))
    const rows = checked.accepted.map((entry): ImportCandidate => {
      const row = known.get(entry.url) ?? newCandidate(entry.url)
      // The file's Label column rides along to Track (W3I-C2).
      return entry.label ? { ...row, label: entry.label.slice(0, PAGE_LABEL_MAX) } : row
    })
    return { rows, rejected: checked.rejected, duplicates: checked.duplicates }
  })
}

export function importEstimate(
  rt: StructureRuntime,
  request: ImportEstimateRequest
): Promise<ImportEstimate> {
  return withProject(rt.host, request.projectId, 'import:estimate', (opened) => {
    const perPage = estimateCheckSearches({
      prompts: request.promptCount,
      markets: request.marketCount,
      samples: request.samples
    })
    const minSearches = perPage.minSearches * request.pageCount
    const maxSearches = perPage.maxSearches * request.pageCount
    const checksPerMonth = 30 / request.intervalDays
    const keys = listApiKeys(rt.host.storage.db)
    const left = searchesLeft(
      withCountedSearches(rt.host.storage.db, keys, usageMonth(rt.host.now()))
    )
    const projectCap = readProjectScheduleCap(opened.db).cap
    const plan = monthlyPlan(keys, projectCap)
    const days = request.stagger ? STAGGER_DAYS : 1
    return {
      minSearches,
      maxSearches,
      checksPerMonth,
      monthlyMin: Math.round(minSearches * checksPerMonth),
      monthlyMax: Math.round(maxSearches * checksPerMonth),
      searchesLeft: left,
      monthlyPlan: plan,
      perDayMin: Math.ceil(minSearches / days),
      perDayMax: Math.ceil(maxSearches / days),
      firstRoundFits: left === null ? null : maxSearches <= left,
      monthlyFits: plan === null ? null : Math.round(maxSearches * checksPerMonth) <= plan,
      claudeCalls: request.setupPageCount * CLAUDE_CALLS_PER_PAGE
    }
  })
}

/** FR-20.6 "Claude's pick" through the configured Claude connection. */
export async function claudePick(
  rt: StructureRuntime,
  request: ClaudePickRequest
): Promise<ClaudePickResult> {
  const channel = 'import:claudePick'
  const { rows, context, productOf } = await withProject(
    rt.host,
    request.projectId,
    channel,
    (opened) => {
      const candidates = candidateRows(opened.db, listStructurePages(opened.db))
      const products = structureProducts(opened.db, opened.project.domain)
      const named = new Map(
        candidates.map((row) => [
          row,
          products.productOf({ id: row.pageId, url: row.url, title: row.title })
        ])
      )
      const tracked = candidates.filter((row) => row.alreadyTracked)
      return {
        rows: candidates,
        context: withTrackedCounts(
          products.context,
          tracked.map((row) => named.get(row) ?? null)
        ),
        productOf: (row: ImportCandidate) => named.get(row) ?? null
      }
    }
  )
  const open = rows.filter((row) => !row.alreadyTracked && row.pageId !== null)
  if (open.length === 0) throw new IpcRequestError(channel, 'Every page found is already tracked.')
  const ids = new Set(open.map((row) => row.pageId ?? ''))
  const refs = pageRefs(open.map((row) => ({ id: row.pageId ?? '' })))
  const prompt = buildPickPrompt(
    open.map((row) => ({
      id: row.pageId ?? '',
      path: row.path,
      title: row.title,
      lastmod: row.lastmod,
      moneyPage: row.moneyPage,
      tracked: row.alreadyTracked,
      clusterName: row.clusterName,
      product: productOf(row)
    })),
    request.instruction,
    context
  )
  const reply = await completeAssist(
    rt.host,
    channel,
    prompt,
    (value) => parseClaudePick(value, ids, refs) !== null,
    null,
    { assistId: 'structure.import', projectId: request.projectId }
  )
  const parsed = parseClaudePick(reply, ids, refs)
  if (parsed === null)
    throw new IpcRequestError(channel, 'The CiteFox AI reply could not be used. Try again.')
  return parsed
}

/** FR-20.6 "Track N pages". Pasted URLs not in the project are added first. */
export function importTrack(
  rt: StructureRuntime,
  request: ImportTrackRequest
): Promise<ImportTrackResult> {
  const channel = 'import:track'
  return withProject(rt.host, request.projectId, channel, (opened) => {
    const db = opened.db
    const markets = resolveMarkets(rt.host, db, request.markets, channel)
    if (markets.length === 0)
      throw new IpcRequestError(channel, 'Add a market or set the project default')
    const includeSubdomains = readProjectProfile(db)?.includeSubdomains ?? false
    const pages = listStructurePages(db, { includeRemoved: true })
    const byUrl = new Map(pages.map((page) => [page.url, page]))
    const byId = new Map(pages.map((page) => [page.id, page]))
    const schedule = readProjectSchedule(db, request.projectId)
    const ids: string[] = []
    let added = 0
    db.transaction(() => {
      for (const raw of request.urls) {
        const url = normalizePageUrl(raw)
        if (url === null || !isOwnDomainUrl(url, opened.project.domain, includeSubdomains)) {
          throw new IpcRequestError(channel, `Only ${opened.project.domain} pages can be imported.`)
        }
        const existing = byUrl.get(url)
        if (existing !== undefined && existing.status !== 'removed') {
          ids.push(existing.id)
          continue
        }
        if (existing !== undefined) {
          db.prepare(`UPDATE pages SET status = 'not_tracked' WHERE id = ?`).run(existing.id)
          ids.push(existing.id)
          continue
        }
        const id = `page-${rt.host.createId()}`
        insertUntrackedPage(
          db,
          { id, projectId: request.projectId, url, folder: folderName(url) },
          {
            intervalDays: schedule.defaultIntervalDays,
            samples: DEFAULT_SAMPLE_COUNT,
            promptCount: request.promptCount
          }
        )
        added += 1
        ids.push(id)
      }
    })()
    for (const id of request.pageIds) {
      const page = byId.get(id)
      if (page === undefined || page.status === 'removed') {
        throw new IpcRequestError(
          channel,
          'A selected page is no longer in this project. Reload and try again.'
        )
      }
      ids.push(id)
    }
    const unique = [...new Set(ids)]
    applyFileLabels(db, request, opened.project.id)
    const outcome = trackInProject(rt.host, db, unique, {
      marketIds: markets.map((market) => market.id),
      intervalDays: request.intervalDays,
      samples: request.samples,
      promptCount: request.promptCount,
      stagger: request.stagger
    })
    const skipped = unique.length - outcome.changed.length
    return {
      trackedCount: outcome.changed.length,
      addedCount: added,
      skippedCount: skipped,
      firstCheckFrom: outcome.firstCheckFrom,
      firstCheckUntil: outcome.firstCheckUntil
    }
  })
}

/** Longest page label (as `pages:update` stores it). */
const PAGE_LABEL_MAX = 80

/**
 * Labels from an imported file (W3I-C2): a page with no label yet takes its file
 * label; one set in CiteFox stays. Pages are found by their normalized URL.
 */
function applyFileLabels(db: SqliteDatabase, request: ImportTrackRequest, projectId: string): void {
  if (request.labels === undefined || request.labels.length === 0) return
  const byUrl = new Map(
    listStructurePages(db, { includeRemoved: true }).map((page) => [page.url, page.id])
  )
  for (const entry of request.labels) {
    const url = normalizePageUrl(entry.url)
    const label = entry.label.trim().slice(0, PAGE_LABEL_MAX)
    const pageId = url === null ? undefined : byUrl.get(url)
    if (pageId === undefined || label.length === 0) continue
    const page = getPage(db, pageId, projectId)
    if (page === null || (page.label ?? '').trim().length > 0) continue
    updateStoredPage(db, pageId, projectId, { label })
  }
}

/** Project markets, default first. */
export function projectMarkets(db: SqliteDatabase): Market[] {
  const defaultId = readProjectProfile(db)?.market.id ?? null
  const markets = listMarkets(db)
  return [
    ...markets.filter((market) => market.id === defaultId),
    ...markets.filter((market) => market.id !== defaultId)
  ]
}

function candidateRows(db: SqliteDatabase, pages: readonly StructurePageRow[]): ImportCandidate[] {
  const facts = sitemapFactsByPage(db)
  const clusterOf = new Map<string, { id: string; name: string }>()
  for (const cluster of listClusters(db)) {
    for (const member of cluster.pages)
      clusterOf.set(member.pageId, { id: cluster.id, name: cluster.name })
  }
  const ready = setUpPages(db)
  const sitemapsOf = sitemapIdsByPage(db)
  const silos = buildSilos(
    pages.map((page) => ({ id: page.id, url: page.url, working: isWorkingStatus(page.status) })),
    listSiloSettings(db),
    defaultMarketIds(db)
  )
  return pages.map((page) => {
    const cluster = clusterOf.get(page.id)
    return {
      pageId: page.id,
      url: page.url,
      path: pathOf(page.url),
      title: page.title,
      folder: topFolderOf(page.url),
      clusterId: cluster?.id ?? null,
      clusterName: cluster?.name ?? null,
      lastmod: facts.get(page.id)?.lastmod ?? null,
      internalLinks: null,
      moneyPage: isMoneyPage(page.url),
      alreadyTracked: isWorkingStatus(page.status),
      status: page.status,
      needsSetup: !ready.has(page.id),
      sitemapIds: sitemapsOf.get(page.id) ?? [],
      siloPath: silos.pathOf.get(page.id) ?? '/'
    }
  })
}

/** Every sitemap that lists each page now (a page can be in more than one). */
function sitemapIdsByPage(db: SqliteDatabase): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const rows = db
    .prepare<unknown[], { page_id: string; sitemap_id: string }>(
      `SELECT page_id, sitemap_id FROM sitemap_entries
       WHERE page_id IS NOT NULL AND removed_at IS NULL`
    )
    .all()
  for (const row of rows) {
    const list = out.get(row.page_id)
    if (list) {
      if (!list.includes(row.sitemap_id)) list.push(row.sitemap_id)
    } else out.set(row.page_id, [row.sitemap_id])
  }
  return out
}

function newCandidate(url: string): ImportCandidate {
  return {
    pageId: null,
    url,
    path: pathOf(url),
    title: null,
    folder: topFolderOf(url),
    clusterId: null,
    clusterName: null,
    lastmod: null,
    internalLinks: null,
    moneyPage: isMoneyPage(url),
    alreadyTracked: false,
    status: null,
    needsSetup: true
  }
}

/** Pages with an active prompt set (read and profile come before it). */
function setUpPages(db: SqliteDatabase): Set<string> {
  return new Set(
    db
      .prepare<unknown[], { page_id: string }>(
        `SELECT page_id FROM prompt_sets WHERE is_active = 1`
      )
      .all()
      .map((row) => row.page_id)
  )
}

/** Tested, enabled SerpApi keys: the tighter of plan and cap each, summed; then the project cap. */
function monthlyPlan(
  keys: ReturnType<typeof listApiKeys>,
  projectCap: number | null
): number | null {
  let total = 0
  let any = false
  for (const key of keys) {
    if (key.provider !== 'serpapi' || !key.on || key.state === 'unchecked') continue
    const limits: number[] = []
    if (key.serpapiUsage?.planLimit != null) limits.push(key.serpapiUsage.planLimit)
    if (key.cap !== null) limits.push(key.cap)
    if (limits.length === 0) continue
    any = true
    total += Math.min(...limits)
  }
  if (projectCap !== null) return any ? Math.min(total, projectCap) : projectCap
  return any ? total : null
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function folderName(url: string): string | null {
  const folder = topFolderOf(url)
  return folder === '/' ? null : folder.slice(1, -1)
}
