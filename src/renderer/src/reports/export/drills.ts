import type { ExportPreviewPage } from '@shared/domain'
import type { DrillItem, ItemDrill } from '../../drill'
import { formatMoment } from '../../utils/dates'
import { NO_SCOPE } from '../schedules/utils/drills'

function pageName(page: ExportPreviewPage): string {
  return page.title?.trim() || page.url
}

/** The pages an export holds (Export summary "N pages"). */
export function exportPagesDrill(pages: readonly ExportPreviewPage[]): ItemDrill {
  return {
    kind: 'items',
    id: 'export:pages',
    title: 'Pages in this export',
    description: 'Every page the file covers. Select one to open its results.',
    noun: ['page', 'pages'],
    primaryLabel: 'Page',
    columns: [
      { id: 'markets', label: 'Markets', width: 'minmax(96px, 0.7fr)' },
      { id: 'checks', label: 'Checks', align: 'end', width: '72px' }
    ],
    items: pages.map((page) => ({
      id: page.pageId,
      primary: pageName(page),
      secondary: page.title ? page.url : null,
      target: { kind: 'page', pageId: page.pageId, tab: 'results' },
      cells: {
        markets: page.markets.map((market) => market.code).join(', '),
        checks: page.markets.reduce((sum, market) => sum + market.checks.length, 0)
      }
    })),
    scope: NO_SCOPE
  }
}

/** The distinct markets an export holds (Export summary "N markets"). */
export function exportMarketsDrill(pages: readonly ExportPreviewPage[]): ItemDrill {
  const byId = new Map<string, { code: string; pages: number; checks: number }>()
  for (const page of pages) {
    for (const market of page.markets) {
      const found = byId.get(market.marketId) ?? { code: market.code, pages: 0, checks: 0 }
      found.pages += 1
      found.checks += market.checks.length
      byId.set(market.marketId, found)
    }
  }
  return {
    kind: 'items',
    id: 'export:markets',
    title: 'Markets in this export',
    description: 'Each market the file covers, with how many pages and checks it holds.',
    noun: ['market', 'markets'],
    primaryLabel: 'Market',
    columns: [
      { id: 'pages', label: 'Pages', align: 'end', width: '72px' },
      { id: 'checks', label: 'Checks', align: 'end', width: '72px' }
    ],
    items: [...byId].map(([id, market]) => ({
      id,
      primary: market.code,
      mono: true,
      cells: { pages: market.pages, checks: market.checks }
    })),
    scope: NO_SCOPE
  }
}

/** Every check in the export, one row per page, market and check (Export summary "N checks"). */
export function exportChecksDrill(pages: readonly ExportPreviewPage[]): ItemDrill {
  const items: DrillItem[] = []
  for (const page of pages) {
    for (const market of page.markets) {
      for (const at of market.checks) {
        items.push({
          id: `${page.pageId}:${market.marketId}:${at}`,
          primary: formatMoment(at),
          secondary: pageName(page),
          target: { kind: 'page', pageId: page.pageId, tab: 'history', marketId: market.marketId },
          cells: { market: market.code }
        })
      }
    }
  }
  return {
    kind: 'items',
    id: 'export:checks',
    title: 'Checks in this export',
    description:
      'Each finished check the file is built from. Select one to open that page’s history.',
    noun: ['check', 'checks'],
    primaryLabel: 'Finished',
    columns: [{ id: 'market', label: 'Market', width: '96px' }],
    items,
    scope: NO_SCOPE
  }
}
