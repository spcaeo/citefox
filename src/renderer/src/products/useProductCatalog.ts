import { useCallback, useEffect, useState } from 'react'
import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import type { ProductCatalogView } from '@shared/ipc'
import { errorText } from '../components/errorText'
import { productsApi, type ProductsApi } from './client'

export interface ProductCatalogState {
  /** Null while loading, or when the bridge has no products channels. */
  catalog: ProductCatalogView | null
  error: string | null
  saving: boolean
  /** Replaces the catalog; resolves to the saved view, or null when the save failed. */
  save: (next: {
    products: readonly ProjectProduct[]
    competitors: readonly ProductCompetitor[]
  }) => Promise<ProductCatalogView | null>
  reload: () => Promise<void>
}

/** The project's products and competitors by product (`products:get` / `products:save`). */
export function useProductCatalog(
  projectId: string,
  api: ProductsApi | null = productsApi()
): ProductCatalogState {
  const [catalog, setCatalog] = useState<ProductCatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    if (api === null) return
    try {
      setCatalog(await api['products:get']({ projectId }))
      setError(null)
    } catch (cause) {
      setError(errorText(cause, 'Could not read the products.'))
    }
  }, [api, projectId])

  useEffect(() => {
    if (api === null) return
    let live = true
    api['products:get']({ projectId }).then(
      (next) => {
        if (!live) return
        setCatalog(next)
        setError(null)
      },
      (cause: unknown) => {
        if (live) setError(errorText(cause, 'Could not read the products.'))
      }
    )
    return () => {
      live = false
    }
  }, [api, projectId])

  const save = useCallback<ProductCatalogState['save']>(
    async (next) => {
      if (api === null) return null
      setSaving(true)
      try {
        const saved = await api['products:save']({ projectId, ...next })
        setCatalog(saved)
        setError(null)
        return saved
      } catch (cause) {
        setError(errorText(cause, 'Could not save the products.'))
        return null
      } finally {
        setSaving(false)
      }
    },
    [api, projectId]
  )

  return { catalog, error, saving, save, reload }
}
