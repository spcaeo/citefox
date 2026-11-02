import { useEffect, useState, type JSX } from 'react'
import type { PageProductView } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { productsApi, type ProductsApi } from './client'
import { AUTO, choiceOf, choiceValue, productOptions } from './options'
import './products.css'

/**
 * The page header's product picker (Docs/PROMPT-AUDIT.md PC): which product this page
 * (or topic) is about, so its prompts name that product's competitors. "Automatic"
 * follows the page's URL and title; the choice is saved at once. Hidden when the project
 * has no products.
 */
export function PageProductField({
  projectId,
  pageId,
  api = productsApi()
}: {
  projectId: string
  pageId: string
  api?: ProductsApi | null
}): JSX.Element | null {
  const [view, setView] = useState<PageProductView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (api === null) return
    let live = true
    api['products:page']({ projectId, pageId }).then(
      (next) => {
        if (live) setView(next)
      },
      () => {
        // A page the engine cannot map (an old file, a removed page) just shows no picker.
        if (live) setView(null)
      }
    )
    return () => {
      live = false
    }
  }, [api, projectId, pageId])

  if (api === null || view === null || view.products.length === 0) return null

  async function pick(value: string): Promise<void> {
    if (api === null) return
    setBusy(true)
    setError(null)
    try {
      setView(await api['products:setPage']({ projectId, pageId, ...choiceOf(value) }))
    } catch (cause) {
      setError(errorText(cause, 'Could not save the product.'))
    } finally {
      setBusy(false)
    }
  }

  const options = productOptions(view.products, view.suggestedId)
  return (
    <label className="market-field prod-field" title={view.pinned ? undefined : view.reason}>
      Product
      <select
        className="select"
        value={view.pinned ? choiceValue(view.productId) : AUTO}
        disabled={busy}
        aria-describedby={error ? `${pageId}-product-error` : undefined}
        onChange={(event) => void pick(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="field-error" id={`${pageId}-product-error`} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  )
}
