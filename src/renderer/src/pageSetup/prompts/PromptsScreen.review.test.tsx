// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageDetail, PagePipeline, SetupProgress } from '@shared/ipc'
import { takeCheckStart } from '../../m3/startIntent'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../../mocks/m2/memory'
import { CLIENT_MODE_STORAGE_KEY } from '../../onboarding/flags'
import { createMockShellClient } from '../../projects/mockClient'
import { createMockTemplatesClient } from '../../templates/client'
import { axeViolations } from '../../ui/axe.test-helper'
import type { PipelineSource } from '../pipeline'
import { PromptsScreen } from '../PromptsScreen'

afterEach(() => {
  cleanup()
  localStorage.removeItem(CLIENT_MODE_STORAGE_KEY)
  window.location.hash = ''
})

function page(pageId = 'alerts'): PageDetail {
  return createProjectMemory(textboltCatalog()).getPage('textbolt', pageId)
}

function pipeline(patch: Partial<PagePipeline> = {}): PagePipeline {
  return {
    projectId: 'textbolt',
    pageId: 'alerts',
    state: 'ready',
    message: 'Set up. Review the questions, then start the first check when you are ready.',
    steps: [
      { id: 'read', label: 'Read page', state: 'done', detail: '4,860 words' },
      { id: 'profile', label: 'Buyer profile', state: 'done', detail: '4 segments' },
      { id: 'prompts', label: 'Questions', state: 'done', detail: '10 questions' },
      { id: 'coverage', label: 'Content gaps', state: 'done', detail: '3 gaps' },
      { id: 'ready', label: 'Ready', state: 'done', detail: 'Ready to check' }
    ],
    startedAt: new Date(Date.now() - 42_000).toISOString(),
    finishedAt: null,
    retryAt: null,
    attempts: 0,
    error: null,
    action: null,
    prompts: 10,
    markets: 1,
    samples: 1,
    searchesMin: 10,
    searchesMax: 20,
    firstCheckWaits: true,
    checkWhenReady: false,
    checkAsked: false,
    ...patch
  }
}

function source(
  current: () => PagePipeline
): PipelineSource & { started: number; saved: boolean[] } {
  const fake = {
    started: 0,
    saved: [] as boolean[],
    page: async () => current(),
    start: async () => {
      fake.started += 1
      return current()
    },
    stop: async () => current(),
    checkWhenReady: async (request: { on: boolean }) => {
      fake.saved.push(request.on)
      return { checkWhenReady: request.on }
    },
    onProgress: (listener: (progress: SetupProgress) => void) => {
      void listener
      return () => undefined
    }
  }
  return fake
}

function screen(
  pipelineSource: PipelineSource,
  filter: string | null = null
): {
  view: ReturnType<typeof render>
  rerender: (next: string | null) => void
} {
  localStorage.setItem(CLIENT_MODE_STORAGE_KEY, 'mock')
  const client = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  const element = (value: string | null): JSX.Element => (
    <PromptsScreen
      client={client}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page()}
      marketId="us"
      filter={value}
      onChanged={() => undefined}
      pipelineSource={pipelineSource}
    />
  )
  const view = render(element(filter))
  return { view, rerender: (next) => view.rerender(element(next)) }
}

