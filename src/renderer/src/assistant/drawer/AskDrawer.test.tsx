// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AddQuestionsRequest,
  AssistantAction,
  AssistantAnswer,
  AssistantAskRequest,
  ClaudeStatus
} from '@shared/ipc'
import { resetDrawersForTests } from '../../shell/drawers'
import { PermissionsContext, type PermissionsContextValue } from '../../ui/permissionsContext'
import type { AssistantClient } from '../client'
import { registerAiPatch, resetAiContext, setAiBase } from '../context/store'
import { clearPendingAsk, openAsk } from '../openAsk'
import { AskSparkle } from '../sparkle/AskSparkle'
import { resetThreads } from '../thread'
import { ActionCard } from './ActionCard'
import { AskDrawer } from './AskDrawer'

const ADD: AssistantAction = {
  id: 'add-questions-1',
  kind: 'add-questions',
  title: 'Add 2 questions to Alerts',
  detail: 'Checked in the next run · no searches now',
  pageId: 'page-1',
  topicId: null,
  promptIds: [],
  marketIds: [],
  questions: ['How can I text my crew?', 'Can email become a text alert?'],
  name: null,
  targetPageId: null,
  searches: null,
  drill: null
}

function answer(request: AssistantAskRequest): AssistantAnswer {
  return {
    intent: 'questions',
    question: request.question,
    text: `Answer for ${request.context.screenLabel}.`,
    draft: null,
    questions: ADD.questions,
    sources: [
      {
        kind: 'check',
        label: 'Oct 19 check · “How do I alert the crew?” · US · EN',
        pageId: 'page-1',
        promptId: 'prompt-1',
        marketId: 'mkt-us',
        runId: null,
        drill: null,
        domain: null
      }
    ],
    actions: [ADD],
    unknowns: ['The overview text'],
    flagged: ['37'],
    basedOn: { checkedThrough: '2026-10-19T12:00:00Z', checks: 4, markets: 2 },
    label: null,
    list: null,
    savedDataOnly: true
  }
}

function client(): AssistantClient & { asked: AssistantAskRequest[] } {
  const asked: AssistantAskRequest[] = []
  return {
    asked,
    ask: vi.fn(async (request: AssistantAskRequest) => {
      asked.push(request)
      return answer(request)
    }),
    addQuestions: vi.fn(async (request: AddQuestionsRequest) => ({
      pageId: request.pageId,
      promptIds: request.questions.map((_, index) => `new-${index}`),
      skipped: [],
      version: 2,
      savedAt: '2026-10-20T09:00:00Z'
    })),
    draftTopicFix: vi.fn(),
    runAssist: vi.fn(),
    setTarget: vi.fn(),
    startCheck: vi.fn()
  } as unknown as AssistantClient & { asked: AssistantAskRequest[] }
}

function claudeValue(state: ClaudeStatus['state']): PermissionsContextValue {
  const claude: ClaudeStatus = {
    connection: 'claude-code',
    state,
    name: 'CiteFox AI',
    summary: 'signed out',
    plan: null,
    model: null,
    checkedAt: null,
    fresh: false,
    nextStep: 'Sign in.'
  }
  return {
    snapshot: null,
    claude,
    loading: false,
    error: null,
    checking: false,
    progress: null,
    steps: {},
    busy: null,
    message: null,
    refresh: async () => null,
    checkClaude: async () => claude,
    ensureClaude: async () => claude,
    request: async () => null
  }
}

