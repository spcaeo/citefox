import type { Market } from '@shared/domain'
import { competitorContext, type CompetitorContext } from '../../engine/competitor-context'
import { competitorBlock, languageName, marketBlock, productBlock } from '../../prompts/blocks'
import { getMarket } from '../../storage/project-profile'
import type { AssistContext } from '../types'
import { marketIdOf, type OpenedPage } from './gather'

/**
 * The prompt-audit context blocks (Docs/PROMPT-AUDIT.md section 3, rule 2) for the page
 * and prompt assists: the page's product and its competitors (always through
 * `competitorContext`, never the flat project list), and the market.
 */

/** The page's market: the request's, else the page's default. Null when it has none. */
export function pageMarket(context: AssistContext, opened: OpenedPage): Market | null {
  if (context.request.marketId === null && opened.page.defaultMarketId === null) return null
  return getMarket(opened.db, marketIdOf(context, opened.page))
}

/** `{{ market_block }}` for the page, or a plain line when the page has no market. */
export function pageMarketBlock(context: AssistContext, opened: OpenedPage): string {
  const market = pageMarket(context, opened)
  return market === null
    ? 'Market: not set. Write in the language of the page.'
    : marketBlock({ country: market.country, language: market.language, location: market.location })
}

/** "English", from the page's market; null when the page has no market. */
export function pageLanguage(context: AssistContext, opened: OpenedPage): string | null {
  const market = pageMarket(context, opened)
  return market === null ? null : languageName(market.language)
}

/** The competitors of the page's product (project-wide when the page has no product). */
export function pageCompetitors(opened: OpenedPage): CompetitorContext {
  return competitorContext(opened.db, { pageId: opened.page.id })
}

/** `{{ product_block }}` and `{{ competitor_block }}` for the page, one after the other. */
export function pageProductLines(opened: OpenedPage): string {
  const competitors = pageCompetitors(opened)
  return [productBlock(competitors.product), competitorBlock(competitors)].join('\n')
}