describe('Questions tab: automatic setup and review', () => {
  it('shows the live setup panel while CiteFox AI writes the questions, never a manual step', async () => {
    const running = pipeline({
      state: 'running',
      message: 'CiteFox AI is writing the buyer questions from the buyer profile.',
      steps: [
        { id: 'read', label: 'Read page', state: 'done', detail: '4,860 words' },
        { id: 'profile', label: 'Buyer profile', state: 'done', detail: '4 segments' },
        { id: 'prompts', label: 'Questions', state: 'running', detail: null },
        { id: 'coverage', label: 'Content gaps', state: 'todo', detail: null },
        { id: 'ready', label: 'Ready', state: 'todo', detail: null }
      ]
    })
    const { view } = screen(source(() => running))
    const panel = await view.findByRole('region', { name: 'Setting up this page' })
    const steps = within(panel).getByRole('list', { name: 'Setup steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5)
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('Questions')
    expect(within(panel).getByRole('status').textContent).toContain('writing the buyer questions')
    expect(within(panel).getByText(/\d+ s$/)).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(view.queryByText(/before the questions/)).toBeNull()
    expect(view.queryByRole('button', { name: 'Generate questions' })).toBeNull()
    expect(view.queryByRole('grid')).toBeNull()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a failed step offers its one action', async () => {
    const failed = pipeline({
      state: 'failed',
      message: 'CiteFox could not read this page.',
      error: 'CiteFox could not read this page.',
      action: { kind: 'retry', label: 'Retry' },
      steps: [
        { id: 'read', label: 'Read page', state: 'failed', detail: null },
        { id: 'profile', label: 'Buyer profile', state: 'todo', detail: null },
        { id: 'prompts', label: 'Questions', state: 'todo', detail: null },
        { id: 'coverage', label: 'Content gaps', state: 'todo', detail: null },
        { id: 'ready', label: 'Ready', state: 'todo', detail: null }
      ]
    })
    const fake = source(() => failed)
    const { view } = screen(fake)
    const panel = await view.findByRole('region', { name: 'Setup needs you' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fake.started).toBe(1))
    const connections = pipeline({
      ...failed,
      action: { kind: 'connections', label: 'Fix in Connections' }
    })
    cleanup()
    const second = screen(source(() => connections))
    const link = await second.view.findByRole('link', { name: 'Fix in Connections' })
    expect(link.getAttribute('href')).toBe('#/connections')
  })

  it('review: the questions grid, the profile rail and ONE primary, Start first check', async () => {
    const fake = source(() => pipeline())
    const { view } = screen(fake)
    const grid = await view.findByRole('grid', { name: 'Buyer questions' })
    await waitFor(() => expect(grid.querySelectorAll('.ui-lg-row').length).toBe(10))
    expect(
      within(view.getByRole('region', { name: 'About these questions' })).getByText('Written for')
    ).toBeTruthy()
    const start = view.getByRole('button', { name: 'Start first check · ≈10–20 searches' })
    expect(view.container.querySelectorAll('.ui-btn-primary, .btn-primary')).toHaveLength(1)
    expect(view.queryByText('Save question count')).toBeNull()
    expect(view.queryByLabelText('Template')).toBeNull()
    fireEvent.click(view.getByLabelText(/Check new pages in this project automatically/))
    await waitFor(() => expect(fake.saved).toEqual([true]))
    fireEvent.click(start)
    expect(window.location.hash).toBe('#/pages/alerts/running')
    expect(takeCheckStart('alerts')).toBe(true)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('prompt count and template live in the Prompt settings drawer, at its own URL', async () => {
    window.location.hash = '#/pages/alerts/prompts?market=us'
    const { view } = screen(source(() => pipeline()))
    fireEvent.click(await view.findByRole('button', { name: 'Question settings' }))
    expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us&drawer=pt-settings')
    const dialog = await within(document.body).findByRole('dialog', { name: 'Question settings' })
    expect(within(dialog).getByLabelText('Buyer questions to write')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Write the questions again' })).toBeTruthy()
    // The template is an expert option, folded until asked for.
    fireEvent.click(within(dialog).getByRole('button', { name: /Expert options/ }))
    expect(within(dialog).getByLabelText('Template')).toBeTruthy()
    expect(await axeViolations(dialog)).toEqual([])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(view.queryByRole('dialog', { name: 'Question settings' })).toBeNull()
    )
    await waitFor(() => expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us'))
  })

  it('an old ?filter= link opens its drawer, and ✕ takes the drawer off the URL', async () => {
    window.location.hash = '#/pages/alerts/prompts?market=us&filter=settings'
    const { view } = screen(
      source(() => pipeline()),
      'settings'
    )
    const dialog = await view.findByRole('dialog', { name: 'Question settings' })
    expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us&drawer=pt-settings')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Question settings' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us'))
  })

  it('Edit wording opens the Edit question drawer from the URL; unsaved wording asks first', async () => {
    const reader = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    const first = (await reader.listPrompts({ projectId: 'textbolt', pageId: 'alerts' })).prompts[0]
    if (!first) throw new Error('no question')
    window.location.hash = `#/pages/alerts/prompts?market=us&drawer=pt-edit&pt.edit=${first.id}`
    const { view } = screen(source(() => pipeline()))
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    const field = within(dialog).getByRole('textbox')
    fireEvent.change(field, { target: { value: 'A different wording for the Saturday crew' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    const ask = view.getByRole('alertdialog', { name: 'Discard changes?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(view.getByRole('dialog', { name: 'Edit question' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(view.getByRole('button', { name: 'Discard' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(view.queryByRole('dialog', { name: 'Edit question' })).toBeNull()
    expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us')
  })

  it('Add my own opens the editor; saving adds a draft and offers Save as the next version', async () => {
    window.location.hash = '#/pages/alerts/prompts?market=us'
    const { view } = screen(source(() => pipeline()))
    const grid = await view.findByRole('grid', { name: 'Buyer questions' })
    await waitFor(() => expect(grid.querySelectorAll('.ui-lg-row').length).toBe(10))
    fireEvent.click(view.getByRole('button', { name: 'Add my own' }))
    expect(window.location.hash).toContain('drawer=pt-add')
    const dialog = await within(document.body).findByRole('dialog', { name: 'Add my own question' })
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'How do I text my whole crew when a job moves, without an app?' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add question' }))
    await waitFor(() => expect(grid.querySelectorAll('.ui-lg-row').length).toBe(11))
    expect(view.getByText(/Unsaved changes\./)).toBeTruthy()
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).not.toContain('drawer='))
  })

  it('the Show filter is on the URL and Back undoes it', async () => {
    window.location.hash = '#/pages/alerts/prompts?market=us&pr.f=in'
    const { view } = screen(source(() => pipeline()))
    const show = await view.findByRole('group', { name: 'Show' })
    expect(
      within(show)
        .getByRole('button', { name: /^Included/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
    fireEvent.click(within(show).getByRole('button', { name: /^Left out/ }))
    expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us&pr.f=out')
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(window.location.hash).toBe('#/pages/alerts/prompts?market=us&pr.f=in')
    expect(
      within(view.getByRole('group', { name: 'Show' }))
        .getByRole('button', { name: /^Included/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
  })
})
