// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RowFillResult, SetupDraft } from '@shared/ipc'
import { BrandStep } from '../steps/BrandStep'
import { BuyersStep } from '../steps/BuyersStep'
import { CompetitorsStep } from '../steps/CompetitorsStep'
import { fakeSectionClient, item, textboltDraft } from './fakeClient.test-helper'
import { StepHarness } from './StepHarness.test-helper'

afterEach(cleanup)

beforeEach(() => {
  window.location.hash = '#/setup/brand'
})

interface Deferred {
  name: string
  resolve: (result: RowFillResult) => void
  reject: (error: Error) => void
}

/** A client whose rowFill calls wait until the test answers them. */
function slowClient(available = true): {
  client: ReturnType<typeof fakeSectionClient>
  waiting: Deferred[]
} {
  const client = fakeSectionClient({ available })
  const waiting: Deferred[] = []
  client.rowFill.mockImplementation(
    ({ name }: { name: string }) =>
      new Promise<RowFillResult>((resolve, reject) => {
        waiting.push({ name, resolve, reject })
      })
  )
  return { client, waiting }
}

function products(): HTMLElement {
  return screen.getByTestId('section-products')
}

async function add(name: string, label = 'Add a product'): Promise<void> {
  fireEvent.change(screen.getByLabelText(label), { target: { value: name } })
  fireEvent.click(
    within(screen.getByLabelText(label).closest('.osc-add') as HTMLElement).getByRole('button', {
      name: 'Add'
    })
  )
}

function rowOf(container: HTMLElement, name: string): HTMLElement {
  const found = within(container)
    .getAllByTestId('section-row')
    .find((node) => node.querySelector('.osc-item-name')?.textContent === name)
  if (found === undefined) throw new Error(`no row ${name}`)
  return found
}

function brand(draft: Partial<SetupDraft> = {}, over: Record<string, unknown> = {}): SetupDraft {
  return textboltDraft(
    {
      brands: [item('TextBolt')],
      products: [
        item('Email-to-SMS gateway', { detail: 'Turns emails into texts.', url: '/email-to-text/' })
      ],
      ...over
    },
    draft
  )
}

