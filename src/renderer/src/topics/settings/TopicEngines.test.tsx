// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLORO_CREDITS, ENGINE_IDS, ENGINE_LABEL, type EngineId } from '@shared/domain'
import type { PageEnginesView, ProjectEnginesView, SetPageEnginesRequest } from '@shared/ipc'
import { topicSummary } from '../../questions/questions.fixtures.test-helper'
import type { PageEnginesSource } from '../../projectSettings/track/source'
import { UndoToastHost } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { TopicSettingsDrawer, type TopicSettingsSource } from './TopicSettingsDrawer'

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

const TOPIC = topicSummary({ id: 'topic-a', name: 'Gateway shutdowns', intervalDays: 14 })

function topics(): TopicSettingsSource {
  return {
    'topics:list': vi.fn(async () => ({ topics: [TOPIC] })),
    'topics:update': vi.fn(async () => TOPIC),
    'topics:duplicate': vi.fn(async () => {
      throw new Error('not used')
    }),
    'topics:merge': vi.fn(async () => {
      throw new Error('not used')
    })
  }
}

const PROJECT: ProjectEnginesView = {
  projectId: 'proj-1',
  engines: ['google_aio', 'chatgpt'],
  provider: 'cloro',
  activeProvider: 'cloro',
  cloroReady: true,
  serpapiReady: true,
  options: ENGINE_IDS.map((id) => ({
    id,
    label: ENGINE_LABEL[id],
    credits: CLORO_CREDITS[id],
    needsCloro: id !== 'google_aio',
    runnable: true
  })),
  overrides: 0,
  updatedAt: null
}

function engines(own: readonly EngineId[] | null): {
  source: PageEnginesSource
  setPage: ReturnType<typeof vi.fn>
} {
  let page: PageEnginesView = {
    projectId: 'proj-1',
    pageId: 'topic-a',
    kind: 'topic',
    engines: own ?? PROJECT.engines,
    own,
    projectEngines: PROJECT.engines
  }
  const setPage = vi.fn(async (request: SetPageEnginesRequest) => {
    const next = request.engines === null ? null : [...request.engines]
    page = { ...page, own: next, engines: next ?? PROJECT.engines }
    return page
  })
  const source: PageEnginesSource = {
    'engines:page': async () => page,
    'engines:setPage': setPage,
    'engines:get': async () => PROJECT,
    'engines:estimate': async (request) => ({
      projectId: 'proj-1',
      provider: 'cloro',
      cloroReady: true,
      pages: 1,
      questions: 6,
      perCheck: {
        searches: 6 * (request.engines?.length ?? 1),
        credits: 42 * (request.engines?.length ?? 1),
        costMicros: 33_600 * (request.engines?.length ?? 1)
      },
      perMonth: { searches: 0, credits: 0, costMicros: 0 },
      byEngine: [],
      plans: [],
      skipped: []
    })
  }
  return { source, setPage }
}

function shown(
  source: PageEnginesSource,
  onClose = vi.fn()
): { view: ReturnType<typeof render>; onClose: ReturnType<typeof vi.fn> } {
  const view = render(
    <>
      <TopicSettingsDrawer
        projectId="proj-1"
        topicId="topic-a"
        source={topics()}
        engines={source}
        onClose={onClose}
        onDeleted={vi.fn()}
        onDuplicated={vi.fn()}
      />
      <UndoToastHost />
    </>
  )
  return { view, onClose }
}

describe('A topic’s own engines (topic settings drawer)', () => {
  it('follows the project until it picks its own; Save writes them, Undo puts them back', async () => {
    const { source, setPage } = engines(null)
    const { view, onClose } = shown(source)
    const section = await view.findByTestId('topic-engines')
    await within(section).findByText(/Now: Google AI Overview, ChatGPT\./)
    await within(section).findByText(/One check of this topic: 84 credits/)

    fireEvent.click(within(section).getByRole('button', { name: 'Its own' }))
    const gemini = within(section).getByRole('checkbox', { name: /^Gemini/ })
    fireEvent.click(gemini)
    await within(section).findByText(/One check of this topic: 126 credits/)
    expect(await axeViolations(section)).toEqual([])

    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(setPage).toHaveBeenCalledWith({
      projectId: 'proj-1',
      pageId: 'topic-a',
      engines: ['google_aio', 'chatgpt', 'gemini']
    })
    fireEvent.click(await view.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(setPage).toHaveBeenLastCalledWith({
        projectId: 'proj-1',
        pageId: 'topic-a',
        engines: null
      })
    )
  })

  it('no engine ticked cannot be saved; back to the project clears its own', async () => {
    const { source, setPage } = engines(['chatgpt'])
    const { view } = shown(source)
    const section = await view.findByTestId('topic-engines')
    const chatgpt = await within(section).findByRole('checkbox', { name: /^ChatGPT/ })
    fireEvent.click(chatgpt)
    await within(section).findByText('Tick at least one engine.')
    expect(view.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)

    fireEvent.click(within(section).getByRole('button', { name: 'Same as the project' }))
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(setPage).toHaveBeenCalledWith({
        projectId: 'proj-1',
        pageId: 'topic-a',
        engines: null
      })
    )
  })
})
