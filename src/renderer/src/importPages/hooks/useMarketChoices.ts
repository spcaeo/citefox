import { useMemo, useState } from 'react'
import { DEFAULT_MARKET_DEVICE, type Market } from '@shared/domain'
import type { MarketDraft } from '@shared/ipc'
import type { MarketChoice } from '../types'

let counter = 0

function choiceFrom(market: Market, on: boolean): MarketChoice {
  return {
    key: `market-${market.id}`,
    id: market.id,
    country: market.country,
    language: market.language,
    location: market.location,
    device: market.device,
    localWording: market.localWording,
    on
  }
}

export function sameMarket(a: MarketDraft, b: MarketDraft): boolean {
  return (
    a.country === b.country &&
    a.language === b.language &&
    (a.location ?? '') === (b.location ?? '') &&
    a.device === b.device
  )
}

export function toDraft(choice: MarketChoice): MarketDraft {
  return {
    country: choice.country,
    language: choice.language,
    location: choice.location,
    device: choice.device,
    localWording: choice.localWording
  }
}

/**
 * Step 3 markets: every project market from `import:candidates` (the
 * default, listed first, starts ticked), plus markets typed on this screen
 * (added ticked).
 */
export function useMarketChoices(projectMarkets: readonly Market[]): {
  choices: readonly MarketChoice[]
  toggle: (key: string) => void
  add: (draft: Omit<MarketDraft, 'device'>) => boolean
} {
  const [ticks, setTicks] = useState<Readonly<Record<string, boolean>>>({})
  const [added, setAdded] = useState<readonly MarketChoice[]>([])
  const choices = useMemo(() => {
    const fromProject = projectMarkets.map((market, index) => {
      const key = `market-${market.id}`
      return choiceFrom(market, ticks[key] ?? index === 0)
    })
    return [
      ...fromProject,
      ...added.map((choice) => ({ ...choice, on: ticks[choice.key] ?? true }))
    ]
  }, [projectMarkets, added, ticks])

  function toggle(key: string): void {
    const current = choices.find((choice) => choice.key === key)
    if (!current) return
    setTicks((previous) => ({ ...previous, [key]: !current.on }))
  }

  function add(draft: Omit<MarketDraft, 'device'>): boolean {
    const full: MarketDraft = { ...draft, device: DEFAULT_MARKET_DEVICE }
    if (choices.some((choice) => sameMarket(toDraft(choice), full))) return false
    counter += 1
    const key = `added-${counter}`
    setAdded((current) => [...current, { ...full, key, id: null, on: true }])
    return true
  }

  return { choices, toggle, add }
}
