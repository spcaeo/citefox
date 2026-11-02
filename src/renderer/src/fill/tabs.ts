import type { ProductSuggestion } from '@shared/ipc'

/** The Fill card's tabs, in the URL as `?fill=<id>`. */
export const FILL_TABS = ['competitors', 'buyers', 'switching', 'integrations', 'brand'] as const

export type FillTab = (typeof FILL_TABS)[number]

export function fillTabFrom(value: string | null): FillTab {
  return (FILL_TABS as readonly string[]).includes(value ?? '') ? (value as FillTab) : 'competitors'
}

/** One buyer type: who buys, the job they hire it for, and the page that says so. */
export interface BuyerType {
  id: string
  who: string
  need: string
  product: string
  evidencePath: string | null
}

/**
 * "Buyers" are buyer types (who buys: roles, company sizes, industries), read per
 * product from the site. Two products sold to the same people show once.
 */
export function buyerTypes(products: readonly ProductSuggestion[]): BuyerType[] {
  const seen = new Set<string>()
  const out: BuyerType[] = []
  for (const product of products) {
    const who = product.buyer.trim().replace(/\.$/u, '')
    const key = who.toLowerCase()
    if (who.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push({
      id: product.id,
      who,
      need: product.job,
      product: product.name,
      evidencePath: product.evidence?.path ?? null
    })
  }
  return out
}
