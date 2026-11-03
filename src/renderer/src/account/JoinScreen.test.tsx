// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountDetails, AccountSaveResult, AccountStatus } from '@shared/ipc'
import { AccountCard } from './AccountCard'
import type { AccountClient } from './client'
import { JoinScreen } from './JoinScreen'

afterEach(cleanup)

const DETAILS: AccountDetails = {
  name: 'Ana Ruiz',
  email: 'ana@agency.com',
  company: 'Agency Co',
  role: 'agency',
  productUpdates: false,
  news: false
}

function fakeClient(status: Partial<AccountStatus> = {}): {
  client: AccountClient
  saved: AccountDetails[]
} {
  const saved: AccountDetails[] = []
  const client: AccountClient = {
    get: () =>
      Promise.resolve({ enabled: true, joined: false, waiting: false, details: null, ...status }),
    save: (details): Promise<AccountSaveResult> => {
      saved.push(details)
      return Promise.resolve({
        ok: true,
        status: { enabled: true, joined: true, waiting: false, details }
      })
    }
  }
  return { client, saved }
}

function type(view: ReturnType<typeof render>, label: string, value: string): void {
  fireEvent.change(view.getByRole('textbox', { name: new RegExp(`^${label}`) }), {
    target: { value }
  })
}

describe('Join CiteFox', () => {
  it('asks for name, email, company and who the reports are for, with both email boxes ticked to start', () => {
    const view = render(<JoinScreen client={fakeClient().client} onJoined={() => undefined} />)
    expect(view.getByRole('heading', { name: 'Join CiteFox' })).toBeTruthy()
    for (const label of ['Your name', 'Work email', 'Company']) {
      expect(view.getByRole('textbox', { name: new RegExp(`^${label}`) })).toBeTruthy()
    }
    expect(view.getByRole('group', { name: 'Who are the reports for?' })).toBeTruthy()
    const updates = view.getByRole('checkbox', { name: 'Product updates' }) as HTMLInputElement
    const news = view.getByRole('checkbox', {
      name: 'Occasional news and offers'
    }) as HTMLInputElement
    expect(updates.checked).toBe(true)
    expect(news.checked).toBe(true)
    expect(view.container.textContent).toContain(
      'Your SEO data stays on this computer. Only these details and an anonymous daily version check are sent.'
    )
  })

  it('will not continue until the details are filled in', async () => {
    const { client, saved } = fakeClient()
    const onJoined = vi.fn()
    const view = render(<JoinScreen client={client} onJoined={onJoined} />)
    fireEvent.click(view.getByRole('button', { name: /Join and continue/ }))
    expect(await view.findByText('Enter your name.')).toBeTruthy()
    expect(view.getByText('Enter your email.')).toBeTruthy()
    expect(view.getByText('Choose who the reports are for.')).toBeTruthy()
    expect(saved).toEqual([])
    expect(onJoined).not.toHaveBeenCalled()
  })

  it('joins with the boxes as the person left them (they can untick)', async () => {
    const { client, saved } = fakeClient()
    const onJoined = vi.fn()
    const view = render(<JoinScreen client={client} onJoined={onJoined} />)
    type(view, 'Your name', 'Ana Ruiz')
    type(view, 'Work email', 'ana@agency.com')
    type(view, 'Company', 'Agency Co')
    fireEvent.click(view.getByRole('radio', { name: /Clients/ }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Product updates' }))
    fireEvent.click(view.getByRole('button', { name: /Join and continue/ }))
    await waitFor(() => {
      expect(onJoined).toHaveBeenCalled()
    })
    expect(saved).toEqual([{ ...DETAILS, productUpdates: false, news: true }])
  })

  it('keeps both boxes ticked when the person does not touch them', async () => {
    const { client, saved } = fakeClient()
    const view = render(<JoinScreen client={client} onJoined={() => undefined} />)
    type(view, 'Your name', 'Ana Ruiz')
    type(view, 'Work email', 'ana@agency.com')
    type(view, 'Company', 'Agency Co')
    fireEvent.click(view.getByRole('radio', { name: /Clients/ }))
    fireEvent.click(view.getByRole('button', { name: /Join and continue/ }))
    await waitFor(() => {
      expect(saved).toEqual([{ ...DETAILS, productUpdates: true, news: true }])
    })
  })
})

describe('Your CiteFox account card', () => {
  it('shows the saved details and saves a change', async () => {
    const { client, saved } = fakeClient({ joined: true, details: DETAILS })
    const view = render(<AccountCard client={client} />)
    const email = (await view.findByLabelText('Work email')) as HTMLInputElement
    expect(email.value).toBe('ana@agency.com')
    expect(view.getByText('Joined')).toBeTruthy()
    fireEvent.click(view.getByRole('checkbox', { name: 'Occasional news and offers' }))
    fireEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(await view.findByText('Saved.')).toBeTruthy()
    expect(saved).toEqual([{ ...DETAILS, news: true }])
  })

  it('says when the details are waiting to be sent (offline)', async () => {
    const { client } = fakeClient({ joined: true, waiting: true, details: DETAILS })
    const view = render(<AccountCard client={client} />)
    expect(await view.findByText('Not sent yet')).toBeTruthy()
  })

  it('is hidden when this build does not register', async () => {
    const { client } = fakeClient({ enabled: false })
    const get = vi.spyOn(client, 'get')
    const view = render(<AccountCard client={client} />)
    await waitFor(() => {
      expect(get).toHaveBeenCalled()
    })
    expect(view.container.textContent).toBe('')
  })
})