describe('a product added by hand is filled in by CiteFox AI', () => {
  it('shows ✦ Filling in… while it runs, then the text with the ✦ mark', async () => {
    const { client, waiting } = slowClient()
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await add('Mass texting')
    const row = (): HTMLElement => rowOf(products(), 'Mass texting')
    expect(row().textContent).toContain('Filling in…')
    expect(row().querySelector('[aria-live="polite"]')).toBeTruthy()
    await waitFor(() => expect(client.rowFill).toHaveBeenCalledTimes(1))
    const call = client.rowFill.mock.calls[0]![0]
    expect(call).toMatchObject({ list: 'products', name: 'Mass texting' })
    expect(call.context.domain).toBe('textbolt.com')
    expect(call.context.summary).toContain('Turns an email into a text')
    expect(call.examples.map((example: { name: string }) => example.name)).toEqual([
      'Email-to-SMS gateway'
    ])
    await act(async () => {
      waiting[0]!.resolve({ detail: 'Sends one text to a whole list', url: '/bulk-sms/' })
    })
    await waitFor(() => expect(row().textContent).not.toContain('Filling in…'))
    expect(within(row()).getByTestId('row-ai-filled').textContent).toContain(
      'Sends one text to a whole list'
    )
    expect(row().textContent).toContain('/bulk-sms/')
    expect(row().textContent).not.toContain('Added by you')
    // Still the person's own row.
    expect(within(row()).getByTestId('row-tag').textContent).toBe('yours')
  })

  it('a failed call keeps "Added by you", shows no error, and offers a ✦ Fill in retry', async () => {
    const { client, waiting } = slowClient()
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await add('Mass texting')
    await waitFor(() => expect(waiting).toHaveLength(1))
    await act(async () => {
      waiting[0]!.reject(new Error('AI is busy'))
    })
    const row = (): HTMLElement => rowOf(products(), 'Mass texting')
    await waitFor(() => expect(row().textContent).toContain('Added by you'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/AI is busy/u)).toBeNull()
    const retry = within(row()).getByRole('button', {
      name: 'Fill in Mass texting with CiteFox AI'
    })
    fireEvent.click(retry)
    await waitFor(() => expect(waiting).toHaveLength(2))
    expect(row().textContent).toContain('Filling in…')
    await act(async () => {
      waiting[1]!.resolve({ detail: 'Sends texts to lists', url: null })
    })
    await waitFor(() => expect(row().textContent).toContain('Sends texts to lists'))
    expect(within(row()).queryByRole('button', { name: /Fill in/u })).toBeNull()
  })

  it('an "unknown" (blank) answer keeps "Added by you" with the retry link', async () => {
    const { client, waiting } = slowClient()
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await add('Zorgle')
    await waitFor(() => expect(waiting).toHaveLength(1))
    await act(async () => {
      waiting[0]!.resolve({ detail: '', url: null })
    })
    const row = rowOf(products(), 'Zorgle')
    await waitFor(() => expect(row.textContent).toContain('Added by you'))
    expect(within(row).getByRole('button', { name: /Fill in Zorgle/u })).toBeTruthy()
  })

  it('no AI: no call is wasted on a retry link, nothing is offered, "Added by you" stays', async () => {
    const { client, waiting } = slowClient(false)
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await waitFor(() => expect(client.sectionEstimate).toHaveBeenCalled())
    await add('Mass texting')
    await waitFor(() => expect(waiting).toHaveLength(1))
    await act(async () => {
      waiting[0]!.reject(new Error('CiteFox AI is not set up.'))
    })
    const row = rowOf(products(), 'Mass texting')
    await waitFor(() => expect(row.textContent).toContain('Added by you'))
    expect(within(row).queryByRole('button', { name: /Fill in/u })).toBeNull()
  })

  it('the person wins: a row edited while it runs drops the result, and so does a removed row', async () => {
    const { client, waiting } = slowClient()
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await add('Mass texting')
    await add('Group chat')
    await waitFor(() => expect(waiting).toHaveLength(2))
    // Edit the first row's detail while it runs.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mass texting' }))
    const editor = await screen.findByTestId('section-row-edit')
    fireEvent.change(within(editor).getByLabelText('What it does'), {
      target: { value: 'My own words' }
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    // Remove the second row.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Group chat' }))
    await act(async () => {
      waiting[0]!.resolve({ detail: 'AI words', url: '/bulk-sms/' })
      waiting[1]!.resolve({ detail: 'AI words too', url: null })
    })
    const row = rowOf(products(), 'Mass texting')
    expect(row.textContent).toContain('My own words')
    expect(row.textContent).not.toContain('AI words')
    expect(row.textContent).not.toContain('/bulk-sms/')
    expect(within(products()).queryByText('Group chat')).toBeNull()
    expect(products().textContent).not.toContain('AI words too')
  })

  it('an edit after the fill wins: the person can change the AI text, and the mark goes', async () => {
    const { client, waiting } = slowClient()
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await add('Mass texting')
    await waitFor(() => expect(waiting).toHaveLength(1))
    await act(async () => {
      waiting[0]!.resolve({ detail: 'Sends texts', url: null })
    })
    await waitFor(() => expect(within(products()).getByTestId('row-ai-filled')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mass texting' }))
    const editor = await screen.findByTestId('section-row-edit')
    fireEvent.change(within(editor).getByLabelText('What it does'), {
      target: { value: 'Bulk text blasts for shops' }
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    const row = rowOf(products(), 'Mass texting')
    expect(row.textContent).toContain('Bulk text blasts for shops')
    expect(within(row).queryByTestId('row-ai-filled')).toBeNull()
  })

  it('quick adds queue: two run at once, the third waits for a slot', async () => {
    const { client, waiting } = slowClient()
    render(<StepHarness Step={BrandStep} initial={brand()} client={client} />)
    await add('One')
    await add('Two')
    await add('Three')
    await waitFor(() => expect(waiting).toHaveLength(2))
    expect(client.rowFill).toHaveBeenCalledTimes(2)
    // The queued row already reads as filling in.
    expect(rowOf(products(), 'Three').textContent).toContain('Filling in…')
    await act(async () => {
      waiting[0]!.resolve({ detail: 'First one', url: null })
    })
    await waitFor(() => expect(waiting).toHaveLength(3))
    expect(waiting.map((call) => call.name)).toEqual(['One', 'Two', 'Three'])
    await act(async () => {
      waiting[1]!.resolve({ detail: 'Second one', url: null })
      waiting[2]!.resolve({ detail: 'Third one', url: null })
    })
    await waitFor(() => expect(products().textContent).toContain('Third one'))
  })

  it('a row that already has its second part (typed with "who: situation") is not sent', async () => {
    window.location.hash = '#/setup/buyers'
    const client = fakeSectionClient()
    render(<StepHarness Step={BuyersStep} initial={textboltDraft({})} client={client} />)
    await waitFor(() => expect(client.sectionEstimate).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Add a buyer'), {
      target: { value: 'Clinic manager: reminders stopped' }
    })
    fireEvent.click(
      within(screen.getByLabelText('Add a buyer').closest('.osc-add') as HTMLElement).getByRole(
        'button',
        {
          name: 'Add'
        }
      )
    )
    expect(screen.getByText('reminders stopped')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(client.rowFill).not.toHaveBeenCalled()
  })

  it('buyers: a name alone is filled in with its situation', async () => {
    window.location.hash = '#/setup/buyers'
    const client = fakeSectionClient({ fill: { detail: 'Their reminders stopped', url: null } })
    render(<StepHarness Step={BuyersStep} initial={textboltDraft({})} client={client} />)
    fireEvent.change(screen.getByLabelText('Add a buyer'), { target: { value: 'Clinic manager' } })
    fireEvent.click(
      within(screen.getByLabelText('Add a buyer').closest('.osc-add') as HTMLElement).getByRole(
        'button',
        {
          name: 'Add'
        }
      )
    )
    await waitFor(() => expect(screen.getByText('Their reminders stopped')).toBeTruthy())
    expect(client.rowFill.mock.calls[0]![0]).toMatchObject({
      list: 'buyers',
      name: 'Clinic manager'
    })
  })

  it('a list that does not ask for it (competitors) never calls rowFill', async () => {
    window.location.hash = '#/setup/competitors'
    const client = fakeSectionClient()
    render(<StepHarness Step={CompetitorsStep} initial={textboltDraft({})} client={client} />)
    fireEvent.change(screen.getByLabelText('Add a competitor'), {
      target: { value: 'txtimpact.com' }
    })
    fireEvent.click(
      within(
        screen.getByLabelText('Add a competitor').closest('.osc-add') as HTMLElement
      ).getByRole('button', { name: 'Add' })
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(client.rowFill).not.toHaveBeenCalled()
    expect(vi.isMockFunction(client.rowFill)).toBe(true)
  })
})
