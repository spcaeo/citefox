// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProductCompetitor, ProjectProduct, TopicDraft } from '@shared/domain'
import type {
  PageProductView,
  ProductCatalogView,
  SaveProductCatalogRequest,
  SetPageProductRequest,
  TopicDraftPatch
} from '@shared/ipc'
import type { ProductsApi } from './client'
import { productsApi } from './client'
import { choiceOf, productOptions } from './options'
import { PageProductField } from './PageProductField'
import { ProductsPanel } from './ProductsPanel'
import { TopicProductFact, TopicProductPicker } from './TopicProductFact'
import { useProductCatalog } from './useProductCatalog'

afterEach(cleanup)

const GATEWAY: ProjectProduct = {
  id: 'prod-gw',
  name: 'Email-to-SMS gateway',
  job: 'Send SMS from email',
  buyer: 'IT teams',
  evidencePath: '/email-to-sms/'
}
const BULK: ProjectProduct = {
  id: 'prod-bulk',
  name: 'Bulk SMS marketing',
  job: 'Text campaigns',
  buyer: 'Marketers',
  evidencePath: null
}

function row(
  name: string,
  productId: string | null,
  tier: 'direct' | 'partial' = 'direct'
): ProductCompetitor {
  return {
    name,
    domain: `${name.toLowerCase()}.com`,
    productId,
    tier,
    startingPrice: null,
    sources: []
  }
}

function fakeApi(start: Omit<ProductCatalogView, 'projectId'>): ProductsApi & {
  saves: SaveProductCatalogRequest[]
  picks: SetPageProductRequest[]
} {
  let catalog: ProductCatalogView = { projectId: 'proj-1', ...start }
  const saves: SaveProductCatalogRequest[] = []
  const picks: SetPageProductRequest[] = []
  let page: PageProductView = {
    pageId: 'page-1',
    productId: 'prod-gw',
    pinned: false,
    suggestedId: 'prod-gw',
    reason: 'Its URL is where the site describes Email-to-SMS gateway.',
    products: start.products
  }
  return {
    saves,
    picks,
    'products:get': vi.fn(() => Promise.resolve(catalog)),
    'products:save': vi.fn((request: SaveProductCatalogRequest) => {
      saves.push(request)
      catalog = {
        projectId: 'proj-1',
        products: request.products,
        competitors: request.competitors
      }
      return Promise.resolve(catalog)
    }),
    'products:saveFill': vi.fn(() => Promise.resolve(catalog)),
    'products:page': vi.fn(() => Promise.resolve(page)),
    'products:setPage': vi.fn((request: SetPageProductRequest) => {
      picks.push(request)
      page =
        request.mode === 'auto'
          ? { ...page, pinned: false, productId: page.suggestedId }
          : { ...page, pinned: true, productId: request.productId }
      return Promise.resolve(page)
    })
  }
}

function Panel({ api }: { api: ProductsApi }): JSX.Element {
  const state = useProductCatalog('proj-1', api)
  return <ProductsPanel state={state} />
}

describe('ProductsPanel (Settings › General)', () => {
  it('maps a competitor to another product and tier, saving at once', async () => {
    const api = fakeApi({
      products: [GATEWAY, BULK],
      competitors: [row('TXTImpact', 'prod-gw'), row('SimpleTexting', 'prod-gw', 'partial')]
    })
    render(<Panel api={api} />)
    const product = await screen.findByRole('combobox', { name: 'Product for SimpleTexting' })
    fireEvent.change(product, { target: { value: 'prod-bulk' } })
    await waitFor(() => expect(api.saves).toHaveLength(1))
    expect(api.saves[0]?.competitors[1]).toMatchObject({
      name: 'SimpleTexting',
      productId: 'prod-bulk'
    })
    const tier = await screen.findByRole('combobox', { name: 'How close TXTImpact is' })
    fireEvent.change(tier, { target: { value: 'partial' } })
    await waitFor(() => expect(api.saves).toHaveLength(2))
    expect(api.saves[1]?.competitors[0]).toMatchObject({ name: 'TXTImpact', tier: 'partial' })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Product for TXTImpact' }), {
      target: { value: '' }
    })
    await waitFor(() => expect(api.saves[2]?.competitors[0]?.productId).toBeNull())
  })

  it('adds, renames and removes products; a removed product’s competitors stay for the whole business', async () => {
    const api = fakeApi({ products: [GATEWAY], competitors: [row('TXTImpact', 'prod-gw')] })
    render(<Panel api={api} />)
    const add = await screen.findByRole('textbox', { name: 'Add a product' })
    fireEvent.change(add, { target: { value: 'Bulk SMS' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    await waitFor(() => expect(api.saves).toHaveLength(1))
    expect(api.saves[0]?.products.map((item) => item.name)).toEqual([
      'Email-to-SMS gateway',
      'Bulk SMS'
    ])
    expect(api.saves[0]?.products[1]?.id).toMatch(/^prod-[a-z0-9]+$/u)
    const name = await screen.findByRole('textbox', { name: 'Product name: Email-to-SMS gateway' })
    fireEvent.change(name, { target: { value: 'Email to SMS' } })
    fireEvent.blur(name)
    await waitFor(() => expect(api.saves).toHaveLength(2))
    expect(api.saves[1]?.products[0]?.name).toBe('Email to SMS')
    // Remove sits behind the row's ⋯ in the Products grid.
    const grid = screen.getByRole('grid', { name: 'Products' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Email to SMS' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove product Email to SMS' }))
    await waitFor(() => expect(api.saves).toHaveLength(3))
    expect(api.saves[2]?.products.map((item) => item.name)).toEqual(['Bulk SMS'])
    expect(api.saves[2]?.competitors).toEqual([row('TXTImpact', null)])
  })

  it('shows nothing without the products bridge', () => {
    expect(productsApi()).toBeNull()
    const { container } = render(
      <ProductsPanel
        state={{ catalog: null, error: null, saving: false, save: vi.fn(), reload: vi.fn() }}
      />
    )
    expect(container.innerHTML).toBe('')
  })
})

