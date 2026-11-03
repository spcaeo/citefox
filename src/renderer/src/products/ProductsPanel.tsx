import { useId, useState, type JSX } from 'react'
import type { ProductCompetitor, ProjectProduct } from '@shared/domain'
import { openDrawer } from '../shell/drawers'
import { siteColumns } from '../sites/siteColumns'
import { Button, ListGrid, ToolButton, type ListColumn } from '../ui'
import { productsApi, type ProductsApi } from './client'
import { newProductId } from './options'
import type { ProductCatalogState } from './useProductCatalog'
import { useProductFill, type ProductFill } from './useProductFill'
import './products.css'

const WHOLE = ''

/**
 * Settings › General (Docs/PROMPT-AUDIT.md PC): the products the business sells, and
 * which product each saved competitor competes with, and how closely. Every change
 * saves at once. Hidden until the catalog loads (and when the bridge has no products
 * channels), so the competitor chips above keep working on their own.
 */
export function ProductsPanel({
  state,
  onChanged,
  api = productsApi()
}: {
  state: ProductCatalogState
  /** After a save that may have changed the flat competitor list. */
  onChanged?: () => void
  /** The products channels (CiteFox AI fills in the job of a product added by name). */
  api?: ProductsApi | null
}): JSX.Element | null {
  const base = useId()
  const [draftName, setDraftName] = useState('')
  const fill = useProductFill(state, api)
  const catalog = state.catalog
  if (catalog === null) {
    return state.error ? (
      <p className="field-error" role="alert">
        {state.error}
      </p>
    ) : null
  }
  const { products, competitors } = catalog

  async function save(
    nextProducts: readonly ProjectProduct[],
    nextCompetitors: readonly ProductCompetitor[]
  ): Promise<void> {
    const saved = await state.save({ products: nextProducts, competitors: nextCompetitors })
    if (saved !== null) onChanged?.()
  }

  function rename(id: string, name: string): void {
    const clean = name.trim()
    const current = products.find((item) => item.id === id)
    if (current === undefined || clean.length === 0 || clean === current.name) return
    void save(
      products.map((item) => (item.id === id ? { ...item, name: clean } : item)),
      competitors
    )
  }

  function addProduct(): void {
    const name = draftName.trim()
    if (name.length === 0) return
    setDraftName('')
    const id = newProductId()
    // A name only: once it is saved, CiteFox AI writes what it does (and its page).
    void save(
      [...products, { id, name, job: '', buyer: '', evidencePath: null }],
      competitors
    ).then(() => {
      fill.start(id)
    })
  }

  function removeProduct(id: string): void {
    // Its competitors stay, for the whole business, unless already listed there.
    const moved: ProductCompetitor[] = []
    for (const row of competitors) {
      if (row.productId !== id) {
        moved.push(row)
        continue
      }
      const listed = moved.some(
        (other) => other.productId === null && other.name.toLowerCase() === row.name.toLowerCase()
      )
      if (!listed) moved.push({ ...row, productId: null })
    }
    void save(
      products.filter((item) => item.id !== id),
      moved
    )
  }

  function setRow(index: number, patch: Partial<ProductCompetitor>): void {
    void save(
      products,
      competitors.map((row, at) => (at === index ? { ...row, ...patch } : row))
    )
  }

  return (
    <div className="prod-panel">
      <span className="field-label" aria-hidden="true">
        Products
      </span>
      <p className="prod-hint">
        What you sell. Each page and topic is matched to one, so questions name that product’s
        competitors.
      </p>
      {products.length > 0 ? (
        <ListGrid<ProjectProduct>
          label="Products"
          className="prod-grid"
          noun={['product', 'products']}
          rows={products}
          rowKey={(product) => product.id}
          rowLabel={(product) => product.name}
          columns={productColumns(rename, fill)}
          rowMenu={(product) => [
            {
              id: 'remove',
              label: `Remove product ${product.name}`,
              icon: 'trash',
              tone: 'danger',
              disabled: state.saving,
              onSelect: () => removeProduct(product.id)
            }
          ]}
          empty={null}
        />
      ) : null}
      <div className="inline ps-add">
        <label className="sr-only" htmlFor={`${base}-new`}>
          Add a product
        </label>
        <input
          id={`${base}-new`}
          className="ob-input"
          placeholder="Add a product, e.g. Email-to-SMS gateway"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            addProduct()
          }}
        />
        <Button onClick={addProduct} disabled={state.saving}>
          Add
        </Button>
        <ToolButton
          kind="upload"
          label="Import products"
          disabled={state.saving}
          onClick={() =>
            openDrawer(
              'import',
              { 'import.entity': 'products' },
              {
                onResult: () => {
                  void state.reload().then(() => onChanged?.())
                }
              }
            )
          }
        />
      </div>
      {products.length > 0 && competitors.length > 0 ? (
        <>
          <span className="field-label" aria-hidden="true">
            Competitors by product
          </span>
          <ListGrid<ProductCompetitor>
            label="Competitors by product"
            className="prod-grid"
            noun={['competitor', 'competitors']}
            rows={competitors}
            rowKey={(row) => `${row.productId ?? WHOLE}:${row.name}`}
            rowLabel={(row) => row.name}
            columns={competitorColumns(products, competitors, state.saving, setRow)}
            empty={null}
          />
          <p className="prod-hint">
            Direct: same job for the same buyer. Partial: an overlap only. Whole business: counts
            for every product.
          </p>
        </>
      ) : null}
      {state.error ? (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  )
}

