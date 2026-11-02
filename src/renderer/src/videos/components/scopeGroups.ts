import type { Market, PageSummary } from '@shared/domain'
import type { FilterGroup } from '../../ui'
import { marketName, pageName } from '../utils/model'

/** The "no filter" value of both groups (a Dropdown value can't be null). */
const ALL = 'all'

/**
 * The market and page scope of the whole screen, as the grid's two
 * `filterControls` (Market and Scope). They show as dropdowns while the
 * toolbar has room and move into Filter ▾ when it has none (audit2 #7).
 */
export function scopeGroups({
  markets,
  pages,
  marketId,
  pageId,
  onMarket,
  onScope
}: {
  markets: readonly Market[]
  pages: readonly PageSummary[]
  marketId: string | null
  pageId: string | null
  onMarket: (marketId: string | null) => void
  onScope: (pageId: string | null) => void
}): readonly FilterGroup[] {
  return [
    {
      id: 'market',
      label: 'Market',
      value: marketId ?? ALL,
      resetValue: ALL,
      choices: [
        { value: ALL, label: 'All markets' },
        ...markets.map((market) => ({ value: market.id, label: marketName(markets, market.id) }))
      ],
      onChange: (value) => onMarket(value === ALL ? null : value)
    },
    {
      id: 'scope',
      label: 'Scope',
      value: pageId ?? ALL,
      resetValue: ALL,
      choices: [
        { value: ALL, label: 'All tracked pages' },
        ...pages.map((page) => ({ value: page.id, label: `This page · ${pageName(page)}` }))
      ],
      onChange: (value) => onScope(value === ALL ? null : value)
    }
  ]
}
