// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PagePipeline } from '@shared/ipc'
import { emitLocalAssistProgress, resetAssistProgressForTests } from '../../assist/progress'
import { axeViolations } from '../../ui/axe.test-helper'
import { elapsedLabel, retryLabel, searchesLabel } from './model'
import { SetupPanel } from './SetupPanel'

afterEach(() => {
  cleanup()
  resetAssistProgressForTests()
})

function running(patch: Partial<PagePipeline> = {}): PagePipeline {
  return {
    projectId: 'p1',
    pageId: 'page-1',
    state: 'running',
    message: 'CiteFox AI is writing the buyer profile from the page.',
    steps: [
      { id: 'read', label: 'Read page', state: 'done', detail: '4,860 words' },
      { id: 'profile', label: 'Buyer profile', state: 'running', detail: null },
      { id: 'prompts', label: 'Questions', state: 'todo', detail: null },
      { id: 'coverage', label: 'Content gaps', state: 'todo', detail: null },
      { id: 'ready', label: 'Ready', state: 'todo', detail: null }
    ],
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    finishedAt: null,
    retryAt: null,
    attempts: 0,
    error: null,
    action: null,
    prompts: 0,
    markets: 1,
    samples: 1,
    searchesMin: 0,
    searchesMax: 0,
    firstCheckWaits: true,
    checkWhenReady: false,
    checkAsked: false,
    ...patch
  }
}

describe('SetupPanel', () => {
  it('shows the five steps, the elapsed time and Stop while a step runs', async () => {
    const onStop = vi.fn()
    const view = render(
      <SetupPanel pipeline={running()} waitingFor="profile" onStart={vi.fn()} onStop={onStop} />
    )
    const panel = view.getByRole('region', { name: 'Setting up this page' })
    const items = within(panel).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Read page'),
      expect.stringContaining('Buyer profile'),
      expect.stringContaining('Questions'),
      expect.stringContaining('Content gaps'),
      expect.stringContaining('Ready')
    ])
    expect(items[0]?.textContent).toContain('done')
    expect(items[1]?.getAttribute('aria-current')).toBe('step')
    expect(within(panel).getByText(/^1 min 0\d s$/)).toBeTruthy()
    expect(within(panel).getByText(/buyer profile shows here/)).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledOnce()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('renders the live AssistProgress steps the runner pushes for this page only', () => {
    const view = render(<SetupPanel pipeline={running()} onStart={vi.fn()} onStop={vi.fn()} />)
    act(() => {
      emitLocalAssistProgress({
        runId: 'run-1',
        channel: 'setup:run',
        scope: 'page-1',
        stepId: 's1',
        kind: 'claude',
        label: 'Asking CiteFox AI to write the buyer profile',
        state: 'running',
        detail: null,
        startedAt: Date.now(),
        endedAt: null,
        claude: null
      })
      emitLocalAssistProgress({
        runId: 'run-2',
        channel: 'setup:run',
        scope: 'other-page',
        stepId: 's1',
        kind: 'read',
        label: 'Reading another page',
        state: 'running',
        detail: null,
        startedAt: Date.now(),
        endedAt: null,
        claude: null
      })
    })
    const live = view.getByRole('region', { name: 'What CiteFox AI is doing' })
    expect(within(live).getByText('Asking CiteFox AI to write the buyer profile')).toBeTruthy()
    expect(within(live).queryByText('Reading another page')).toBeNull()
  })

  it('a stopped page offers Resume; a held page without CiteFox AI offers Fix in Connections', () => {
    const onStart = vi.fn()
    const view = render(
      <SetupPanel
        pipeline={running({ state: 'stopped', action: { kind: 'resume', label: 'Resume setup' } })}
        onStart={onStart}
        onStop={vi.fn()}
      />
    )
    expect(view.getByRole('heading', { name: 'Setup stopped' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Stop' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Resume setup' }))
    expect(onStart).toHaveBeenCalledOnce()
    cleanup()
    const held = render(
      <SetupPanel
        pipeline={running({
          state: 'held',
          message: 'Connect an AI in Connections.',
          action: { kind: 'connections', label: 'Fix in Connections' }
        })}
        onStart={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(held.getByRole('link', { name: 'Fix in Connections' }).getAttribute('href')).toBe(
      '#/connections'
    )
  })

  it('formats elapsed time, retries and the search estimate', () => {
    expect(elapsedLabel(0, 42_000)).toBe('42 s')
    expect(elapsedLabel(0, 185_000)).toBe('3 min 05 s')
    expect(elapsedLabel(0, 3_720_000)).toBe('1 h 02 min')
    expect(elapsedLabel(10_000, 0)).toBe('0 s')
    expect(retryLabel('not a date', 1)).toBe('Next try soon · attempt 2 of 4')
    expect(searchesLabel({ searchesMin: 10, searchesMax: 20 })).toBe('≈10–20 searches')
    expect(searchesLabel({ searchesMin: 0, searchesMax: 0 })).toBe('≈0 searches')
  })
})
