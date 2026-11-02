import type { Market, PageResults } from '@shared/domain'
import {
  ownLinksDrill,
  resultsDrill,
  resultsScope,
  type DrillRequest,
  type DrillScope,
  type ItemDrill,
  type PromptDrill
} from '../../drill'

/**
 * Drills for the Markets tab. Each market's numbers come from its own
 * `results:get`, so its drawers list that market's rows and open Prompt
 * detail in that market and check. Ids carry the market so two cards never
 * share an NFR-14 id: `market:<marketId>:<results drill id>`.
 */

/** The drawer scope for one market: its rows open Prompt detail in that market and check. */
export function marketScope(pageId: string, market: Market, results: PageResults): DrillScope {
  return resultsScope(results, { pageId, market, runId: results.run?.runId ?? null })
}

/** The NFR-14 id of a results drill in one market. */
export function marketDrillId(marketId: string, id: string): string {
  return `market:${marketId}:${id}`
}

function inMarket<T extends DrillRequest>(marketId: string, drill: T): T {
  return { ...drill, id: marketDrillId(marketId, drill.id) }
}

/** A Results drill (`funnel:this_page`, `domain:reddit.com`, …) for one market. */
export function marketResultsDrill(
  pageId: string,
  market: Market,
  results: PageResults,
  id: string
): PromptDrill | null {
  const drill = resultsDrill(results, id, marketScope(pageId, market, results))
  return drill ? inMarket(market.id, drill) : null
}

/**
 * Own-domain citations in one market: one row per distinct own URL in each
 * prompt's winning overview, counted the way the engine counts
 * `citationsThisPage + citationsOtherOwn` (a URL listed twice in one
 * overview is one citation). Each row opens its prompt in this market.
 */
export function marketCitationsDrill(
  pageId: string,
  market: Market,
  results: PageResults
): ItemDrill {
  const keep = new Set<string>()
  for (const prompt of results.prompts) {
    const seen = new Set<string>()
    for (const ref of prompt.references) {
      if (seen.has(ref.normalizedUrl)) continue
      seen.add(ref.normalizedUrl)
      if (ref.classification === 'target' || ref.classification === 'own') {
        keep.add(`${prompt.promptId}:${ref.id}`)
      }
    }
  }
  const drill = ownLinksDrill(results, marketScope(pageId, market, results))
  return inMarket(market.id, {
    ...drill,
    items: drill.items.filter((item) => keep.has(item.id))
  })
}