describe('PageProductField (page header)', () => {
  it('shows Automatic with what it picks, pins a product, and goes back to automatic', async () => {
    const api = fakeApi({ products: [GATEWAY, BULK], competitors: [] })
    render(<PageProductField projectId="proj-1" pageId="page-1" api={api} />)
    const select = await screen.findByRole('combobox', { name: 'Product' })
    expect((select as HTMLSelectElement).value).toBe('auto')
    expect(
      within(select).getByRole('option', { name: 'Automatic (Email-to-SMS gateway)' })
    ).toBeTruthy()
    fireEvent.change(select, { target: { value: 'prod-bulk' } })
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('prod-bulk'))
    expect(api.picks[0]).toEqual({
      projectId: 'proj-1',
      pageId: 'page-1',
      mode: 'pick',
      productId: 'prod-bulk'
    })
    fireEvent.change(select, { target: { value: 'whole' } })
    await waitFor(() => expect(api.picks[1]?.productId).toBeNull())
    fireEvent.change(select, { target: { value: 'auto' } })
    await waitFor(() => expect(api.picks[2]?.mode).toBe('auto'))
  })

  it('is hidden when the project has no products', async () => {
    const api = fakeApi({ products: [], competitors: [] })
    const { container } = render(<PageProductField projectId="proj-1" pageId="page-1" api={api} />)
    await waitFor(() => expect(api['products:page']).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})

describe('TopicProductFact and TopicProductPicker (topic wizard, Seed step)', () => {
  function Harness({
    api,
    onPatch
  }: {
    api: ProductsApi
    onPatch: (patch: TopicDraftPatch) => void
  }): JSX.Element {
    const [draft, setDraft] = useState<Pick<TopicDraft, 'seed' | 'name' | 'productId'>>({
      seed: 'Run a bulk SMS marketing campaign for a shop',
      name: 'Campaigns'
    })
    return (
      <>
        <dl>
          <TopicProductFact projectId="proj-1" draft={draft} api={api} />
        </dl>
        <TopicProductPicker
          projectId="proj-1"
          draft={draft}
          api={api}
          patch={(patch) => {
            onPatch(patch)
            const product = patch.product
            if (product === undefined) return
            setDraft((current) => {
              const next = { ...current }
              if (product.mode === 'auto') delete next.productId
              else next.productId = product.productId
              return next
            })
          }}
        />
      </>
    )
  }

  it('suggests the seed’s product and sends the pick as a draft patch', async () => {
    const api = fakeApi({ products: [GATEWAY, BULK], competitors: [] })
    const patches: TopicDraftPatch[] = []
    render(<Harness api={api} onPatch={(patch) => patches.push(patch)} />)
    const select = await screen.findByRole('combobox', { name: 'Product this topic is about' })
    expect(screen.getByRole('definition').textContent).toBe('Bulk SMS marketing · auto')
    expect(
      within(select).getByRole('option', { name: 'Automatic (Bulk SMS marketing)' })
    ).toBeTruthy()
    fireEvent.change(select, { target: { value: 'prod-gw' } })
    expect(patches).toEqual([{ product: { mode: 'pick', productId: 'prod-gw' } }])
    expect((select as HTMLSelectElement).value).toBe('prod-gw')
    expect(screen.getByRole('definition').textContent).toBe('Email-to-SMS gateway')
    fireEvent.change(select, { target: { value: 'auto' } })
    expect(patches[1]).toEqual({ product: { mode: 'auto' } })
  })
})

describe('product options', () => {
  it('labels automatic with what it picks and maps values to choices', () => {
    expect(productOptions([GATEWAY], null).map((option) => option.label)).toEqual([
      'Automatic (Whole business)',
      'Email-to-SMS gateway',
      'Whole business'
    ])
    expect(choiceOf('auto')).toEqual({ mode: 'auto', productId: null })
    expect(choiceOf('whole')).toEqual({ mode: 'pick', productId: null })
    expect(choiceOf('prod-gw')).toEqual({ mode: 'pick', productId: 'prod-gw' })
  })
})
