/**
 * Project settings › Markets (deep audit S5.2): the project's markets with the
 * pages that use them; add one market to many pages, remove one from every page
 * (Undo puts the links back with their baselines), and make one the default.
 */

import type { Market, PageSummary } from '@shared/domain'
import type {
  AddProjectMarketRequest,
  AddProjectMarketResult,
  ProjectMarketLink,
  ProjectMarketPage,
  ProjectMarketsView,
  RemoveProjectMarketRequest,
  RemoveProjectMarketResult,
  RestoreProjectMarketRequest,
  SetDefaultProjectMarketRequest,
  SetDefaultProjectMarketResult
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import type { SqliteDatabase } from '../../storage/database'
import {
  addPageMarket,
  deletePageMarket,
  getPageMarketLastCheckedAt,
  listPageMarkets,
  listPagesOfKind,
  setPageMarketLastCheckedAt,
  updateStoredPage
} from '../../storage/pages'
import {
  getMarket,
  listMarkets,
  readProjectProfile,
  setDefaultMarketRow
} from '../../storage/project-profile'
import { searchesLeftFor } from '../../topics/drafts'
import { enabledPromptCounts } from '../allpages/rows'
import type { EngineHost } from '../host'
import { resolveMarkets } from '../pages'
import { withProject, type OpenProject } from '../project-db'

/** Pages and topics that are not removed, pages first. */
function livePages(db: SqliteDatabase, projectId: string): PageSummary[] {
  return [
    ...listPagesOfKind(db, projectId, 'page'),
    ...listPagesOfKind(db, projectId, 'topic')
  ].filter((page) => page.status !== 'removed')
}

function marketIdsOf(db: SqliteDatabase, pageId: string): string[] {
  return listPageMarkets(db, pageId).map((link) => link.marketId)
}

function buildView(host: EngineHost, opened: OpenProject): ProjectMarketsView {
  const { db, project } = opened
  const counts = enabledPromptCounts(db)
  const defaultMarketId = readProjectProfile(db)?.market.id ?? null
  const pages: ProjectMarketPage[] = livePages(db, project.id).map((page) => {
    const topic = page.kind === 'topic'
    return {
      id: page.id,
      kind: topic ? 'topic' : 'page',
      name: (topic ? page.title : (page.label ?? page.title)) ?? page.url ?? page.id,
      url: page.url,
      status: page.status,
      questions: counts.get(page.id) ?? 0,
      samples: page.samples,
      marketIds: marketIdsOf(db, page.id),
      defaultMarketId: page.defaultMarketId
    }
  })
  const used = new Set(pages.flatMap((page) => page.marketIds))
  if (defaultMarketId !== null) used.add(defaultMarketId)
  const markets: Market[] = listMarkets(db).filter((market) => used.has(market.id))
  return {
    projectId: project.id,
    defaultMarketId,
    markets,
    pages,
    searchesLeft: searchesLeftFor(host.storage, db, project.id, host.now())
  }
}

export function projectMarkets(host: EngineHost, projectId: string): Promise<ProjectMarketsView> {
  return withProject(host, projectId, 'projectSettings:markets', (opened) =>
    buildView(host, opened)
  )
}

function requireLive(pages: readonly PageSummary[], pageId: string, channel: string): PageSummary {
  const page = pages.find((item) => item.id === pageId)
  if (page === undefined) throw new IpcRequestError(channel, 'That page was not found')
  return page
}

export function addProjectMarket(
  host: EngineHost,
  request: AddProjectMarketRequest
): Promise<AddProjectMarketResult> {
  const channel = 'projectSettings:addMarket'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db, project } = opened
    const pages = livePages(db, project.id)
    for (const pageId of request.pageIds) requireLive(pages, pageId, channel)
    const added: string[] = []
    const alreadyHad: string[] = []
    let marketId = ''
    db.transaction(() => {
      const [market] = resolveMarkets(host, db, [request.market], channel)
      if (market === undefined) throw new IpcRequestError(channel, 'Pick a market')
      marketId = market.id
      const addedAt = host.now().toISOString()
      for (const pageId of request.pageIds) {
        if (marketIdsOf(db, pageId).includes(market.id)) {
          alreadyHad.push(pageId)
          continue
        }
        addPageMarket(db, { pageId, marketId: market.id, addedAt, baselineRunId: null })
        added.push(pageId)
      }
    })()
    return { marketId, added, alreadyHad, view: buildView(host, opened) }
  })
}

