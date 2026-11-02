import { useId, type JSX } from 'react'
import { inferProduct } from '@shared/domain'
import type { InferredProduct, ProjectProduct, TopicDraft } from '@shared/domain'
import type { TopicDraftPatch } from '@shared/ipc'
import type { ProductsApi } from './client'
import { AUTO, choiceOf, choiceValue, productOptions } from './options'
import { useProductCatalog } from './useProductCatalog'
import './products.css'

type ProductDraft = Pick<TopicDraft, 'seed' | 'name' | 'productId'>

interface TopicProductProps {
  projectId: string
  draft: ProductDraft
  api?: ProductsApi | null
}

/** The project's products and what "Automatic" picks for this draft's seed. */
function useTopicProduct(
  projectId: string,
  draft: ProductDraft,
  api: ProductsApi | null | undefined
): { products: readonly ProjectProduct[]; suggested: InferredProduct } {
  const { catalog } = useProductCatalog(projectId, api)
  const products = catalog?.products ?? []
  return { products, suggested: inferProduct(products, { title: draft.name, text: draft.seed }) }
}

/**
 * The topic wizard's product (Docs/PROMPT-AUDIT.md PC), one plain fact in the Seed
 * step's "Brand and markets" row: which product the topic is about, so its compare and
 * decide questions name that product's competitors. Changed in the row's Edit panel
 * ({@link TopicProductPicker}). Hidden when the project has no products (or the bridge
 * has no products channels, as in the wizard's mock mode).
 */
export function TopicProductFact({ projectId, draft, api }: TopicProductProps): JSX.Element | null {
  const { products, suggested } = useTopicProduct(projectId, draft, api)
  if (products.length === 0) return null
  const automatic = draft.productId === undefined
  const productId = automatic ? suggested.productId : draft.productId
  const name = products.find((item) => item.id === productId)?.name ?? 'Whole business'
  return (
    <div className="prod-fact">
      <dt>Product</dt>
      <dd title={automatic ? `Automatic: ${suggested.reason}` : undefined}>
        {name}
        {automatic ? <span className="prod-fact-auto"> · auto</span> : null}
      </dd>
    </div>
  )
}

/** The Edit panel's product choice: "Automatic" follows the seed, or pin one. */
export function TopicProductPicker({
  projectId,
  draft,
  patch,
  api
}: TopicProductProps & { patch: (patch: TopicDraftPatch) => void }): JSX.Element | null {
  const id = useId()
  const { products, suggested } = useTopicProduct(projectId, draft, api)
  if (products.length === 0) return null
  const value = draft.productId === undefined ? AUTO : choiceValue(draft.productId)
  return (
    <div>
      <label className="tw-label" htmlFor={id}>
        Product
      </label>
      <select
        id={id}
        className="select prod-picker"
        aria-label="Product this topic is about"
        value={value}
        onChange={(event) => {
          const choice = choiceOf(event.target.value)
          patch({
            product:
              choice.mode === 'auto'
                ? { mode: 'auto' }
                : { mode: 'pick', productId: choice.productId }
          })
        }}
      >
        {productOptions(products, suggested.productId).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="tw-help">Its competitors go into the compare questions.</p>
    </div>
  )
}
