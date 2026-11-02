import type { Market, PageSummary } from '@shared/domain'
import type {
  AddPageRequest,
  PageDetail,
  PageList,
  PinnedPage,
  PinnedPageList,
  RemovePageResult,
  SearchPagesResult,
  UpdatePageRequest
} from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import { rejectBlockedLiteral } from '../pipeline/fetch-guard'
import { matchSerpApiLocation } from '../locations'
import { getLatestSnapshot } from '../storage/content-records'
import {
  addPageMarket,
  insertPage,
  listPagesOfKind,
  listPinnedPages,
  replacePageMarkets,
  setPagePinned,
  setPageStatus,
  updateStoredPage
} from '../storage/pages'
import { insertMarket, listMarkets, readProjectProfile } from '../storage/project-profile'
import type { SqliteDatabase } from '../storage/database'
import type { MarketDraft } from '@shared/ipc'
import type { EngineHost } from './host'
import { pageMarkets, requirePage } from './page-access'
import { withProject } from './project-db'

const WORKING = new Set(['setting_up', 'tracked', 'paused'])

export function listPagesChannel(host: EngineHost, projectId: string): Promise<PageList> {
  return withProject(host, projectId, 'pages:list', (opened) => {
    // Topics have their own list (`topics:list`); this one is pages with a URL.
    const pages = listPagesOfKind(opened.db, projectId, 'page')
    return {
      foundPageCount: pages.length,
      pages: pages.filter((page) => WORKING.has(page.status))
    }
  })
}

