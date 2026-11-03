import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ProjectProduct } from '@shared/domain'
import { useFillQueue } from '../utils/useFillQueue'
import type { ProductsApi } from './client'
import type { ProductCatalogState } from './useProductCatalog'

/** A product the person added by name only: no job and no page yet. */
export function needsFill(product: ProjectProduct): boolean {
  return product.job.trim() === '' && (product.evidencePath ?? '').trim() === ''
}

export interface ProductFill {
  /** CiteFox AI is writing (or about to write) this product's job. */
  filling: (id: string) => boolean
  /** CiteFox AI wrote this product's job in this session (the ✦ mark). */
  written: (id: string) => boolean
  start: (id: string) => void
  /** "✦ Fill in" can be offered: the product needs it, none is running, AI is ready. */
  canRetry: (product: ProjectProduct) => boolean
}

/**
 * Settings › General: a product added by name gets its job (and the tracked page that
 * describes it) from CiteFox AI, in the background, up to two at a time. A blank answer, a
 * failure or a changed product (renamed, removed, job typed) changes nothing. The result
 * is saved with the usual catalog save, so it is kept like any other change.
 */
export function useProductFill(state: ProductCatalogState, api: ProductsApi | null): ProductFill {
  const fillRow = api?.['products:fillRow']
  const fillEstimate = api?.['products:fillEstimate']
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })
  const projectId = state.catalog?.projectId ?? null
  const [available, setAvailable] = useState(false)
  const [written, setWritten] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (projectId === null || fillEstimate === undefined) return
    let alive = true
    fillEstimate({ projectId }).then(
      (estimate) => {
        if (alive) setAvailable(estimate.available)
      },
      () => {
        if (alive) setAvailable(false)
      }
    )
    return () => {
      alive = false
    }
  }, [fillEstimate, projectId])

  const queue = useFillQueue(
    useCallback(
      (id: string) => {
        const catalog = latest.current.catalog
        const product = catalog?.products.find((item) => item.id === id)
        if (fillRow === undefined || catalog === null || product === undefined) return null
        if (!needsFill(product)) return null
        const asked = product.name
        return fillRow({ projectId: catalog.projectId, name: asked }).then(async (fill) => {
          const now = latest.current.catalog
          const same = now?.products.find((item) => item.id === id)
          if (now === null || same === undefined || same.name !== asked || !needsFill(same)) return
          if (fill.job.trim() === '') return
          const saved = await latest.current.save({
            products: now.products.map((item) =>
              item.id === id
                ? {
                    ...item,
                    job: fill.job,
                    ...(fill.evidencePath ? { evidencePath: fill.evidencePath } : {})
                  }
                : item
            ),
            competitors: now.competitors
          })
          if (saved !== null) setWritten((marks) => new Set(marks).add(id))
        })
      },
      [fillRow]
    )
  )

  const { pending, start } = queue
  const filling = useCallback((id: string) => pending.has(id), [pending])
  const wasWritten = useCallback((id: string) => written.has(id), [written])
  const canRetry = useCallback(
    (product: ProjectProduct) =>
      fillRow !== undefined && available && !pending.has(product.id) && needsFill(product),
    [fillRow, available, pending]
  )
  return { filling, written: wasWritten, start, canRetry }
}
