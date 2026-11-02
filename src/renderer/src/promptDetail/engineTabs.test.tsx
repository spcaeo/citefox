// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineId } from '@shared/domain'
import type { EngineAnswerView, QuestionEnginesRequest, QuestionEnginesView } from '@shared/ipc'
import { axeViolations } from '../ui/axe.test-helper'
import { PromptDetailScreen } from '.'
import { rowAt, source } from './promptDetail.fixtures.test-helper'

beforeEach(() => {
  window.history.replaceState(null, '', '#/pages/textbolt-alerts/prompt/p')
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function answer(engine: EngineId, patch: Partial<EngineAnswerView> = {}): EngineAnswerView {
  return {
    engine,
    label:
      engine === 'google_aio'
        ? 'Google AI Overview'
        : engine === 'chatgpt'
          ? 'ChatGPT'
          : engine === 'perplexity'
            ? 'Perplexity'
            : engine,
    selected: false,
    status: null,
    checkedAt: null,
    cited: false,
    named: false,
    citedUrl: null,
    position: null,
    text: null,
    markdown: null,
    sources: [],
    message: null,
    provider: null,
    credits: 0,
    costMicros: 0,
    ...patch
  }
}

function engines(rows: readonly EngineAnswerView[]): ((
  request: QuestionEnginesRequest
) => Promise<QuestionEnginesView>) & {
  mock: { calls: unknown[][] }
} {
  return vi.fn(async (request: QuestionEnginesRequest) => ({
    projectId: request.projectId,
    pageId: request.pageId,
    promptId: request.promptId,
    marketId: request.marketId ?? null,
    engines: rows
  }))
}

const CHECKED = '2026-10-24T10:12:00.000Z'

const THREE = [
  answer('google_aio', { selected: true, status: 'cited', checkedAt: CHECKED }),
  answer('chatgpt', {
    selected: true,
    status: 'not_cited',
    checkedAt: CHECKED,
    markdown:
      'Yes. AT&T **discontinued** its email-to-text service.\n\n<img src=x onerror=alert(1)>\n\n[Read more](javascript:alert(1))',
    sources: [
      {
        position: 1,
        url: 'https://att.com/support/article/wireless/KM1061254',
        domain: 'att.com',
        title: 'Email to text',
        classification: 'other'
      },
      {
        position: 2,
        url: 'https://textbolt.com/blog/email-to-text/',
        domain: 'textbolt.com',
        title: null,
        classification: 'own'
      }
    ],
    provider: 'cloro',
    credits: 7,
    costMicros: 5_600
  }),
  answer('perplexity', { selected: true, status: 'unavailable', checkedAt: CHECKED }),
  answer('gemini')
]

function screen(channel: ReturnType<typeof engines> | undefined): ReturnType<typeof render> {
  const base = source()
  return render(
    <PromptDetailScreen
      source={channel ? { ...base, 'engines:question': channel } : base}
      projectId="textbolt"
      projectName="TextBolt"
      pageId="textbolt-alerts"
      promptId={rowAt(0).promptId}
      marketId={undefined}
      onMarketChange={() => undefined}
    />
  )
}

function eng(): string | null {
  const hash = window.location.hash
  return new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '').get('eng')
}

describe('Question detail engine tabs', () => {
  it('shows no engine tabs when only Google AI Overview is checked', async () => {
    const channel = engines([answer('google_aio', { selected: true, status: 'cited' })])
    const view = screen(channel)
    await view.findByRole('heading', { level: 1 })
    await waitFor(() => expect(channel).toHaveBeenCalled())
    expect(view.queryByRole('tablist', { name: 'Engines' })).toBeNull()
    expect(view.getByRole('tablist', { name: 'Question sections' })).toBeTruthy()
  })

  it('opens on Google AI Overview with its sections, one tab per checked engine', async () => {
    const channel = engines(THREE)
    const view = screen(channel)
    const tabs = await view.findByRole('tablist', { name: 'Engines' })
    expect(channel).toHaveBeenCalledWith({
      projectId: 'textbolt',
      pageId: 'textbolt-alerts',
      promptId: rowAt(0).promptId,
      marketId: 'us-en'
    })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['Google AI Overview', 'ChatGPT', 'Perplexity'])
    expect(
      within(tabs).getByRole('tab', { name: 'Google AI Overview' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(view.getByRole('tablist', { name: 'Question sections' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('keeps the engine tab in the URL and shows its answer safely, with sources and cost', async () => {
    const view = screen(engines(THREE))
    const tabs = await view.findByRole('tablist', { name: 'Engines' })
    fireEvent.click(within(tabs).getByRole('tab', { name: 'ChatGPT' }))
    expect(eng()).toBe('chatgpt')
    const panel = await view.findByTestId('engine-answer')
    expect(panel.getAttribute('data-engine')).toBe('chatgpt')
    expect(view.queryByRole('tablist', { name: 'Question sections' })).toBeNull()
    expect(within(panel).getByText('discontinued').tagName).toBe('STRONG')
    // Raw HTML never becomes an element, and a javascript: link is not a link.
    expect(panel.querySelector('img')).toBeNull()
    expect(within(panel).queryByRole('link', { name: /Read more/ })).toBeNull()
    expect(within(panel).getByText('Not cited')).toBeTruthy()
    expect(within(panel).getByText('7 credits · $0.006')).toBeTruthy()
    const grid = within(panel).getByRole('grid', { name: 'Sources ChatGPT used, in its order' })
    expect(within(grid).getAllByRole('row')).toHaveLength(3)
    expect(within(grid).getByText('Your page')).toBeTruthy()
    expect(within(grid).getAllByRole('button', { name: /Copy/ }).length).toBeGreaterThan(0)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('shows an unavailable engine as a plain line, not an error', async () => {
    window.history.replaceState(null, '', '#/pages/textbolt-alerts/prompt/p?eng=perplexity')
    const view = screen(engines(THREE))
    const panel = await view.findByTestId('engine-answer')
    expect(view.queryByRole('alert')).toBeNull()
    expect(within(panel).getByRole('note').textContent).toBe(
      'Perplexity was unavailable during this check, so there is no answer. CiteFox asks again at the next check.'
    )
    expect(within(panel).getByText('No credits used')).toBeTruthy()
    expect(within(panel).queryByRole('list')).toBeNull()
  })

  it('falls back to Google AI Overview for an engine the question does not have', async () => {
    window.history.replaceState(null, '', '#/pages/textbolt-alerts/prompt/p?eng=copilot')
    const view = screen(engines(THREE))
    const tabs = await view.findByRole('tablist', { name: 'Engines' })
    expect(
      within(tabs).getByRole('tab', { name: 'Google AI Overview' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(view.queryByTestId('engine-answer')).toBeNull()
  })

  it('keeps today’s detail when the source has no engine channel', async () => {
    const view = screen(undefined)
    await view.findByRole('tablist', { name: 'Question sections' })
    expect(view.queryByRole('tablist', { name: 'Engines' })).toBeNull()
  })
})