beforeEach(() => {
  setAiBase({
    screen: 'page.results',
    screenLabel: 'Results',
    route: '#/pages/page-1/results',
    crumbs: ['TextBolt', 'Alerts', 'Results'],
    projectId: 'proj-1',
    projectName: 'TextBolt',
    pageId: 'page-1',
    topicId: null,
    promptId: null,
    marketId: 'mkt-us',
    runId: null,
    filters: {}
  })
  registerAiPatch(0, {
    entities: [{ kind: 'page', id: 'page-1', label: 'Alerts' }],
    numbers: [{ label: 'Cited', value: '1 of 4' }]
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

function renderDrawer(
  props: { question?: string | null; about?: string | null } = {},
  api = client()
): ReturnType<typeof client> {
  render(
    <AskDrawer
      projectId="proj-1"
      question={props.question ?? null}
      about={props.about ?? null}
      depth={0}
      onClose={() => undefined}
      client={api}
    />
  )
  return api as ReturnType<typeof client>
}

describe('Ask CiteFox drawer', () => {
  it('shows what it reads, suggestions for this screen and the footer promise', () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog', { name: 'Ask CiteFox' })
    const looking = within(dialog).getByTestId('asst-looking-at')
    expect(looking.textContent).toContain('Results')
    expect(looking.textContent).toContain('Page: Alerts')
    expect(looking.textContent).toContain('1 number on screen')
    const suggested = within(dialog).getByTestId('asst-suggested')
    expect(
      within(suggested).getByRole('button', { name: /What should I change on this page first/ })
    ).toBeTruthy()
    expect(dialog.textContent).toContain(
      'Answers come from your stored checks. It never searches Google or changes anything without asking.'
    )
  })

  it('asks with the screen context and shows the answer, its sources and a flagged number', async () => {
    const api = renderDrawer()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    fireEvent.change(box, { target: { value: 'Suggest 5 similar questions' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const region = await screen.findByRole('region', { name: 'Answer from CiteFox AI' })
    expect(region.textContent).toContain('Answer for Results.')
    expect(region.textContent).toContain('not in your saved data')
    expect(
      within(region)
        .getByRole('link', { name: /Oct 19 check/ })
        .getAttribute('href')
    ).toBe('#/pages/page-1/prompt/prompt-1?market=mkt-us')
    expect(api.asked[0]?.context).toMatchObject({
      screen: 'page.results',
      pageId: 'page-1',
      marketId: 'mkt-us',
      numbers: [{ label: 'Cited', value: '1 of 4', drill: null }]
    })
    expect(api.asked[0]?.history).toEqual([])
  })

  it('runs an action only after its button is clicked; Not now changes nothing', async () => {
    const api = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: /What should I change on this page first/ }))
    const card = await screen.findByRole('article', { name: /Suggested action: Add 2 questions/ })
    expect(api.addQuestions).not.toHaveBeenCalled()
    fireEvent.click(within(card).getByRole('button', { name: 'Add 2 questions' }))
    await within(card).findByText(/Added 2 questions/)
    expect(api.addQuestions).toHaveBeenCalledWith({
      projectId: 'proj-1',
      pageId: 'page-1',
      questions: [{ text: 'How can I text my crew?' }, { text: 'Can email become a text alert?' }]
    })
  })

  it('sends a ✦ pick at once, but only fills the box from a pasted link', async () => {
    openAsk({ question: 'Explain this number', about: { kind: 'kpi', label: 'Cited' }, send: true })
    const picked = renderDrawer({ question: 'Explain this number', about: 'kpi' })
    await waitFor(() => expect(picked.asked).toHaveLength(1))
    expect(picked.asked[0]?.context.about).toMatchObject({ kind: 'kpi', label: 'Cited' })
    cleanup()
    resetThreads()
    const linked = renderDrawer({ question: 'Explain this number', about: 'kpi' })
    expect(
      (screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value
    ).toBe('Explain this number')
    expect(linked.asked).toHaveLength(0)
  })

  it('explains and links to Connections when CiteFox AI is not ready, and never sends', async () => {
    openAsk({ question: 'Explain this number', send: true })
    const api = client()
    render(
      <PermissionsContext.Provider value={claudeValue('needs_setup')}>
        <AskDrawer
          projectId="proj-1"
          question="Explain this number"
          about={null}
          depth={0}
          onClose={() => undefined}
          client={api}
        />
      </PermissionsContext.Provider>
    )
    const notice = screen.getByTestId('asst-claude-not-ready')
    expect(
      within(notice).getByRole('link', { name: 'Connect CiteFox AI' }).getAttribute('href')
    ).toBe('#/connections?tab=claude')
    // One notice and one button: no text box or suggestions that cannot work.
    expect(screen.queryByRole('textbox', { name: 'Your question' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
    expect(screen.queryByTestId('asst-suggested')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(api.ask).not.toHaveBeenCalled()
  })

  it('checks an unchecked CiteFox AI on the click, then asks', async () => {
    const value = claudeValue('unchecked')
    const ready = { ...value.claude, state: 'ready' } as ClaudeStatus
    const ensureClaude = vi.fn(async () => ready)
    const api = client()
    render(
      <PermissionsContext.Provider value={{ ...value, ensureClaude }}>
        <AskDrawer
          projectId="proj-1"
          question={null}
          about={null}
          depth={0}
          onClose={() => undefined}
          client={api}
        />
      </PermissionsContext.Provider>
    )
    expect(api.ask).not.toHaveBeenCalled()
    const box = screen.getByRole('textbox', { name: 'Your question' })
    fireEvent.change(box, { target: { value: 'Explain this number' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(api.ask).toHaveBeenCalledTimes(1))
    expect(ensureClaude).toHaveBeenCalledTimes(1)
  })
})

describe('action cards', () => {
  it('Not now puts the card away without running it', () => {
    const run = vi.fn()
    render(<ActionCard action={ADD} projectId="proj-1" client={client()} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Skipped. Nothing changed.')
  })

  it('stays done when drawn again, so it cannot run twice', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ text: 'Added.', draft: null, href: null, hrefLabel: null })
    const props = { action: ADD, projectId: 'proj-1', client: client(), run, memoryKey: 't1:a1' }
    const first = render(<ActionCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 questions' }))
    await screen.findByText('Added.')
    first.unmount()
    render(<ActionCard {...props} />)
    expect(screen.getByText('Added.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add 2 questions' })).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('shows the error and lets you try again', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Could not save.'))
    run.mockResolvedValueOnce({ text: 'Done.', draft: 'Paste me', href: null, hrefLabel: null })
    render(<ActionCard action={ADD} projectId="proj-1" client={client()} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 questions' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Done.')
    expect(screen.getByText('Paste me')).toBeTruthy()
  })
})

describe('the ✦ menu', () => {
  it('offers questions about a KPI and opens Ask CiteFox with the pick', () => {
    render(<AskSparkle target={{ kind: 'kpi', label: 'Cited', detail: '7 of 10', goal: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask CiteFox about Cited' }))
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toContain('Explain this number: Cited (7 of 10)')
    expect(items).toContain('Which questions are not cited?')
    expect(items).toContain('How do I reach the 50–70% band?')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Which questions are not cited?' }))
    const hash = decodeURIComponent(window.location.hash.replace(/\+/g, ' '))
    expect(hash).toContain('drawer=ask')
    expect(hash).toContain('ask.q=Which questions are not cited?')
  })

  it('draws nothing with no project open', () => {
    setAiBase(null)
    const view = render(<AskSparkle target={{ kind: 'kpi', label: 'Cited' }} />)
    expect(view.container.innerHTML).toBe('')
  })
})

describe('Ask CiteFox with no project open', () => {
  it('answers app questions: setup suggestions, no project copy, asks with no project id', async () => {
    resetAiContext()
    setAiBase({
      screen: 'overview',
      screenLabel: 'Summary',
      route: '#/overview',
      crumbs: ['Summary'],
      projectId: null,
      projectName: null,
      pageId: null,
      topicId: null,
      promptId: null,
      marketId: null,
      runId: null,
      filters: {}
    })
    const api = client()
    render(
      <AskDrawer
        projectId={null}
        question={null}
        about={null}
        depth={0}
        onClose={() => undefined}
        client={api}
      />
    )
    const dialog = screen.getByRole('dialog', { name: 'Ask CiteFox' })
    expect(within(dialog).getByTestId('asst-empty').textContent).toContain('No project is open.')
    expect(dialog.textContent).toContain('answers from what CiteFox has stored')
    const suggested = within(dialog).getByTestId('asst-suggested')
    fireEvent.click(
      within(suggested).getByRole('button', { name: 'How do I start tracking my site?' })
    )
    const region = await screen.findByRole('region', { name: 'Answer from CiteFox AI' })
    expect(region.textContent).toContain('Answer for Summary.')
    expect(api.asked[0]).toMatchObject({
      projectId: null,
      question: 'How do I start tracking my site?'
    })
    // No project, so no action card can run.
    expect(within(region).queryByRole('article')).toBeNull()
  })
})