export function getPageChannel(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PageDetail> {
  return withProject(host, projectId, 'pages:get', (opened) => {
    const page = requirePage(opened.db, pageId, projectId, 'pages:get')
    return {
      ...page,
      markets: pageMarkets(opened.db, page.id),
      snapshotId: getLatestSnapshot(opened.db, page.id)?.id ?? null
    }
  })
}

export function addPageChannel(host: EngineHost, request: AddPageRequest): Promise<PageDetail> {
  const channel = 'pages:add'
  rejectBlockedLiteral(request.url)
  return withProject(host, request.projectId, channel, (opened) => {
    const markets = resolveMarkets(host, opened.db, request.markets, channel)
    const first = markets[0]
    if (first === undefined)
      throw new IpcRequestError(channel, 'Add a market or set the project default')
    const page: PageSummary = {
      id: `page-${host.createId()}`,
      projectId: request.projectId,
      url: request.url,
      title: null,
      label: null,
      folder: folderFromUrl(request.url),
      status: 'setting_up',
      setupStep: 'read',
      intervalDays: request.intervalDays,
      samples: request.samples,
      promptCount: request.promptCount,
      defaultMarketId: first.id,
      pinned: false,
      score: null,
      promptSetVersion: null
    }
    insertPage(opened.db, page)
    const addedAt = host.now().toISOString()
    for (const market of markets) {
      addPageMarket(opened.db, {
        pageId: page.id,
        marketId: market.id,
        addedAt,
        baselineRunId: null
      })
    }
    return {
      ...requirePage(opened.db, page.id, request.projectId, channel),
      markets,
      snapshotId: null
    }
  })
}

export function updatePageChannel(
  host: EngineHost,
  request: UpdatePageRequest
): Promise<PageDetail> {
  const channel = 'pages:update'
  if (request.url !== undefined) rejectBlockedLiteral(request.url)
  return withProject(host, request.projectId, channel, (opened) => {
    const existing = requirePage(opened.db, request.pageId, request.projectId, channel)
    let defaultMarketId = request.defaultMarketId
    if (request.markets !== undefined) {
      const markets = resolveMarkets(host, opened.db, request.markets, channel)
      const ids = markets.map((market) => market.id)
      replacePageMarkets(opened.db, existing.id, ids, host.now().toISOString())
      const first = ids[0]
      if (defaultMarketId === undefined) defaultMarketId = first
      if (defaultMarketId === undefined || !ids.includes(defaultMarketId)) {
        throw new IpcRequestError(channel, 'That market is not on this page')
      }
    } else if (defaultMarketId !== undefined) {
      const linked = pageMarkets(opened.db, existing.id).some(
        (market) => market.id === defaultMarketId
      )
      if (!linked) throw new IpcRequestError(channel, 'That market is not on this page')
    }
    updateStoredPage(opened.db, existing.id, request.projectId, {
      ...(request.url !== undefined
        ? { url: request.url, folder: folderFromUrl(request.url) }
        : {}),
      ...(request.label !== undefined ? { label: request.label } : {}),
      ...(request.intervalDays !== undefined ? { intervalDays: request.intervalDays } : {}),
      ...(request.samples !== undefined ? { samples: request.samples } : {}),
      ...(request.promptCount !== undefined ? { promptCount: request.promptCount } : {}),
      ...(defaultMarketId !== undefined ? { defaultMarketId } : {}),
      ...(request.status !== undefined ? { status: request.status } : {})
    })
    const page = requirePage(opened.db, existing.id, request.projectId, channel)
    return {
      ...page,
      markets: pageMarkets(opened.db, page.id),
      snapshotId: getLatestSnapshot(opened.db, page.id)?.id ?? null
    }
  })
}

export function removePageChannel(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<RemovePageResult> {
  return withProject(host, projectId, 'pages:remove', (opened) => {
    requirePage(opened.db, pageId, projectId, 'pages:remove')
    const page = setPageStatus(opened.db, pageId, 'removed', projectId)
    return { id: page.id, status: 'removed' }
  })
}

export function searchPagesChannel(
  host: EngineHost,
  projectId: string,
  query: string
): Promise<SearchPagesResult> {
  return withProject(host, projectId, 'pages:search', (opened) => {
    const pages = listPagesOfKind(opened.db, projectId, 'page')
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return { foundPageCount: pages.length, pages: [] }
    return {
      foundPageCount: pages.length,
      pages: pages.filter((page) => matches(page, needle))
    }
  })
}

export function pinPageChannel(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PinnedPage> {
  const channel = 'pages:pin'
  return withProject(host, projectId, channel, (opened) => {
    const page = requirePage(opened.db, pageId, projectId, channel)
    if (page.status === 'removed') {
      throw new IpcRequestError(channel, 'A removed page cannot be pinned')
    }
    const pinned = setPagePinned(opened.db, pageId, true, projectId, host.now().toISOString())
    return pinnedRow(pinned, pageMarkets(opened.db, pageId))
  })
}

export function unpinPageChannel(
  host: EngineHost,
  projectId: string,
  pageId: string
): Promise<PageSummary> {
  return withProject(host, projectId, 'pages:unpin', (opened) => {
    requirePage(opened.db, pageId, projectId, 'pages:unpin')
    return setPagePinned(opened.db, pageId, false, projectId)
  })
}

export function pinnedPagesChannel(host: EngineHost, projectId: string): Promise<PinnedPageList> {
  return withProject(host, projectId, 'pages:pinned', (opened) => ({
    pages: listPinnedPages(opened.db, projectId).map((page) =>
      pinnedRow(page, pageMarkets(opened.db, page.id))
    )
  }))
}

function pinnedRow(page: PageSummary, markets: readonly Market[]): PinnedPage {
  return {
    id: page.id,
    projectId: page.projectId,
    label: page.label,
    title: page.title,
    // Pinned lists hold pages only; a topic is never pinned.
    url: page.url ?? '',
    score: page.score,
    intervalDays: page.intervalDays,
    samples: page.samples,
    promptSetVersion: page.promptSetVersion,
    promptCount: page.promptCount,
    markets,
    setupStep: page.setupStep
  }
}

function matches(page: PageSummary, needle: string): boolean {
  const haystack = [page.title, page.label, page.url]
    .filter((part): part is string => part !== null)
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}

function folderFromUrl(url: string): string | null {
  const parts = new URL(url).pathname.split('/').filter((part) => part.length > 0)
  if (parts.length < 2) return null
  return parts[0] ?? null
}

export function resolveMarkets(
  host: EngineHost,
  db: SqliteDatabase,
  drafts: readonly MarketDraft[],
  channel: string
): Market[] {
  if (drafts.length === 0) {
    const fallback = readProjectProfile(db)?.market ?? null
    if (fallback === null)
      throw new IpcRequestError(channel, 'Add a market or set the project default')
    return [fallback]
  }
  const existing = listMarkets(db)
  const resolved: Market[] = []
  for (const draft of drafts) {
    const match = existing.find(
      (market) =>
        market.country === draft.country &&
        market.language === draft.language &&
        market.location === draft.location &&
        market.device === draft.device &&
        market.localWording === draft.localWording
    )
    if (match !== undefined) {
      resolved.push(match)
      continue
    }
    const created: Market = {
      id: host.createId(),
      country: draft.country,
      language: draft.language,
      location: draft.location,
      device: draft.device,
      localWording: draft.localWording,
      serpapiLocation: matchSerpApiLocation(draft.location, draft.country, host.locations)
    }
    insertMarket(db, created)
    existing.push(created)
    resolved.push(created)
  }
  return resolved
}
