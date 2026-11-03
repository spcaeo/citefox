// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectProduct } from '@shared/domain'
import type {
  FillProductRowRequest,
  FillProductRowResult,
  ProductCatalogView,
  SaveProductCatalogRequest
} from '@shared/ipc'
import type { ProductsApi } from './client'
import { ProductsPanel } from './ProductsPanel'
import { useProductCatalog } from './useProductCatalog'

afterEach(cleanup)

const GATEWAY: ProjectProduct = {
  id: 'prod-gw',
  name: 'Email-to-SMS gateway',
  job: 'Send SMS from email',
  buyer: 'IT teams',
  evidencePath: '/email-to-sms/'
}

interface Waiting {
  request: FillProductRowRequest
  resolve: (result: FillProductRowResult) => void
  reject: (error: Error) => void
}

function fillApi(available = true): {
  api: ProductsApi
  saves: SaveProductCatalogRequest[]
  waiting: Waiting[]
} {
  let catalog: ProductCatalogView = { projectId: 'proj-1', products: [GATEWAY], competitors: [] }
  const saves: SaveProductCatalogRequest[] = []
  const waiting: Waiting[] = []
  const api: ProductsApi = {
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
    'products:page': vi.fn(),
    'products:setPage': vi.fn(),
    'products:fillEstimate': vi.fn(() =>
      Promise.resolve({
        kind: 'rowFill',
        available,
        calls: 1,
        costText: '1 AI call',
        reason: available ? null : 'CiteFox AI is not set up.'
      })
    ),
    'products:fillRow': vi.fn(
      (request: FillProductRowRequest) =>
        new Promise<FillProductRowResult>((resolve, reject) => {
          waiting.push({ request, resolve, reject })
        })
    )
  } as unknown as ProductsApi
  return { api, saves, waiting }
}

function Panel({ api }: { api: ProductsApi }): JSX.Element {
  const state = useProductCatalog('proj-1', api)
  return <ProductsPanel state={state} api={api} />
}

async function addProduct(name: string): Promise<void> {
  const box = await screen.findByRole('textbox', { name: 'Add a product' })
  fireEvent.change(box, { target: { value: name } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('ProductsPanel: a product added by name is filled in by CiteFox AI', () => {
  it('shows Filling in…, then saves the job and a tracked page with the ✦ mark', async () => {
    const { api, saves, waiting } = fillApi()
    render(<Panel api={api} />)
    await addProduct('Mass texting')
    await waitFor(() => expect(waiting).toHaveLength(1))
    expect(waiting[0]?.request).toEqual({ projectId: 'proj-1', name: 'Mass texting' })
    expect(screen.getByTestId('product-filling').textContent).toContain('Filling in…')
    await act(async () => {
      waiting[0]!.resolve({ job: 'Sends one text to a whole list', evidencePath: '/bulk-sms/' })
    })
    await waitFor(() => expect(saves).toHaveLength(2))
    expect(saves[1]?.products[1]).toMatchObject({
      name: 'Mass texting',
      job: 'Sends one text to a whole list',
      evidencePath: '/bulk-sms/'
    })
    expect(await screen.findByText('Sends one text to a whole list')).toBeTruthy()
    expect(screen.getByText('Written by CiteFox AI:')).toBeTruthy()
    expect(screen.queryByTestId('product-filling')).toBeNull()
  })

  it('a blank answer or a failed call saves nothing; ✦ Fill in offers another try', async () => {
    const { api, saves, waiting } = fillApi()
    render(<Panel api={api} />)
    await addProduct('Zorgle')
    await waitFor(() => expect(waiting).toHaveLength(1))
    await act(async () => {
      waiting[0]!.resolve({ job: '', evidencePath: null })
    })
    const retry = await screen.findByRole('button', { name: 'Fill in Zorgle with CiteFox AI' })
    expect(saves).toHaveLength(1)
    fireEvent.click(retry)
    await waitFor(() => expect(waiting).toHaveLength(2))
    await act(async () => {
      waiting[1]!.reject(new Error('busy'))
    })
    await screen.findByRole('button', { name: 'Fill in Zorgle with CiteFox AI' })
    expect(saves).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops the result when the product was renamed or removed meanwhile', async () => {
    const { api, saves, waiting } = fillApi()
    render(<Panel api={api} />)
    await addProduct('Mass texting')
    await waitFor(() => expect(waiting).toHaveLength(1))
    const name = await screen.findByRole('textbox', { name: 'Product name: Mass texting' })
    fireEvent.change(name, { target: { value: 'Group texting' } })
    fireEvent.blur(name)
    await waitFor(() => expect(saves).toHaveLength(2))
    await act(async () => {
      waiting[0]!.resolve({ job: 'Sends texts', evidencePath: null })
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(saves).toHaveLength(2)
    expect(saves[1]?.products[1]?.job).toBe('')
  })

  it('two at a time: the third add waits for a free slot', async () => {
    const { api, waiting } = fillApi()
    render(<Panel api={api} />)
    await addProduct('One')
    await addProduct('Two')
    await addProduct('Three')
    await waitFor(() => expect(waiting).toHaveLength(2))
    await act(async () => {
      waiting[0]!.resolve({ job: 'First', evidencePath: null })
    })
    await waitFor(() => expect(waiting).toHaveLength(3))
    expect(waiting.map((call) => call.request.name)).toEqual(['One', 'Two', 'Three'])
  })

  it('no AI ready: no retry link is offered', async () => {
    const { api, waiting } = fillApi(false)
    render(<Panel api={api} />)
    await waitFor(() => expect(api['products:fillEstimate']).toHaveBeenCalled())
    await addProduct('Mass texting')
    await waitFor(() => expect(waiting).toHaveLength(1))
    await act(async () => {
      waiting[0]!.reject(new Error('CiteFox AI is not set up.'))
    })
    const grid = screen.getByRole('grid', { name: 'Products' })
    await waitFor(() => expect(within(grid).queryByTestId('product-filling')).toBeNull())
    expect(within(grid).queryByRole('button', { name: /Fill in/u })).toBeNull()
  })
})
