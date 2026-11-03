import type { CiteFoxApi } from '@shared/ipc'

/** The `products:*` channels (src/shared/ipc/products.ts, Docs/PROMPT-AUDIT.md PC). */
export type ProductsApi = Pick<
  CiteFoxApi,
  'products:get' | 'products:save' | 'products:saveFill' | 'products:page' | 'products:setPage'
> &
  /** CiteFox AI fills in a product added by name only. Optional: older bridges lack it. */
  Partial<Pick<CiteFoxApi, 'products:fillEstimate' | 'products:fillRow'>>

/**
 * The preload bridge when it has the products channels, else null. The pickers render
 * nothing without it (unit tests, browser previews), so screens work as before.
 */
export function productsApi(): ProductsApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as { citefox?: Partial<CiteFoxApi> }).citefox
  if (!api || typeof api['products:get'] !== 'function') return null
  return api as ProductsApi
}
