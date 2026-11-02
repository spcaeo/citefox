// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PagePipeline, PagePipelineStep, SetupProgress } from '@shared/ipc'
import { createMockAssistClient } from '../../assist/client'
import { textboltCatalog } from '../../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../../mocks/m2/memory'
import type { ShellClient } from '../../projects/client'
import { createMockShellClient } from '../../projects/mockClient'
import { createMockTemplatesClient } from '../../templates/client'
import { axeViolations } from '../../ui/axe.test-helper'
import { GapsScreen } from '../GapsScreen'
import type { PipelineSource } from '../pipeline'

afterEach(cleanup)
beforeEach(() => {
  window.location.hash = ''
})

type StepStates = Readonly<Record<PagePipelineStep['id'], PagePipelineStep['state']>>

function pipeline(state: PagePipeline['state'], steps: StepStates): PagePipeline {
  return {
    projectId: 'textbolt',
    pageId: 'alerts',
    state,
    message:
      state === 'running'
        ? 'CiteFox AI is comparing each question with the page for content gaps.'
        : 'Set up. Review the questions, then start the first check when you are ready.',
    steps: (Object.keys(steps) as PagePipelineStep['id'][]).map((id) => ({
      id,
      label: id,
      state: steps[id],
      detail: null
    })),
    startedAt: '2026-10-22T10:00:00.000Z',
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
    checkAsked: false
  }
}

const COVERAGE_RUNNING = pipeline('running', {
  read: 'done',
  profile: 'done',
  prompts: 'done',
  coverage: 'running',
  ready: 'todo'
})
const READY_NO_GAPS = pipeline('ready', {
  read: 'done',
  profile: 'done',
  prompts: 'done',
  coverage: 'todo',
  ready: 'done'
})
const READY = pipeline('ready', {
  read: 'done',
  profile: 'done',
  prompts: 'done',
  coverage: 'done',
  ready: 'done'
})

function fakeSource(
  first: PagePipeline,
  after: PagePipeline = first
): PipelineSource & { starts: number } {
  let current = first
  const listeners = new Set<(progress: SetupProgress) => void>()
  const source = {
    starts: 0,
    page: () => Promise.resolve(current),
    start: () => {
      source.starts += 1
      current = after
      return Promise.resolve(current)
    },
    stop: () => Promise.resolve(current),
    checkWhenReady: ({ on }: { on: boolean }) => Promise.resolve({ checkWhenReady: on }),
    onProgress: (listener: (progress: SetupProgress) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  return source
}

function renderGaps(
  source: PipelineSource | null,
  patch: Partial<ShellClient> = {}
): ReturnType<typeof render> & { client: ShellClient } {
  const base = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  const client: ShellClient = { ...base, ...patch }
  const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
  const view = render(
    <GapsScreen
      client={client}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page}
      marketId={page.markets[0]?.id ?? ''}
      assistClient={createMockAssistClient()}
      pipelineSource={source}
    />
  )
  return Object.assign(view, { client })
}

describe('Content gaps and automatic setup', () => {
  it('shows the live setup panel while content gaps are written, never a build button', async () => {
    const view = renderGaps(fakeSource(COVERAGE_RUNNING))
    const panel = await view.findByTestId('setup-panel')
    expect(within(panel).getByRole('heading', { name: 'Setting up this page' })).toBeTruthy()
    expect(within(panel).getByRole('list', { name: 'Setup steps' })).toBeTruthy()
    expect(
      within(panel).getByText(
        'Content gaps show here once CiteFox AI compares each question with the page.'
      )
    ).toBeTruthy()
    expect(view.queryByRole('button', { name: /Build coverage matrix/ })).toBeNull()
    expect(view.queryByRole('grid', { name: 'Coverage matrix' })).toBeNull()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a ready page with no matrix offers Write content gaps, which starts setup', async () => {
    const source = fakeSource(READY_NO_GAPS, COVERAGE_RUNNING)
    const view = renderGaps(source, { getGaps: () => Promise.resolve(null) })
    expect(
      await view.findByRole('heading', { name: 'Content gaps are not written yet' })
    ).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Write content gaps' }))
    await waitFor(() => expect(source.starts).toBe(1))
    expect(await view.findByTestId('setup-panel')).toBeTruthy()
  })

  it('the review: first-check bar as the one primary, KPI tiles, tabs and the matrix grid', async () => {
    const view = renderGaps(fakeSource(READY))
    const grid = await view.findByRole('grid', { name: 'Coverage matrix' })
    expect(view.getByTestId('first-check-bar')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Start first check · ≈10–20 searches' })).toBeTruthy()
    expect(view.container.querySelectorAll('.ui-btn-primary')).toHaveLength(1)
    expect(view.getByRole('region', { name: 'Coverage summary' })).toBeTruthy()
    const tabs = view.getByRole('tablist', { name: 'Content gaps views' })
    const names = within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent ?? '')
    expect(names[0]).toBe('Matrix10')
    expect(names[1]).toBe('One by one10')
    expect(names[2]).toMatch(/^Page-wide fixes\d+$/)
    expect(grid.querySelectorAll('.ui-lg-group').length).toBeGreaterThan(0)
    expect(
      within(grid).getAllByRole('button', { name: /^Actions for question \d+$/ })
    ).not.toHaveLength(0)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('Content gaps settings hold the template and Write content gaps again', async () => {
    const calls: string[] = []
    const base = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    const view = renderGaps(fakeSource(READY), {
      generateGaps: (request) => {
        calls.push(request.pageId)
        return base.generateGaps(request)
      }
    })
    await view.findByRole('grid', { name: 'Coverage matrix' })
    expect(view.queryByLabelText('Template')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Content gaps settings' }))
    const dialog = view.getByRole('dialog', { name: 'Content gaps settings' })
    expect(within(dialog).getByLabelText('Template')).toBeTruthy()
    expect(await axeViolations(dialog)).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Write content gaps again' }))
    await waitFor(() => expect(calls).toEqual(['alerts']))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
  })

  it('without the bridge (mock), the page’s own setup step decides and the review shows', async () => {
    const view = renderGaps(null)
    expect(await view.findByRole('grid', { name: 'Coverage matrix' })).toBeTruthy()
    expect(view.queryByTestId('setup-panel')).toBeNull()
  })
})
