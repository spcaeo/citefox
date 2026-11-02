import type { SiloSummary } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import type { MenuItem } from '../../ui'
import type { MarketChoice } from '../types'
import { marketsLabel, parseSiloMarketValue, siloMarketValue } from './model'

/** What new pages in a folder get: inherited (with what that is) or the folder's own markets. */
export function siloMarketsText(silo: SiloSummary, markets: readonly MarketChoice[]): string {
  if (silo.marketIds !== null) return marketsLabel(silo.marketIds, markets)
  const inherited = marketsLabel(silo.effectiveMarketIds, markets)
  return silo.parentPath === null
    ? `Project default (${inherited})`
    : `Same as parent folder (${inherited})`
}

/** The market choices for a folder's new pages, the current one ticked. */
export function siloMarketItems(
  silo: SiloSummary,
  markets: readonly MarketChoice[],
  disabled: boolean,
  onPick: (marketIds: string[] | null) => void
): MenuItem[] {
  const options: { value: string; label: string }[] = [
    {
      value: 'inherit',
      label:
        silo.parentPath === null
          ? 'New pages use the project default'
          : 'New pages use the parent folder’s markets'
    }
  ]
  for (const market of markets) {
    options.push({ value: market.id, label: `New pages use ${market.label}` })
  }
  if (markets.length > 1) {
    options.push({
      value: markets.map((market) => market.id).join(','),
      label: `New pages use all ${pluralize(markets.length, 'market')}`
    })
  }
  const current = siloMarketValue(silo.marketIds)
  if (!options.some((option) => option.value === current) && silo.marketIds !== null) {
    options.push({
      value: current,
      label: `New pages use ${marketsLabel(silo.marketIds, markets)}`
    })
  }
  return options.map((option, index) => ({
    id: `markets:${option.value}`,
    label: option.label,
    ...(option.value === current ? { icon: 'check' as const } : {}),
    disabled: disabled || option.value === current,
    groupStart: index === 0,
    onSelect: () => onPick(parseSiloMarketValue(option.value))
  }))
}
