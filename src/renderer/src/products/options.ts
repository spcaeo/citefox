import type { ProjectProduct } from '@shared/domain'

/** Select values shared by the page and topic product pickers. */
export const AUTO = 'auto'
export const WHOLE_BUSINESS = 'whole'

export interface ProductOption {
  value: string
  label: string
}

/** "Automatic (<what it picks>)", each product, then "Whole business". */
export function productOptions(
  products: readonly ProjectProduct[],
  suggestedId: string | null
): ProductOption[] {
  const suggested = products.find((item) => item.id === suggestedId)?.name ?? 'Whole business'
  return [
    { value: AUTO, label: `Automatic (${suggested})` },
    ...products.map((item) => ({ value: item.id, label: item.name })),
    { value: WHOLE_BUSINESS, label: 'Whole business' }
  ]
}

/** A new product's id: safe for storage (`[A-Za-z0-9._:-]`), unique enough per project. */
export function newProductId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/gu, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `prod-${random}`
}

/** The select value for a pinned product (null: the whole business). */
export function choiceValue(productId: string | null): string {
  return productId ?? WHOLE_BUSINESS
}

/** A select value as the `products:setPage` mode and product. */
export function choiceOf(value: string): { mode: 'auto' | 'pick'; productId: string | null } {
  if (value === AUTO) return { mode: 'auto', productId: null }
  return { mode: 'pick', productId: value === WHOLE_BUSINESS ? null : value }
}