export function removeProjectMarket(
  host: EngineHost,
  request: RemoveProjectMarketRequest
): Promise<RemoveProjectMarketResult> {
  const channel = 'projectSettings:removeMarket'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db, project } = opened
    if (getMarket(db, request.marketId) === null) {
      throw new IpcRequestError(channel, 'That market was not found')
    }
    if (readProjectProfile(db)?.market.id === request.marketId) {
      throw new IpcRequestError(
        channel,
        'This is the default market for new pages. Make another market the default first.'
      )
    }
    const removed: ProjectMarketLink[] = []
    const skipped: string[] = []
    db.transaction(() => {
      for (const page of livePages(db, project.id)) {
        const links = listPageMarkets(db, page.id)
        const link = links.find((item) => item.marketId === request.marketId)
        if (link === undefined) continue
        const rest = links.filter((item) => item.marketId !== request.marketId)
        const next = rest[0]
        if (next === undefined) {
          skipped.push(page.id)
          continue
        }
        const wasDefault = page.defaultMarketId === request.marketId
        removed.push({
          pageId: page.id,
          addedAt: link.addedAt,
          baselineRunId: link.baselineRunId,
          lastCheckedAt: getPageMarketLastCheckedAt(db, page.id, request.marketId),
          wasDefault
        })
        deletePageMarket(db, page.id, request.marketId)
        if (wasDefault) {
          updateStoredPage(db, page.id, project.id, { defaultMarketId: next.marketId })
        }
      }
    })()
    return { marketId: request.marketId, removed, skipped, view: buildView(host, opened) }
  })
}

export function restoreProjectMarket(
  host: EngineHost,
  request: RestoreProjectMarketRequest
): Promise<ProjectMarketsView> {
  const channel = 'projectSettings:restoreMarket'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db, project } = opened
    if (getMarket(db, request.marketId) === null) {
      throw new IpcRequestError(channel, 'That market was not found')
    }
    const pages = livePages(db, project.id)
    db.transaction(() => {
      for (const link of request.links) {
        // A page removed since keeps no market to restore.
        if (!pages.some((page) => page.id === link.pageId)) continue
        if (!marketIdsOf(db, link.pageId).includes(request.marketId)) {
          addPageMarket(db, {
            pageId: link.pageId,
            marketId: request.marketId,
            addedAt: link.addedAt,
            baselineRunId: link.baselineRunId
          })
          if (link.lastCheckedAt !== null) {
            setPageMarketLastCheckedAt(db, link.pageId, request.marketId, link.lastCheckedAt)
          }
        }
        if (link.wasDefault) {
          updateStoredPage(db, link.pageId, project.id, { defaultMarketId: request.marketId })
        }
      }
    })()
    return buildView(host, opened)
  })
}

export function setDefaultProjectMarket(
  host: EngineHost,
  request: SetDefaultProjectMarketRequest
): Promise<SetDefaultProjectMarketResult> {
  const channel = 'projectSettings:setDefaultMarket'
  return withProject(host, request.projectId, channel, (opened) => {
    const { db, project } = opened
    if (getMarket(db, request.marketId) === null) {
      throw new IpcRequestError(channel, 'That market was not found')
    }
    const previousDefaultMarketId = readProjectProfile(db)?.market.id ?? null
    const changedPages: { pageId: string; previousMarketId: string | null }[] = []
    db.transaction(() => {
      setDefaultMarketRow(db, request.marketId)
      if (request.pages !== 'tracking') return
      for (const page of livePages(db, project.id)) {
        if (page.defaultMarketId === request.marketId) continue
        if (!marketIdsOf(db, page.id).includes(request.marketId)) continue
        changedPages.push({ pageId: page.id, previousMarketId: page.defaultMarketId })
        updateStoredPage(db, page.id, project.id, { defaultMarketId: request.marketId })
      }
    })()
    return { previousDefaultMarketId, changedPages, view: buildView(host, opened) }
  })
}
