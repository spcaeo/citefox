import type { JSX } from 'react'
import type { Market, PageSummary } from '@shared/domain'
import { marketName, scopeName } from '../utils/model'

/**
 * The project screen's filters, in the open grid's toolbar: a market (or all
 * markets) and one tracked page or topic (or every one). Compact selects whose
 * first option names the "all" state, like the YouTube screen's. A select with
 * one real choice is left out: "all" and that one choice are the same list.
 */
export function ProjectFilters({
  markets,
  pages,
  marketId,
  pageId,
  onMarket,
  onPage,
  loading
}: {
  markets: readonly Market[]
  pages: readonly PageSummary[]
  marketId: string | null
  pageId: string | null
  onMarket: (marketId: string | null) => void
  onPage: (pageId: string | null) => void
  loading: boolean
}): JSX.Element {
  return (
    <span className="cm-filter-set">
      {markets.length > 1 ? (
        <select
          aria-label="Market"
          className="ui-input ui-input-sm cm-select"
          value={marketId ?? ''}
          onChange={(event) => onMarket(event.target.value || null)}
        >
          <option value="">All markets</option>
          {markets.map((market) => (
            <option key={market.id} value={market.id}>
              {marketName(markets, market.id)}
            </option>
          ))}
        </select>
      ) : null}
      {pages.length > 1 ? (
        <select
          aria-label="Page"
          className="ui-input ui-input-sm cm-select"
          value={pageId ?? ''}
          onChange={(event) => onPage(event.target.value || null)}
        >
          <option value="">All tracked pages</option>
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {scopeName(page)}
            </option>
          ))}
        </select>
      ) : null}
      {loading ? (
        <span role="status" className="cm-note">
          Loading communities…
        </span>
      ) : null}
    </span>
  )
}
