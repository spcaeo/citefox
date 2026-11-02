// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineId } from '@shared/domain'
import type { EngineSummaryView, QuestionEngineStatuses } from '@shared/ipc'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { resetSuggestCache } from './hooks/useSuggestTopics'
import { TopicsScreen } from './TopicsScreen'
import { fakeTopicsSource, topicsList, topicsSummaries } from './topics.fixtures.test-helper'

/** The Topics screen's engine filter (audit #4): every view's toolbar spot and the re-count. */

const GATEWAY = 'https://textbolt.com/email-to-text/'

function answer(
  promptId: string,
  chatgpt: QuestionEngineStatuses['statuses']['chatgpt'],
  ownUrls?: string[]
): QuestionEngineStatuses {
  return {
    pageId: promptId.startsWith('a') ? 'topic-a' : 'topic-b',
    promptId,
    marketId: 'm-us',
    statuses: { ...(chatgpt ? { chatgpt } : {}) },
    ...(ownUrls ? { ownUrls: { chatgpt: ownUrls } } : {})
  }
}

function renderTopics(engines: EngineId[], view = 'tree'): ReturnType<typeof render> {
  window.history.replaceState(null, '', `#/topics?view=${view}`)
  const source = {
    ...fakeTopicsSource(topicsList(), topicsSummaries(), []),
    'engines:summary': async (): Promise<EngineSummaryView> => {
      return {
        projectId: 'proj-1',
        engines,
        counts: [],
        questions: [
          // ChatGPT cites a1's target page, a2 from the pricing page; names you for a3.
          answer('a1', 'cited', [GATEWAY]),
          answer('a2', 'cited', ['https://textbolt.com/pricing/']),
          answer('a3', 'named'),
          answer('a4', 'no_answer'),
          answer('b1', 'not_cited')
        ]
      }
    }
  }
  return render(<TopicsScreen projectId="proj-1" source={source} viewStore={null} />)
}

beforeEach(resetSuggestCache)
afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

describe('Topics engine filter', () => {
  it('re-counts the headline from the picked engine, kept in the URL', async () => {
    const view = renderTopics(['google_aio', 'chatgpt'])
    const filter = await view.findByRole('group', { name: 'Engine' })
    expect(filter.closest('.ui-lg-bar')).not.toBeNull()
    fireEvent.click(within(filter).getByRole('button', { name: 'ChatGPT' }))
    await waitFor(() => expect(window.location.hash).toContain('engine=chatgpt'))
    // 1 target page cited (a1) of 4 answered searches (a1, a2, a3, b1).
    const kpis = view.getByRole('region', { name: 'Topics summary' })
    await waitFor(() => expect(within(kpis).getByText('25%')).toBeTruthy())
    expect(within(kpis).getByText(/searches ChatGPT answered/)).toBeTruthy()
    // A topic's links keep the engine.
    const tree = view.getByRole('grid', { name: 'All topics' })
    const links = [...tree.querySelectorAll<HTMLAnchorElement>('a[href^="#/topics/"]')]
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link.getAttribute('href')).toContain('engine=chatgpt')
  })

  it('holds the same spot in the Grid and the List', async () => {
    const grid = renderTopics(['google_aio', 'chatgpt'], 'grid')
    expect(await grid.findByRole('group', { name: 'Engine' })).toBeTruthy()
    cleanup()
    const list = renderTopics(['google_aio', 'chatgpt'], 'list')
    const filter = await list.findByRole('group', { name: 'Engine' })
    expect(filter.closest('.ui-lg-bar')).not.toBeNull()
  })

  it('one engine: one fixed logo', async () => {
    const view = renderTopics(['google_aio'])
    expect(await view.findByRole('img', { name: 'Google AI Overview only' })).toBeTruthy()
    expect(view.queryByRole('group', { name: 'Engine' })).toBeNull()
  })
})
