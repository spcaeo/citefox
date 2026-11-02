// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ResultsChanged, TopicResults } from '@shared/ipc'
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
 * Live results on the topic page (owner, 2026-10-29): while a check runs the page
 * shows the answers already saved, the questions still to come as "Waiting" or
 * "Checking…", and one calm line; it re-reads on each `results:changed`.
 */

/** The fixture as a running check sees it: the first `done` questions answered. */
function running(done: number): TopicResults {
  const base = textboltTopicResults()
  let seen = 0
  const rows = base.rows.map((row) => {
    if (row.kind !== 'question') return row
    seen += 1
    if (seen <= done) return row
    return {
      ...row,
      state: 'not_checked' as const,
      live: seen === done + 1 ? ('checking' as const) : ('waiting' as const),
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
    questionsTrend: { change: null, sinceAt: null },
    keywordsTrend: { change: null, sinceAt: null },
    live: {
      state: 'running',
      jobId: 'job-1',
      done,
      total: questions,
      questions: { done, total: questions },
      keywords: { done: 0, total: 0 },
      startedAt: '2026-10-29T08:00:00.000Z',
      endedAt: null
    }
  }
}

const listeners = new Set<(event: ResultsChanged) => void>()

function push(state: ResultsChanged['state']): void {
  act(() => {
    for (const listener of listeners) {
      listener({
        projectId: TEXTBOLT_TOPIC_PROJECT_ID,
        jobId: 'job-1',
        pageId: TEXTBOLT_TOPIC_ID,
        marketId: null,
        promptId: null,
        state,
        done: 0,
        total: 0
      })
    }
  })
}

function renderWith(reply: () => TopicResults): ReturnType<typeof render> {
  const source = { ...createMockTopicResultsSource(), results: async () => reply() }
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
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}?view=tree&type=question`
  ;(window as unknown as { citefox: unknown }).citefox = {
    'results:changed': (listener: (event: ResultsChanged) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
})

afterEach(() => {
  cleanup()
  listeners.clear()
  delete (window as unknown as { citefox?: unknown }).citefox
})

describe('topic page while a check runs', () => {
  test('shows the answers so far, the questions still to come, then the finished check', async () => {
    let reply = running(3)
    const view = renderWith(() => reply)
    const total = reply.live?.total ?? 0
    // The row being checked is named (before any progress push, from the rows themselves).
    expect(await view.findByText(/^Checking… 3 of/u)).toBeTruthy()
    expect(view.getAllByRole('status')[0]?.textContent).toBe(
      `Checking… 3 of ${total} done · checking Q4 now`
    )
    const tree = view.getByRole('treegrid')
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(within(tree).getAllByText('Still checking').length).toBeGreaterThan(0)
    expect(view.container.textContent).not.toContain('Not checked')
    expect(view.getByRole('region', { name: 'Topic summary' }).textContent).toContain(
      'still checking: they fill in as the answers land'
    )
    // The List names each row's turn: the one being checked, then the waiting ones.
    window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}?view=list&type=question`
    const list = await view.findByRole('grid', { name: /every search/ })
    expect(within(list).getAllByText('Checking…').length).toBeGreaterThan(0)
    expect(within(list).getAllByText('Waiting').length).toBeGreaterThan(0)

    reply = { ...textboltTopicResults(), live: null }
    reply = { ...reply, topic: { ...reply.topic, checkedAt: new Date().toISOString() } }
    // The end of a check re-reads at once.
    push('finished')
    expect(await view.findByText('Checked just now')).toBeTruthy()
    expect(view.queryByText('Still checking')).toBeNull()
    expect(view.queryByText(/^Checking…/)).toBeNull()
  })

  test('before the first answer the summary waits, never 0 or "not cited"', async () => {
    const view = renderWith(() => ({
      ...running(0),
      rows: running(0).rows.filter((row) => row.kind === 'question')
    }))
    const summary = await view.findByRole('region', { name: 'Topic summary' })
    expect(summary.textContent).toContain('Waiting for the first answers')
    expect(summary.textContent).not.toContain('0%')
    expect(summary.textContent).not.toContain('Needs work')
  })

  test('a stopped check says its answers come from a partial check', async () => {
    const stopped = running(3)
    const view = renderWith(() => ({
      ...stopped,
      // Main marks nothing "waiting" once a check has stopped.
      rows: stopped.rows.map((row) => ({ ...row, live: null })),
      live: stopped.live
        ? { ...stopped.live, state: 'stopped', endedAt: '2026-10-29T08:05:00.000Z' }
        : null
    }))
    expect(await view.findByText(/^From a check that stopped part-way · 3 of/)).toBeTruthy()
    expect(view.queryByText('Still checking')).toBeNull()
  })
})
