// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssistantAnswer, AssistantAskRequest } from '@shared/ipc'
import { resetDrawersForTests } from '../../shell/drawers'
import type { AssistantClient } from '../client'
import { resetAiContext, setAiBase } from '../context/store'
import { helpQuestionsFor } from '../helpQuestions'
import { clearPendingAsk } from '../openAsk'
import { resetThreads } from '../thread'
import { AskDrawer } from './AskDrawer'

/**
 * Ask CiteFox and the help docs: the empty drawer's common questions and the
 * screen's help topic, and an answer's "Read more" links and next step. The
 * help drawer belongs to the Help builder, so whether it exists is mocked.
 */

const help = vi.hoisted(() => ({ ready: true, opened: [] as string[] }))

vi.mock('../openHelp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../openHelp')>()
  return {
    ...actual,
    helpDrawerReady: () => help.ready,
    openHelp: (id: string) => {
      help.opened.push(id)
    }
  }
})

function answer(request: AssistantAskRequest): AssistantAnswer {
  return {
    intent: 'help',
    question: request.question,
    text: 'What changed compares two checks, so it waits for your next check on Nov 9, 2026.',
    draft: null,
    questions: [],
    sources: [],
    actions: [],
    unknowns: [],
    flagged: [],
    basedOn: { checkedThrough: '2026-11-01T12:00:00Z', checks: 4, markets: 1 },
    label: null,
    list: null,
    savedDataOnly: true,
    help: [{ id: 'history', title: 'Check history' }],
    next: { section: 'history', label: 'Open Check history' }
  }
}

function client(): AssistantClient & { asked: AssistantAskRequest[] } {
  const asked: AssistantAskRequest[] = []
  return {
    asked,
    ask: vi.fn(async (request: AssistantAskRequest) => {
      asked.push(request)
      return answer(request)
    })
  } as unknown as AssistantClient & { asked: AssistantAskRequest[] }
}

beforeEach(() => {
  help.ready = true
  help.opened = []
  setAiBase({
    screen: 'overview',
    screenLabel: 'Summary',
    route: '#/overview',
    crumbs: ['TextBolt', 'Summary'],
    projectId: 'proj-1',
    projectName: 'TextBolt',
    pageId: null,
    topicId: null,
    promptId: null,
    marketId: null,
    runId: null,
    filters: {}
  })
})

afterEach(() => {
  cleanup()
  resetAiContext()
  resetThreads()
  clearPendingAsk()
  resetDrawersForTests()
  window.location.hash = ''
})

function renderDrawer(api = client()): ReturnType<typeof client> {
  render(
    <AskDrawer
      projectId="proj-1"
      question={null}
      about={null}
      depth={0}
      onClose={() => undefined}
      client={api}
    />
  )
  return api
}

describe('Ask CiteFox and the help docs', () => {
  it('offers common questions for the screen and its help topic when empty', () => {
    renderDrawer()
    const start = screen.getByTestId('asst-start')
    expect(within(start).getByRole('button', { name: 'Why is What changed empty?' })).toBeTruthy()
    expect(within(start).getByRole('button', { name: 'What does Right page mean?' })).toBeTruthy()
    fireEvent.click(within(start).getByRole('button', { name: 'Help for this screen: Summary' }))
    expect(help.opened).toEqual(['summary'])
  })

  it('asks a common question and shows Read more and one next step', async () => {
    const api = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Why is What changed empty?' }))
    const region = await screen.findByRole('region', { name: 'Answer from CiteFox AI' })
    expect(api.asked[0]?.question).toBe('Why is What changed empty?')
    const links = within(region).getByTestId('asst-help')
    fireEvent.click(within(links).getByRole('button', { name: 'Read more: Check history' }))
    expect(help.opened).toEqual(['history'])
    expect(
      within(links).getByRole('link', { name: 'Open Check history' }).getAttribute('href')
    ).toBe('#/history')
    expect(screen.queryByTestId('asst-start')).toBeNull()
  })

  it('names the topic without a link while the help drawer is not there yet', async () => {
    help.ready = false
    renderDrawer()
    const start = screen.getByTestId('asst-start')
    expect(within(start).queryByRole('button', { name: /Help for this screen/ })).toBeNull()
    fireEvent.click(within(start).getByRole('button', { name: 'Why is What changed empty?' }))
    const region = await screen.findByRole('region', { name: 'Answer from CiteFox AI' })
    expect(within(region).getByTestId('asst-help').textContent).toContain(
      'From help: Check history'
    )
    expect(within(region).queryByRole('button', { name: /Read more/ })).toBeNull()
  })
})

describe('helpQuestionsFor', () => {
  it('picks the screen’s topic, and Getting started with no project', () => {
    expect(helpQuestionsFor({ screen: 'topic.todo', projectId: 'p' }).topicId).toBe('topics')
    expect(helpQuestionsFor({ screen: 'prompt', projectId: 'p' }).topicId).toBe('question-page')
    expect(helpQuestionsFor({ screen: 'unknown', projectId: 'p' }).topicId).toBe('getting-started')
    expect(helpQuestionsFor({ screen: 'overview', projectId: null }).topicId).toBe(
      'getting-started'
    )
    for (const screenId of ['overview', 'questions', 'history', 'reports', 'settings']) {
      const { questions } = helpQuestionsFor({ screen: screenId, projectId: 'p' })
      expect(questions.length).toBeGreaterThanOrEqual(2)
      expect(questions.length).toBeLessThanOrEqual(3)
    }
  })
})
