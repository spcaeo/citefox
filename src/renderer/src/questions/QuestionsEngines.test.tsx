// @vitest-environment happy-dom
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineId } from '@shared/domain'
import type { EngineSummaryRequest, EngineSummaryView } from '@shared/ipc'
import { axeViolations } from '../ui/axe.test-helper'
import { resetUndoToastForTests } from '../ui/undoStore'
import { fakeSource, goTo, query, shown } from './questions.screen.test-helper'

beforeEach(() => {
  window.history.replaceState(null, '', '#/questions?group=none')
})

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

function summary(
  engines: readonly EngineId[]
): (request: EngineSummaryRequest) => Promise<EngineSummaryView> {
  return vi.fn(async (request: EngineSummaryRequest): Promise<EngineSummaryView> => ({
    projectId: request.projectId,
    engines,
    counts: engines.map((engine) => ({
      engine,
      label: engine,
      checked: 3,
      cited: 1,
      named: 0,
      notCited: 1,
      noAnswer: 0,
      unavailable: 1,
      error: 0,
      gained: 0,
      lost: 0,
      lastCheckedAt: '2026-10-20T10:00:00.000Z'
    })),
    questions: [
      {
        pageId: 'page-1',
        promptId: 'p-1',
        marketId: 'm-us',
        statuses: { google_aio: 'cited', chatgpt: 'not_cited', perplexity: 'unavailable' }
      },
      {
        pageId: 'topic-1',
        promptId: 'p-t1',
        marketId: 'm-us',
        statuses: { google_aio: 'named', chatgpt: 'cited', perplexity: 'unavailable' }
      },
      {
        pageId: 'page-1',
        promptId: 'p-2',
        marketId: 'm-us',
        statuses: { google_aio: 'no_answer', chatgpt: 'named', perplexity: 'unavailable' }
      }
    ]
  }))
}

describe('Questions engine filter', () => {
  it('shows no filter and no dots when the project checks Google AI Overview only', async () => {
    const source = { ...fakeSource(), 'engines:summary': summary(['google_aio']) }
    const { view } = await shown(source)
    await waitFor(() => expect(source['engines:summary']).toHaveBeenCalled())
    expect(view.queryByRole('group', { name: 'Engine' })).toBeNull()
    expect(view.queryByRole('columnheader', { name: /Engines/ })).toBeNull()
    expect(view.getByRole('columnheader', { name: /You/ })).toBeTruthy()
  })

  it('adds a dot per engine under All, asked per page in the list market', async () => {
    const channel = summary(['google_aio', 'chatgpt', 'perplexity'])
    const { view } = await shown({ ...fakeSource(), 'engines:summary': channel })
    await view.findByRole('group', { name: 'Engine' })
    expect(channel).toHaveBeenCalledWith({
      projectId: 'proj-1',
      marketId: 'm-us',
      pageIds: ['topic-1', 'page-1'],
      perQuestion: true
    })
    expect(view.getByRole('columnheader', { name: /Engines/ })).toBeTruthy()
    // Today's columns stay under All.
    expect(view.getByRole('columnheader', { name: /You/ })).toBeTruthy()
    expect(view.getByRole('columnheader', { name: /Change/ })).toBeTruthy()
    expect(
      view.getByRole('img', {
        name: 'Google AI Overview: Cited; ChatGPT: Not cited; Perplexity: Unavailable'
      })
    ).toBeTruthy()
    expect(view.getByRole('list', { name: 'What the engine dots mean' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('keeps one engine in the URL, its numbers and status column follow, Back returns', async () => {
    const { view } = await shown({
      ...fakeSource(),
      'engines:summary': summary(['google_aio', 'chatgpt', 'perplexity'])
    })
    const filter = await view.findByRole('group', { name: 'Engine' })
    fireEvent.click(within(filter).getByRole('button', { name: 'ChatGPT' }))
    expect(query().get('engine')).toBe('chatgpt')
    await view.findByRole('region', { name: 'Questions summary on ChatGPT' })
    const kpis = view.getByRole('region', { name: 'Questions summary on ChatGPT' })
    expect(within(kpis).getByRole('region', { name: 'ChatGPT answered' }).textContent).toContain(
      '3'
    )
    expect(within(kpis).getByRole('region', { name: 'Cited' }).textContent).toContain('1 of 3')
    expect(view.getByRole('columnheader', { name: /ChatGPT/ })).toBeTruthy()
    expect(view.queryByRole('columnheader', { name: /Change/ })).toBeNull()
    expect(view.queryByRole('columnheader', { name: /Engines/ })).toBeNull()
    // Result and Change filter Google's results, so they leave with it.
    fireEvent.click(view.getByRole('button', { name: 'Filter' }))
    expect(view.queryByRole('menuitemradio', { name: /^Result: / })).toBeNull()
    expect(view.queryByRole('menuitemradio', { name: /^Change: / })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Filter' }))
    const grid = view.getByRole('grid', { name: 'Questions' })
    expect(within(grid).getByText('Named, not cited')).toBeTruthy()

    goTo('#/questions?group=none')
    await view.findByRole('region', { name: 'Questions summary' })
    expect(view.getByRole('columnheader', { name: /Engines/ })).toBeTruthy()
  })

  it('opens a row on the picked engine tab', async () => {
    window.history.replaceState(null, '', '#/questions?group=none&engine=chatgpt')
    const { view } = await shown({
      ...fakeSource(),
      'engines:summary': summary(['google_aio', 'chatgpt'])
    })
    await view.findByRole('region', { name: 'Questions summary on ChatGPT' })
    fireEvent.click(view.getByText('cheapest SMS API for startups'))
    expect(window.location.hash).toBe('#/pages/page-1/prompt/p-2?market=m-us&run=run-b&eng=chatgpt')
  })

  it('shows Google AI Overview exactly as today', async () => {
    window.history.replaceState(null, '', '#/questions?group=none&engine=google_aio')
    const { view } = await shown({
      ...fakeSource(),
      'engines:summary': summary(['google_aio', 'chatgpt'])
    })
    await view.findByRole('group', { name: 'Engine' })
    expect(view.getByRole('region', { name: 'Questions summary' })).toBeTruthy()
    expect(view.queryByRole('columnheader', { name: /Engines/ })).toBeNull()
    expect(view.queryByRole('list', { name: 'What the engine dots mean' })).toBeNull()
  })
})
