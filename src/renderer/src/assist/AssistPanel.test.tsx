// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistDescription, AssistItem, AssistResult, AssistRunRequest } from '@shared/ipc'
import { AssistPanel, type AssistActions } from './AssistPanel'
import type { AssistClient } from './client'
import { describeMockAssist, runMockAssist } from './mock'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LABEL = {
  connection: 'claude-code' as const,
  connectionText: 'CiteFox AI · on your plan',
  expectedSeconds: 6,
  text: 'CiteFox AI · on your plan · about 6 s'
}

function description(overrides: Partial<AssistDescription> = {}): AssistDescription {
  return {
    assistId: 'page.shorterTitle',
    title: 'Suggest a shorter title',
    label: LABEL,
    savedDataOnly: true,
    searchCost: 0,
    acceptsInstruction: true,
    ...overrides
  }
}

function result(items: readonly AssistItem[], overrides: Partial<AssistResult> = {}): AssistResult {
  return {
    runId: 'run-1',
    assistId: 'page.shorterTitle',
    title: 'Suggest a shorter title',
    summary: 'Three options under 60 characters.',
    items,
    caution: 'Re-check the dates below.',
    label: LABEL,
    savedDataOnly: true,
    searchesUsed: 0,
    durationMs: 5000,
    model: null,
    ...overrides
  }
}

const ITEMS: readonly AssistItem[] = [
  {
    id: 'a',
    text: 'Business Text Alerts From Email',
    detail: '31 characters',
    tag: 'Short',
    verify: 'The price [$29]',
    sign: null
  },
  { id: 'b', text: 'Text Alerts, No Developer', detail: null, tag: null, verify: null, sign: 'add' }
]

function fakeClient(run: (request: AssistRunRequest) => Promise<AssistResult>): {
  client: AssistClient
  requests: AssistRunRequest[]
} {
  const requests: AssistRunRequest[] = []
  return {
    requests,
    client: {
      describe: async () => description(),
      run: async (request) => {
        requests.push(request)
        return run(request)
      }
    }
  }
}

async function openPanel(view: ReturnType<typeof render>): Promise<ReturnType<typeof within>> {
  const body = within(view.container)
  await waitFor(() => {
    expect(body.getByText('CiteFox AI · on your plan · about 6 s')).toBeTruthy()
  })
  fireEvent.click(body.getByRole('button', { name: 'Suggest a shorter title' }))
  await waitFor(() => {
    expect(body.getByRole('region', { name: 'Suggest a shorter title' })).toBeTruthy()
  })
  return body
}

