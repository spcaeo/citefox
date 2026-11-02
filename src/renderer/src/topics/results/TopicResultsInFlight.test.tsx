// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CheckInFlightItem, CheckProgress, TopicResults } from '@shared/ipc'
import {
  TEXTBOLT_TOPIC_ID,
  TEXTBOLT_TOPIC_PROJECT_ID,
  textboltTopicResults
} from '@shared/fixtures/textbolt-topic'
import { topicGoal } from '@shared/topic-scoring'
import { DrillHost } from '../../drill'
import { TopicResultsScreen } from '.'
import { createMockTopicResultsSource } from './source/mock'

/**
 * The topic page names the questions a running check is on (owner, 2026-10-29: "if
 * there are three processes, why don't we show these three processes?"): "checking Q7,
 * Q8, Q9 now" in the live line, each a link to its row, and the rows say which engines
 * they still wait on.
 */

/** Questions 1–6 answered; 7, 8 and 9 being checked; the rest waiting. */
function running(): TopicResults {
  const base = textboltTopicResults()
  const rows = base.rows.map((row) => {
    if (row.kind !== 'question' || row.number <= 6) return row
    return {
      ...row,
      state: 'not_checked' as const,
      live: row.number <= 9 ? ('checking' as const) : ('waiting' as const),
      runId: null,
      checkedAt: null,
      winOdds: null,
      citedOwnUrl: null,
      citedInstead: [],
      position: null,
      named: null
    }
  })
  const questions = rows.filter((row) => row.kind === 'question').length
  return {
    ...base,
    rows,
    goals: {
      questions: topicGoal(rows, 'question', base.topic.bands.questions),
      keywords: topicGoal(rows, 'keyword', base.topic.bands.keywords)
    },
    live: {
      state: 'running',
      jobId: 'job-1',
      done: 6,
      total: questions,
      questions: { done: 6, total: questions },
      keywords: { done: 0, total: 0 },
      startedAt: '2026-10-29T08:00:00.000Z',
      endedAt: null
    }
  }
}

const progressListeners = new Set<(event: CheckProgress) => void>()

function progress(jobId: string, items: readonly CheckInFlightItem[]): void {
  const results = running()
  act(() => {
    for (const listener of progressListeners) {
      listener({
        jobId,
        projectId: TEXTBOLT_TOPIC_PROJECT_ID,
        pageId: TEXTBOLT_TOPIC_ID,
        marketId: results.topic.marketId,
        promptId: null,
        sampleNo: 1,
        phase: 'search',
        state: 'running',
        detail: 'Searching ChatGPT',
        nextStep: null,
        errorCode: null,
        retrySearches: 0,
        done: 6,
        total: 12,
        searchesUsed: 6,
        searchesMax: 60,
        monthUsed: null,
        monthLimit: null,
        markets: [],
        inFlight: items.length,
        inFlightItems: items
      })
    }
  })
}

function item(number: number, google: boolean, chatgpt: boolean): CheckInFlightItem {
  const results = running()
  const row = results.rows.find((entry) => entry.kind === 'question' && entry.number === number)
  return {
    pageId: TEXTBOLT_TOPIC_ID,
    marketId: results.topic.marketId,
    promptId: row?.promptId ?? '',
    kind: 'question',
    number,
    stage: row?.stage ?? null,
    text: row?.text ?? '',
    engines: [
      { engine: 'google_aio', status: google ? 'not_cited' : null },
      { engine: 'chatgpt', status: chatgpt ? 'cited' : null }
    ],
    startedAt: '2026-10-29T08:01:00.000Z'
  }
}

function renderScreen(): ReturnType<typeof render> {
  const source = {
    ...createMockTopicResultsSource(),
    results: async () => running(),
    onCheckProgress: (listener: (event: CheckProgress) => void) => {
      progressListeners.add(listener)
      return () => progressListeners.delete(listener)
    }
  }
  return render(
    <DrillHost>
      <TopicResultsScreen
        projectId={TEXTBOLT_TOPIC_PROJECT_ID}
        projectName="TextBolt"
        topicId={TEXTBOLT_TOPIC_ID}
        source={source}
        viewStore={null}
      />
    </DrillHost>
  )
}

beforeEach(() => {
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}?view=list&type=question`
  ;(window as unknown as { citefox: unknown }).citefox = {
    'results:changed': () => () => undefined
  }
})

afterEach(() => {
  cleanup()
  progressListeners.clear()
  vi.restoreAllMocks()
  delete (window as unknown as { citefox?: unknown }).citefox
})

describe('topic page names the running questions', () => {
  test('"checking Q7, Q8, Q9 now", and each row says which engines it waits on', async () => {
    const view = renderScreen()
    const line = await view.findByText(/^Checking… 6 of/u)
    // Before the first push, from the rows marked as checking.
    expect(line.closest('p')?.textContent).toBe('Checking… 6 of 28 done · checking Q7, Q8, Q9 now')

    progress('job-1', [item(7, false, false), item(8, true, false), item(9, true, true)])
    const todo = await view.findByRole('grid', { name: /every search/ })
    await vi.waitFor(() =>
      expect(within(todo).getAllByTitle('Checking Google · ChatGPT…').length).toBeGreaterThan(0)
    )
    expect(within(todo).getAllByTitle('Checking ChatGPT…').length).toBeGreaterThan(0)
    expect(within(todo).getAllByText('Checking…').length).toBeGreaterThan(0)
    expect(within(todo).getAllByText('Waiting').length).toBeGreaterThan(0)

    // Another check's pushes change nothing here.
    progress('job-2', [item(7, true, true)])
    expect(within(todo).getAllByTitle('Checking Google · ChatGPT…').length).toBeGreaterThan(0)
  })

  test('each number is a link to its row in the List', async () => {
    window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}`
    const scrolled: Element[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this)
    })
    const view = renderScreen()
    await view.findByText(/^Checking… 6 of/u)
    progress('job-1', [item(7, false, false), item(8, true, false), item(9, true, true)])
    fireEvent.click(view.getByRole('button', { name: 'Show Q8 in the list' }))
    await vi.waitFor(() => expect(window.location.hash).toContain('view=list'))
    await view.findByRole('grid', { name: /every search/ })
    await vi.waitFor(() => expect(scrolled.length).toBeGreaterThan(0))
    const q8 = item(8, false, false).promptId
    expect(scrolled[0]?.getAttribute('data-line-key')).toBe(`row:${q8}`)
    expect(scrolled[0]?.querySelector('[title="Checking ChatGPT…"]')).toBeTruthy()
  })

  test('a finished question leaves the line at the next push', async () => {
    const view = renderScreen()
    await view.findByText(/^Checking… 6 of/u)
    progress('job-1', [item(8, true, false), item(9, true, true), item(10, false, false)])
    expect(view.getByText(/^Checking… 6 of/u).closest('p')?.textContent).toBe(
      'Checking… 6 of 28 done · checking Q8, Q9, Q10 now'
    )
  })
})
