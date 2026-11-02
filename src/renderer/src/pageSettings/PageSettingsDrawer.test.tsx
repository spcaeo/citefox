// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market, PromptSetView } from '@shared/domain'
import type { PageDetail, UpdatePageRequest } from '@shared/ipc'
import { UndoToastHost } from '../ui'
import { PageSettingsDrawer, type PageSettingsClient } from './PageSettingsDrawer'
import { changesFor, formFromPage, searchesPerCheck, urlProblem } from './model'

afterEach(cleanup)

const US: Market = {
  id: 'us-en',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: 'uk-en', country: 'GB' }

const PAGE: PageDetail = {
  id: 'page-1',
  projectId: 'textbolt',
  url: 'https://textbolt.com/alerts',
  title: 'Alerts',
  label: 'Text alerts',
  folder: null,
  status: 'tracked',
  setupStep: null,
  intervalDays: 14,
  samples: 1,
  promptCount: 10,
  defaultMarketId: US.id,
  pinned: false,
  score: 50,
  promptSetVersion: 1,
  markets: [US, UK],
  snapshotId: null
}

function fakeClient(): PageSettingsClient & { updates: UpdatePageRequest[] } {
  const updates: UpdatePageRequest[] = []
  return {
    updates,
    updatePage: vi.fn(async (request: UpdatePageRequest) => {
      updates.push(request)
      return { ...PAGE, label: request.label ?? PAGE.label }
    }),
    removePage: vi.fn(async () => ({ id: PAGE.id, status: 'removed' as const })),
    pinPage: vi.fn(async () => ({}) as never),
    unpinPage: vi.fn(async () => ({}) as never),
    listPrompts: vi.fn(
      async () =>
        ({
          prompts: [{ enabled: true }, { enabled: true }, { enabled: false }]
        }) as unknown as PromptSetView
    )
  }
}

function renderDrawer(
  client: PageSettingsClient,
  extra: Partial<Parameters<typeof PageSettingsDrawer>[0]> = {}
): ReturnType<typeof render> {
  return render(
    <>
      <PageSettingsDrawer
        client={client}
        projectId="textbolt"
        page={PAGE}
        section={null}
        onClose={() => undefined}
        onChanged={() => undefined}
        onPinsChanged={() => undefined}
        navigate={() => undefined}
        afterRemoveHash="#/pages"
        {...extra}
      />
      <UndoToastHost />
    </>
  )
}

describe('page settings model', () => {
  it('sends only what changed, and checks the URL', () => {
    const form = formFromPage(PAGE)
    expect(changesFor(PAGE, form, 'textbolt')).toBeNull()
    expect(
      changesFor(PAGE, { ...form, label: '  ', samples: 3, defaultMarketId: UK.id }, 'textbolt')
    ).toEqual({
      projectId: 'textbolt',
      pageId: PAGE.id,
      label: null,
      samples: 3,
      defaultMarketId: UK.id
    })
    expect(urlProblem('textbolt.com/x', false)).toMatch(/https/)
    expect(urlProblem('', true)).toBeNull()
    expect(searchesPerCheck(4, 2, 3)).toEqual({ min: 24, max: 48 })
  })
})

describe('PageSettingsDrawer', () => {
  it('saves label, interval, samples and the default market in one update', async () => {
    const client = fakeClient()
    const onClose = vi.fn()
    const onChanged = vi.fn()
    renderDrawer(client, { onClose, onChanged })
    const dialog = screen.getByRole('dialog', { name: 'Page settings' })
    // 2 enabled questions × 1 sample × 2 markets.
    await waitFor(() =>
      expect(within(dialog).getByTestId('pset-cost').textContent).toContain('2 questions')
    )
    const save = within(dialog).getByRole('button', { name: 'Save settings' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Label'), {
      target: { value: 'Alerts for crews' }
    })
    fireEvent.change(within(dialog).getByLabelText('Check every'), { target: { value: '30' } })
    fireEvent.change(within(dialog).getByLabelText('Samples per question'), {
      target: { value: '2' }
    })
    fireEvent.click(within(dialog).getByRole('radio', { name: /GB/ }))
    expect(within(dialog).getByTestId('pset-cost').textContent).toContain('About 8–16 searches')
    await act(async () => {
      fireEvent.click(save)
    })
    expect(client.updates).toEqual([
      {
        projectId: 'textbolt',
        pageId: PAGE.id,
        label: 'Alerts for crews',
        intervalDays: 30,
        samples: 2,
        defaultMarketId: UK.id
      }
    ])
    expect(onChanged).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByText(/Saved the page settings/)).toBeTruthy()
  })

  it('refuses a bad URL before saving', () => {
    renderDrawer(fakeClient())
    const dialog = screen.getByRole('dialog', { name: 'Page settings' })
    fireEvent.change(within(dialog).getByLabelText('Page address'), {
      target: { value: 'not a url' }
    })
    expect(within(dialog).getByText(/starts with https/)).toBeTruthy()
    expect(
      (within(dialog).getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('pauses at once with Undo, and removes after Confirm with Undo', async () => {
    const client = fakeClient()
    const navigate = vi.fn()
    renderDrawer(client, { navigate })
    const dialog = screen.getByRole('dialog', { name: 'Page settings' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Pause checks' }))
    })
    expect(client.updates.at(-1)).toEqual({
      projectId: 'textbolt',
      pageId: PAGE.id,
      status: 'paused'
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(client.updates.at(-1)?.status).toBe('tracked')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove page' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Remove Text alerts?' })
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove page' }))
    })
    expect(client.removePage).toHaveBeenCalledWith({ projectId: 'textbolt', pageId: PAGE.id })
    expect(navigate).toHaveBeenCalledWith('#/pages')
    expect(screen.getByText(/Removed Text alerts/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    })
    expect(client.updates.at(-1)).toEqual({
      projectId: 'textbolt',
      pageId: PAGE.id,
      status: 'tracked'
    })
    expect(navigate).toHaveBeenLastCalledWith('#/pages/page-1/results')
  })

  it('focuses the section a header chip opened', () => {
    renderDrawer(fakeClient(), { section: 'schedule' })
    expect(document.activeElement).toBe(screen.getByLabelText('Check every'))
  })
})