describe('AssistPanel', () => {
  it('shows the title, the label and the No new searches badge before it runs', async () => {
    const { client, requests } = fakeClient(async () => result(ITEMS))
    const view = render(<AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} />)
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByText('CiteFox AI · on your plan · about 6 s')).toBeTruthy()
    })
    expect(body.getByText('No new searches')).toBeTruthy()
    expect(body.getByRole('button', { name: 'Suggest a shorter title' })).toBeTruthy()
    expect(body.queryByRole('region')).toBeNull()
    expect(requests).toHaveLength(0)
  })

  it('shows the result in place with summary, tag, re-verify, sign and caution', async () => {
    const { client, requests } = fakeClient(async () => result(ITEMS))
    const view = render(
      <AssistPanel
        assistId="page.shorterTitle"
        projectId="p1"
        pageId="page-1"
        marketId="mkt-us"
        promptId="pr-2"
        inputs={{ fixNumber: 1 }}
        client={client}
      />
    )
    const body = await openPanel(view)
    const region = within(body.getByRole('region', { name: 'Suggest a shorter title' }))
    expect(region.getByText('Three options under 60 characters.')).toBeTruthy()
    expect(region.getByText('Short')).toBeTruthy()
    expect(region.getByText(/Re-verify: The price \[\$29\]/)).toBeTruthy()
    expect(region.getByText('Add this line:')).toBeTruthy()
    expect(region.getByText('Re-check the dates below.')).toBeTruthy()
    expect(requests[0]).toEqual({
      assistId: 'page.shorterTitle',
      projectId: 'p1',
      pageId: 'page-1',
      marketId: 'mkt-us',
      promptId: 'pr-2',
      inputs: { fixNumber: 1 },
      instruction: null
    })
    expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      '2 suggestions'
    )
  })

  it('copies an item', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { client } = fakeClient(async () => result(ITEMS))
    const view = render(<AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} />)
    const body = await openPanel(view)
    const first = within(body.getAllByRole('listitem')[0] as HTMLElement)
    fireEvent.click(first.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(first.getByRole('button', { name: 'Copied' })).toBeTruthy()
    })
    expect(writeText).toHaveBeenCalledWith('Business Text Alerts From Email\n31 characters')
  })

  it('applies nothing until Apply, then offers Undo', async () => {
    const undo = vi.fn(async () => undefined)
    const apply = vi.fn<NonNullable<AssistActions['apply']>>(async () => undo)
    const { client } = fakeClient(async () => result(ITEMS))
    const view = render(
      <AssistPanel
        assistId="page.shorterTitle"
        projectId="p1"
        client={client}
        actions={{ apply }}
      />
    )
    const body = await openPanel(view)
    expect(apply).not.toHaveBeenCalled()
    const first = within(body.getAllByRole('listitem')[0] as HTMLElement)
    fireEvent.click(first.getByRole('button', { name: 'Apply' }))
    await waitFor(() => {
      expect(first.getByRole('button', { name: 'Undo' })).toBeTruthy()
    })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[0]).toMatchObject({ id: 'a' })
    expect(first.getByText('Applied')).toBeTruthy()
    fireEvent.click(first.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(first.getByRole('button', { name: 'Apply' })).toBeTruthy()
    })
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('shows Add with its own label and keeps Undo optional', async () => {
    const add = vi.fn(async () => undefined)
    const { client } = fakeClient(async () => result(ITEMS))
    const view = render(
      <AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} actions={{ add }} />
    )
    const body = await openPanel(view)
    const second = within(body.getAllByRole('listitem')[1] as HTMLElement)
    fireEvent.click(second.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(second.getByText('Added')).toBeTruthy()
    })
    expect(second.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('sends the instruction on Try again', async () => {
    const { client, requests } = fakeClient(async () => result(ITEMS))
    const view = render(<AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} />)
    const body = await openPanel(view)
    const input = body.getByPlaceholderText('Tell CiteFox AI what to change…')
    fireEvent.change(input, { target: { value: 'Keep scheduling first' } })
    fireEvent.click(body.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(requests).toHaveLength(2)
    })
    expect(requests[1]?.instruction).toBe('Keep scheduling first')
  })

  it('closes and runs again from the button', async () => {
    const { client, requests } = fakeClient(async () => result(ITEMS))
    const view = render(<AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} />)
    const body = await openPanel(view)
    fireEvent.click(body.getByRole('button', { name: 'Close' }))
    expect(body.queryByRole('region')).toBeNull()
    expect(
      body.getByRole('button', { name: 'Suggest a shorter title' }).getAttribute('aria-expanded')
    ).toBe('false')
    expect(requests).toHaveLength(1)
  })

  it('shows an error inline without the Electron wrapper, and Try again recovers', async () => {
    let fail = true
    const { client } = fakeClient(async () => {
      if (fail) {
        throw new Error(
          "Error invoking remote method 'assist:run': Error: assist:run: CiteFox AI is not logged in."
        )
      }
      return result(ITEMS)
    })
    const view = render(<AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} />)
    const body = await openPanel(view)
    const alert = body.getByRole('alert')
    expect(alert.textContent).toBe('CiteFox AI is not logged in.')
    fail = false
    fireEvent.click(body.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(body.getByText('Three options under 60 characters.')).toBeTruthy()
    })
    expect(body.queryByRole('alert')).toBeNull()
  })

  it('hides the instruction box when the assist takes none', async () => {
    const client: AssistClient = {
      describe: async () => description({ acceptsInstruction: false, savedDataOnly: false }),
      run: async () => result(ITEMS)
    }
    const view = render(<AssistPanel assistId="page.shorterTitle" projectId="p1" client={client} />)
    const body = await openPanel(view)
    expect(body.queryByPlaceholderText('Tell CiteFox AI what to change…')).toBeNull()
    expect(body.queryByText('No new searches')).toBeNull()
  })

  it('runs Apply all once and offers Undo', async () => {
    const undo = vi.fn(async () => undefined)
    const applyAll = vi.fn(async () => undo)
    const { client } = fakeClient(async () => result(ITEMS))
    const view = render(
      <AssistPanel
        assistId="page.shorterTitle"
        projectId="p1"
        client={client}
        actions={{ applyAll }}
      />
    )
    const body = await openPanel(view)
    fireEvent.click(body.getByRole('button', { name: 'Apply all' }))
    await waitFor(() => {
      expect(body.getByRole('button', { name: 'Undo' })).toBeTruthy()
    })
    fireEvent.click(body.getByRole('button', { name: 'Undo' }))
    await waitFor(() => {
      expect(body.getByRole('button', { name: 'Apply all' })).toBeTruthy()
    })
    expect(applyAll).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
  })
})

describe('mock assist client', () => {
  it('answers every shipped id with no searches and the label text', async () => {
    const described = await describeMockAssist({
      assistId: 'progress.otherMarkets',
      projectId: 'p'
    })
    expect(described.savedDataOnly).toBe(true)
    expect(described.label.text).toMatch(/^CiteFox AI · on your plan · about \d+ s$/)
    const ran = await runMockAssist({
      assistId: 'prompts.more',
      projectId: 'p',
      pageId: 'x',
      marketId: null,
      promptId: null,
      inputs: {},
      instruction: 'shorter'
    })
    expect(ran.searchesUsed).toBe(0)
    expect(ran.items.length).toBeGreaterThan(0)
    expect(new Set(ran.items.map((entry) => entry.id)).size).toBe(ran.items.length)
    expect(ran.summary).toContain('shorter')
  })
})
