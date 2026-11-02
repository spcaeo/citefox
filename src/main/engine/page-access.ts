import type { Market, PageSummary } from '@shared/domain'
import { IpcRequestError } from '../ipc-request'
import { getPage, listPageMarkets } from '../storage/pages'
import { getMarket } from '../storage/project-profile'
import type { SqliteDatabase } from '../storage/database'

export function requirePage(
  db: SqliteDatabase,
  pageId: string,
  projectId: string,
  channel: string
): PageSummary {
  const page = getPage(db, pageId, projectId)
  if (page === null) throw new IpcRequestError(channel, 'That page was not found')
  return page
}

/** Markets linked to the page, in the order they were added. */
export function pageMarkets(db: SqliteDatabase, pageId: string): Market[] {
  const markets: Market[] = []
  for (const link of listPageMarkets(db, pageId)) {
    const market = getMarket(db, link.marketId)
    if (market !== null) markets.push(market)
  }
  return markets
}