/** Products: the name edits in place (saved on blur or Enter); Remove sits behind the row's ⋯. */
function productColumns(
  rename: (id: string, name: string) => void,
  fill: ProductFill
): ListColumn<ProjectProduct>[] {
  return [
    {
      id: 'name',
      label: 'Name',
      width: 'fill',
      render: (product) => (
        <input
          className="ob-input"
          aria-label={`Product name: ${product.name}`}
          defaultValue={product.name}
          onBlur={(event) => rename(product.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      )
    },
    {
      id: 'job',
      label: 'Job it does',
      width: 'fill',
      render: (product) => <JobCell product={product} fill={fill} />
    }
  ]
}

/** Competitors: which product each competes with, and how closely. Every change saves at once. */
function competitorColumns(
  products: readonly ProjectProduct[],
  competitors: readonly ProductCompetitor[],
  saving: boolean,
  setRow: (index: number, patch: Partial<ProductCompetitor>) => void
): ListColumn<ProductCompetitor>[] {
  const at = (row: ProductCompetitor): number => competitors.indexOf(row)
  return [
    ...siteColumns<ProductCompetitor>({
      site: (row) => ({ domain: row.domain, name: row.name }),
      nameLabel: 'Competitor',
      websiteWidth: 184
    }),
    {
      id: 'product',
      label: 'Product',
      width: 220,
      render: (row) => (
        <select
          className="select"
          aria-label={`Product for ${row.name}`}
          value={row.productId ?? WHOLE}
          disabled={saving}
          onChange={(event) => setRow(at(row), { productId: event.target.value || null })}
        >
          <option value={WHOLE}>Whole business</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      )
    },
    {
      id: 'tier',
      label: 'How close',
      width: 128,
      render: (row) => (
        <select
          className="select prod-tier"
          aria-label={`How close ${row.name} is`}
          value={row.tier}
          disabled={saving}
          onChange={(event) =>
            setRow(at(row), { tier: event.target.value === 'partial' ? 'partial' : 'direct' })
          }
        >
          <option value="direct">Direct</option>
          <option value="partial">Partial</option>
        </select>
      )
    }
  ]
}

/** A product's job: "Filling in…" while CiteFox AI writes it, the ✦ mark once it did, a retry link. */
function JobCell({ product, fill }: { product: ProjectProduct; fill: ProductFill }): JSX.Element {
  if (fill.filling(product.id)) {
    return (
      <span className="prod-domain prod-filling" aria-live="polite" data-testid="product-filling">
        <span className="prod-mark" aria-hidden="true">
          ✦
        </span>{' '}
        Filling in…
      </span>
    )
  }
  const mark = fill.written(product.id) && product.job.length > 0
  return (
    <span className="prod-domain" aria-live="polite">
      {mark ? (
        <>
          <span className="prod-mark" aria-hidden="true" title="Written by CiteFox AI">
            ✦
          </span>
          <span className="sr-only">Written by CiteFox AI: </span>{' '}
        </>
      ) : null}
      {product.job || '—'}
      {fill.canRetry(product) ? (
        <button
          type="button"
          className="prod-retry"
          aria-label={`Fill in ${product.name} with CiteFox AI`}
          onClick={() => fill.start(product.id)}
        >
          ✦ Fill in
        </button>
      ) : null}
    </span>
  )
}
