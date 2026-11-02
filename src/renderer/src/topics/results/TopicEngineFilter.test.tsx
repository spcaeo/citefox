// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { EngineId } from '@shared/domain'
import type { EngineSummaryView, TopicResultsRequest } from '@shared/ipc'
import { TEXTBOLT_TOPIC_PROJECT_ID } from '@shared/fixtures/textbolt-topic'
import { DrillHost } from '../../drill'
import { ATT_TOPIC_ID, attTopicResults } from '../views/fixtures.test-helper'
import { TopicResultsScreen } from '.'
import { createMockTopicResultsSource } from './source/mock'

/** The topic page's engine filter (audit #4): the toolbar spot, the URL, and the re-read. */

afterEach(cleanup)

function summary(engines: EngineId[]): EngineSummaryView {
  return {
    projectId: TEXTBOLT_TOPIC_PROJECT_ID,
    engines,
    counts: engines.map((engine) => ({
      engine,
      label: engine,
      checked: 1,
      cited: 0,
      named: 0,
      notCited: 1,
      noAnswer: 0,
      unavailable: 0,
      error: 0,
      gained: 0,
      lost: 0,
      lastCheckedAt: null
    })),
    questions: []
  }
}

function renderTopic(
  engines: EngineId[],
  view = 'tree'
): {
  view: ReturnType<typeof render>
  results: ReturnType<typeof vi.fn>
} {
  const google = attTopicResults()
  // ChatGPT's answers: nothing cited, so every answered search needs work.
  const chatgpt = {
    ...google,
    rows: google.rows.map((row) =>
      row.state === 'right_page' || row.state === 'other_page'
        ? { ...row, state: 'not_cited' as const }
        : row
    )
  }
  const results = vi.fn(async (request: TopicResultsRequest) =>
    request.engine === 'chatgpt' ? chatgpt : google
  )
  const source = {
    ...createMockTopicResultsSource(),
    results,
    engineSummary: async () => summary(engines)
  }
  window.location.hash = `#/topics/${ATT_TOPIC_ID}?view=${view}`
  return {
    view: render(
      <DrillHost>
        <TopicResultsScreen
          projectId={TEXTBOLT_TOPIC_PROJECT_ID}
          projectName="TextBolt"
          topicId={ATT_TOPIC_ID}
          source={source}
          viewStore={null}
        />
      </DrillHost>
    ),
    results
  }
}

describe('the topic page engine filter', () => {
  test('two engines: the filter in the toolbar re-reads the topic, in the URL', async () => {
    const { view, results } = renderTopic(['google_aio', 'chatgpt'])
    const filter = await view.findByRole('group', { name: 'Engine' })
    expect(filter.closest('.ui-lg-bar')).not.toBeNull()
    expect(results).toHaveBeenLastCalledWith(expect.not.objectContaining({ engine: 'chatgpt' }))
    fireEvent.click(within(filter).getByRole('button', { name: 'ChatGPT' }))
    await waitFor(() => expect(window.location.hash).toContain('engine=chatgpt'))
    await waitFor(() =>
      expect(results).toHaveBeenLastCalledWith(expect.objectContaining({ engine: 'chatgpt' }))
    )
    // Every count's drill link keeps the engine.
    await waitFor(() => {
      const links = [...view.container.querySelectorAll<HTMLAnchorElement>('a[href*="result="]')]
      expect(links.length).toBeGreaterThan(0)
      for (const link of links) expect(link.getAttribute('href')).toContain('engine=chatgpt')
    })
    expect(view.getAllByText(/page(s)? cited: 0%/).length).toBeGreaterThan(0)
  })

  test('the Grid and Pages views hold the same spot', async () => {
    const grid = renderTopic(['google_aio', 'chatgpt'], 'grid')
    expect(await grid.view.findByRole('group', { name: 'Engine' })).toBeTruthy()
    cleanup()
    const pages = renderTopic(['google_aio', 'chatgpt'], 'pages')
    const filter = await pages.view.findByRole('group', { name: 'Engine' })
    expect(filter.closest('.ui-filterbar')).not.toBeNull()
  })

  test('ChatGPT picked: every view says "No answer", never "No AI Overview"', async () => {
    for (const view of ['tree', 'grid', 'list', 'pages']) {
      const google = renderTopic(['google_aio', 'chatgpt'], view)
      // The Tree starts closed; open it to read every row.
      if (view === 'tree')
        fireEvent.click(await google.view.findByRole('button', { name: 'Expand all' }))
      // Google first: the fixture's Q3 has no AI Overview.
      await waitFor(() => expect(google.view.container.textContent).toContain('No AI Overview'))
      const filter = await google.view.findByRole('group', { name: 'Engine' })
      fireEvent.click(within(filter).getByRole('button', { name: 'ChatGPT' }))
      await waitFor(() =>
        expect(google.results).toHaveBeenLastCalledWith(
          expect.objectContaining({ engine: 'chatgpt' })
        )
      )
      await waitFor(() => expect(google.view.container.textContent).toMatch(/No answer/i))
      // The engine filter's own "Google AI Overview" button is the one name allowed.
      const strip = (text: string | null): string =>
        (text ?? '').split('Google AI Overview').join('')
      const page = google.view.container
      expect(strip(page.textContent)).not.toMatch(/AI Overview/)
      for (const named of page.querySelectorAll('[aria-label], [title]')) {
        const text = `${named.getAttribute('aria-label') ?? ''} ${named.getAttribute('title') ?? ''}`
        expect(strip(text)).not.toMatch(/AI Overview/)
      }
      cleanup()
    }
  })

  test('one engine: one fixed logo, and Google’s results', async () => {
    const { view, results } = renderTopic(['google_aio'])
    expect(await view.findByRole('img', { name: 'Google AI Overview only' })).toBeTruthy()
    expect(view.queryByRole('group', { name: 'Engine' })).toBeNull()
    expect(results).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ engine: expect.anything() })
    )
  })
})
