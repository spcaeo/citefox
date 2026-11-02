// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyGuideProgress, type GuideProgress, type GuideSignal } from '@shared/guide'
import type { GuideUpdateRequest } from '@shared/ipc'
import { helpDrawerReady } from '../assistant/openHelp'
import { closeDrawer, openDrawer, resetDrawersForTests, useDrawerEntry } from '../shell/drawers'
import { parseHash } from '../shell/routes'
import type { GuideClient } from './client'
import { STEPS, stepsOf } from './constants'
import { GuideHost, GuideOverlays, GuidePill, GuideSettingsCard, PageHelpButton } from '.'
import type { GuideFacts } from './types'
import { applyPatch } from './utils/engine'

const NOW = '2026-10-29T10:00:00.000Z'

const FACTS: GuideFacts = {
  hasResults: true,
  topic: { id: 't1', name: 'Text alerts', marketId: null, targetPage: null },
  prompt: { id: 'q6', label: 'Q6' },
  citesOwn: 6,
  noPage: { id: 'q2', label: 'Q2' },
  rival: { domain: 'twilio.com', answers: 4, promptId: 'q4' },
  pageFix: { improve: 'pf1', owner: 'pf2', create: null },
  loggedFix: 'fix1',
  topics: 2,
  competitors: 0
}

interface Fake {
  client: GuideClient
  updates: Omit<GuideUpdateRequest, 'projectId'>[]
  signals: GuideSignal[]
  restarts: number
  /** A save elsewhere: main records the signal and pushes `guide:changed`. */
  push: (signal: GuideSignal) => void
}

function fakeClient(initial: Partial<GuideProgress> = {}, facts: GuideFacts = FACTS): Fake {
  let progress: GuideProgress = { ...emptyGuideProgress('p1'), ...initial }
  const listeners = new Set<(next: GuideProgress) => void>()
  const fake: Fake = {
    updates: [],
    signals: [],
    restarts: 0,
    push: (signal) => {
      progress = { ...progress, signals: [...progress.signals, signal] }
      for (const listener of listeners) listener(progress)
    },
    client: {
      get: () => Promise.resolve(progress),
      update: (request) => {
        const { projectId, ...patch } = request
        expect(projectId).toBe('p1')
        fake.updates.push(patch)
        progress = applyPatch(progress, patch, NOW)
        return Promise.resolve(progress)
      },
      signal: ({ signal }) => {
        fake.signals.push(signal)
        if (!progress.signals.includes(signal)) {
          progress = { ...progress, signals: [...progress.signals, signal] }
        }
        return Promise.resolve(progress)
      },
      restart: () => {
        fake.restarts += 1
        progress = emptyGuideProgress('p1')
        return Promise.resolve(progress)
      },
      facts: () => Promise.resolve(facts),
      onChanged: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
  }
  return fake
}

/** The target page drawer's anchors: suggestions, then Save once a page is picked. */
function TargetDrawer(): JSX.Element | null {
  const entry = useDrawerEntry('topic-page')
  const [picked, setPicked] = useState(false)
  if (!entry) return null
  return (
    <div role="dialog" aria-label="Target page" className="ui-drawer-scrim">
      <ul data-guide="target-suggestions">
        <li>
          <button type="button" onClick={() => setPicked(true)}>
            Use this page
          </button>
        </li>
      </ul>
      <button type="button" data-guide="target-save" disabled={!picked}>
        Save target page
      </button>
    </div>
  )
}

/** A tiny shell: the route from the hash, the top bar pieces, a screen with real anchors. */
function Shell({ client }: { client: GuideClient }): JSX.Element {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = (): void => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const location = parseHash(hash)
  return (
    <GuideHost projectId="p1" location={location} revision={0} client={client}>
      <header>
        <nav aria-label="Breadcrumb">Project</nav>
        <PageHelpButton />
        <GuidePill />
      </header>
      <main id="main">
        {location.kind === 'topic' ? (
          <>
            <h1>Text alerts</h1>
            <p data-guide="topic-target-page">
              Target page{' '}
              <button type="button" onClick={() => openDrawer('topic-page')}>
                Set target page
              </button>
            </p>
            <div data-guide="topic-kpis">Tiles</div>
            <button type="button" data-guide="topic-check-now">
              Check now
            </button>
            <TargetDrawer />
          </>
        ) : location.kind === 'prompt' ? (
          <section aria-labelledby="pd-aio-h">
            <h2 id="pd-aio-h">AI Overview</h2>
          </section>
        ) : location.kind === 'section' && location.section === 'settings' ? (
          <GuideSettingsCard />
        ) : location.kind === 'section' && location.section === 'overview' ? (
          <section aria-label="Headline numbers">Numbers</section>
        ) : (
          <header data-guide="screen-header">
            <h1>Screen</h1>
          </header>
        )}
      </main>
      <GuideOverlays />
    </GuideHost>
  )
}

function go(hash: string): void {
  act(() => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/overview')
  resetDrawersForTests()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** happy-dom lays nothing out: give every element a box, so pointers can find them. */
function layOut(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        top: 200,
        left: 600,
        width: 120,
        height: 30,
        right: 720,
        bottom: 230,
        x: 600,
        y: 200
      }) as DOMRect
  )
}

describe('GuideHost', () => {
  test('after the first results: the kick-off card, then the first lesson starts on the real element', async () => {
    const fake = fakeClient()
    render(<Shell client={fake.client} />)
    const card = await screen.findByRole('region', { name: 'Your first results are in' })
    await waitFor(() => expect(fake.updates).toContainEqual({ kickoff: 'offered' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Start the guide' }))
    // The lesson for this screen starts: the Summary's headline numbers.
    const step = await screen.findByRole('dialog', { name: 'Your headline numbers' })
    expect(step.textContent).toContain('Step 1 of 4 · Your Summary')
    expect(fake.updates).toContainEqual(
      expect.objectContaining({ current: 'summary', steps: { summary: 'shown' } })
    )
    // The top bar counts this screen's lesson; the overall count is in its name and tooltip.
    const pill = screen.getByTestId('guide-pill')
    expect(pill.textContent).toBe('0/4')
    expect(pill.getAttribute('aria-label')).toMatch(/^Guide 0\/4: Your Summary/u)
    expect(pill.getAttribute('data-tip')).toContain(`0 of ${STEPS.length} steps done in all`)
  })

  test('walking away pauses quietly; Continue reopens the exact route and the coachmark', async () => {
    window.history.replaceState(null, '', '#/topics/t1?tab=stage')
    const fake = fakeClient({
      kickoff: 'later',
      current: 'set-target-page',
      steps: { 'set-target-page': 'shown' },
      explainersSeen: ['competitors', 'topic']
    })
    render(<Shell client={fake.client} />)
    expect(await screen.findByRole('dialog', { name: 'Set your target page' })).toBeTruthy()
    go('#/competitors')
    await waitFor(() =>
      expect(fake.updates).toContainEqual({
        paused: { stepId: 'set-target-page', route: '#/topics/t1?tab=stage' }
      })
    )
    expect(screen.queryByRole('dialog', { name: 'Set your target page' })).toBeNull()
    fireEvent.click(screen.getByTestId('guide-pill'))
    const paused = await screen.findByTestId('guide-paused')
    expect(paused.textContent).toContain('Paused: Set your target page')
    fireEvent.click(within(paused).getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(window.location.hash).toBe('#/topics/t1?tab=stage'))
    expect(await screen.findByRole('dialog', { name: 'Set your target page' })).toBeTruthy()
  })

  test('the real save completes the step it waits for, and the lesson ends', async () => {
    window.history.replaceState(null, '', '#/topics/t1')
    const fake = fakeClient({
      kickoff: 'later',
      current: 'set-target-page',
      steps: { 'set-target-page': 'shown' },
      explainersSeen: ['topic']
    })
    render(<Shell client={fake.client} />)
    const step = await screen.findByRole('dialog', { name: 'Set your target page' })
    // The reason comes from this project's data.
    expect(step.textContent).toContain(
      '6 questions already cite your site, but this topic has no target page yet.'
    )
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull()
    act(() => fake.push('target-page-set'))
    // On to the next step of this screen's lesson.
    expect(await screen.findByRole('dialog', { name: 'Check again' })).toBeTruthy()
    expect(fake.updates).toContainEqual({
      steps: { 'set-target-page': 'done', 'check-now': 'shown' },
      current: 'check-now',
      paused: null
    })
  })

  test('opening a question ends the topic lesson; Next lesson is the question page lesson', async () => {
    window.history.replaceState(null, '', '#/topics/t1')
    const fake = fakeClient({
      kickoff: 'later',
      current: 'open-question',
      steps: { 'open-question': 'shown' },
      explainersSeen: ['topic', 'prompt']
    })
    render(<Shell client={fake.client} />)
    await screen.findByRole('dialog', { name: 'Open a question' })
    go('#/pages/t1/prompt/q6')
    const end = await screen.findByRole('region', { name: 'Lesson done: A topic page' })
    expect(end.textContent).toContain('Up next: A question page.')
    expect(fake.signals).toContain('prompt-opened')
    fireEvent.click(within(end).getByRole('button', { name: 'Next lesson' }))
    expect(
      await screen.findByRole('dialog', { name: 'The AI answer, as Google showed it' })
    ).toBeTruthy()
    expect(fake.updates.some((patch) => 'paused' in patch && patch.paused !== null)).toBe(false)
  })

  test('Back on one screen shows the done step and stays there; Next goes forward again', async () => {
    window.history.replaceState(null, '', '#/topics/t1')
    const fake = fakeClient({
      kickoff: 'later',
      current: 'topic-todo',
      steps: { summary: 'done', 'topic-kpis': 'done', 'topic-todo': 'shown' },
      explainersSeen: ['topic', 'prompt']
    })
    render(<Shell client={fake.client} />)
    const todo = await screen.findByRole('dialog', { name: 'Four ways to see the searches' })
    fireEvent.click(within(todo).getByRole('button', { name: 'Back' }))
    const kpis = await screen.findByRole('dialog', { name: 'How this topic is doing' })
    // Review: it stays, says it is done, and offers Next instead of finishing again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.getByRole('dialog', { name: 'How this topic is doing' })).toBe(kpis)
    expect(kpis.textContent).toContain('You’ve done this one')
    expect(within(kpis).queryByRole('button', { name: 'Got it' })).toBeNull()
    expect(fake.updates.at(-1)).toEqual(expect.objectContaining({ current: 'topic-kpis' }))
    fireEvent.click(within(kpis).getByRole('button', { name: 'Next' }))
    expect(
      await screen.findByRole('dialog', { name: 'Four ways to see the searches' })
    ).toBeTruthy()
    expect(window.location.hash).toBe('#/topics/t1')
  })

  test('a lesson stays on its screen: its first step offers no Back', async () => {
    window.history.replaceState(null, '', '#/pages/t1/prompt/q6')
    const fake = fakeClient({
      kickoff: 'later',
      current: 'ai-answer',
      signals: ['prompt-opened'],
      steps: { 'ai-answer': 'shown' },
      explainersSeen: ['topic', 'prompt']
    })
    render(<Shell client={fake.client} />)
    const answer = await screen.findByRole('dialog', { name: 'The AI answer, as Google showed it' })
    expect(answer.textContent).toContain(`Step 1 of ${stepsOf('prompt').length} · A question page`)
    expect(within(answer).queryByRole('button', { name: 'Back' })).toBeNull()
  })

  test('Show me on a done step in the checklist opens it in review, not done again', async () => {
    window.history.replaceState(null, '', '#/topics/t1')
    const fake = fakeClient({
      kickoff: 'later',
      steps: { summary: 'done', 'topic-kpis': 'done' },
      explainersSeen: ['topic']
    })
    render(<Shell client={fake.client} />)
    fireEvent.click(await screen.findByTestId('guide-pill'))
    const list = await screen.findByTestId('guide-checklist')
    fireEvent.click(within(list).getByRole('button', { name: 'Show me: How this topic is doing' }))
    const kpis = await screen.findByRole('dialog', { name: 'How this topic is doing' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(screen.getByRole('dialog', { name: 'How this topic is doing' })).toBe(kpis)
    expect(within(kpis).getByRole('button', { name: 'Next' })).toBeTruthy()
  })

  test('"Open it for me" opens the drawer; a pointer guides inside it; closing it brings the step back', async () => {
    layOut()
    window.history.replaceState(null, '', '#/topics/t1')
    const fake = fakeClient({
      kickoff: 'later',
      current: 'set-target-page',
      steps: { 'set-target-page': 'shown' },
      explainersSeen: ['topic']
    })
    render(<Shell client={fake.client} />)
    const step = await screen.findByRole('dialog', { name: 'Set your target page' })
    fireEvent.click(within(step).getByRole('button', { name: 'Open it for me' }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=topic-page'))
    // No coachmark and no dim over the drawer: only the pointer, on the suggestions.
    expect(screen.queryByRole('dialog', { name: 'Set your target page' })).toBeNull()
    expect(document.querySelector('.gd-mask')).toBeNull()
    const hint = await screen.findByTestId('guide-hint')
    expect(hint.textContent).toContain('Pick one of these suggested pages')
    fireEvent.click(screen.getByRole('button', { name: 'Use this page' }))
    await waitFor(() =>
      expect(screen.getByTestId('guide-hint').textContent).toContain('Click Save target page')
    )
    // Closed without saving: the step's coachmark comes back, nothing lost.
    act(() => closeDrawer())
    expect(await screen.findByRole('dialog', { name: 'Set your target page' })).toBeTruthy()
    expect(screen.queryByTestId('guide-hint')).toBeNull()
    expect(fake.updates.some((patch) => patch.paused)).toBe(false)
    // The real save, from the drawer, completes it as before.
    fireEvent.click(screen.getByRole('button', { name: 'Open it for me' }))
    await screen.findByTestId('guide-hint')
    act(() => fake.push('target-page-set'))
    act(() => closeDrawer())
    expect(await screen.findByRole('dialog', { name: 'Check again' })).toBeTruthy()
  })

  test("a step done out of order, elsewhere, ticks in this screen's lesson", async () => {
    window.history.replaceState(null, '', '#/pages/t1/prompt/q6')
    const fake = fakeClient({ kickoff: 'later', explainersSeen: ['prompt'] })
    render(<Shell client={fake.client} />)
    const pill = await screen.findByTestId('guide-pill')
    // Opening the question counted already: 1 of the question page's 4 steps.
    await waitFor(() => expect(pill.textContent).toBe('0/4'))
    act(() => fake.push('competitor-saved'))
    await waitFor(() => expect(screen.getByTestId('guide-pill').textContent).toBe('1/4'))
    expect(screen.getByTestId('guide-pill').getAttribute('data-tip')).toContain(
      `of ${STEPS.length} steps done in all`
    )
    fireEvent.click(screen.getByTestId('guide-pill'))
    const list = await screen.findByTestId('guide-checklist')
    expect(within(list).getByText('Mark a competitor').parentElement?.textContent).toContain(
      '(Done)'
    )
  })

  test("the guide shows only this screen's lesson, with the overall count and All lessons", async () => {
    window.history.replaceState(null, '', '#/topics/t1')
    const fake = fakeClient({ kickoff: 'later', explainersSeen: ['topic'] })
    render(<Shell client={fake.client} />)
    fireEvent.click(await screen.findByTestId('guide-pill'))
    const list = await screen.findByTestId('guide-checklist')
    const here = within(list).getByTestId('guide-here')
    expect(within(here).getByRole('heading', { name: 'A topic page' })).toBeTruthy()
    expect(within(here).getAllByRole('listitem')).toHaveLength(stepsOf('topic').length)
    // No step of another screen's lesson.
    expect(within(list).queryByText('Mark a competitor')).toBeNull()
    // The data's reason, in one line.
    expect(within(here).getByTestId('guide-why').textContent).toBe(
      '6 questions already cite your site, but this topic has no target page yet.'
    )
    expect(within(list).getByTestId('guide-overall').textContent).toBe(
      `0 of ${STEPS.length} steps done in all`
    )
    fireEvent.click(within(list).getByRole('button', { name: 'All lessons' }))
    const all = within(list).getByRole('list', { name: 'All lessons' })
    expect(within(all).getByText('Your Summary')).toBeTruthy()
    expect(within(all).getByText('Report branding')).toBeTruthy()
    // Learn more opens the lesson's help topic over the screen, once the help drawer exists.
    const learn = within(here).queryByRole('button', { name: 'Learn more' })
    if (helpDrawerReady()) {
      fireEvent.click(learn as HTMLElement)
      await waitFor(() => expect(window.location.hash).toContain('help.id=topics'))
    } else {
      expect(learn).toBeNull()
    }
  })

  test('a page explainer shows on the first visit, closes for good, and the "?" brings it back', async () => {
    const fake = fakeClient({ kickoff: 'later' })
    window.history.replaceState(null, '', '#/fixes')
    render(<Shell client={fake.client} />)
    const card = await screen.findByRole('region', { name: 'What is Fixes?' })
    fireEvent.click(within(card).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(fake.updates).toContainEqual({ explainerSeen: 'fixes' }))
    expect(screen.queryByRole('region', { name: 'What is Fixes?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'What is this page?' }))
    const again = await screen.findByRole('region', { name: 'What is Fixes?' })
    fireEvent.click(within(again).getByRole('button', { name: 'Show me' }))
    // The page's lesson starts where it begins: the Fixes tabs.
    expect(await screen.findByRole('dialog', { name: 'Three tabs' })).toBeTruthy()
    expect(window.location.hash).toBe('#/fixes')
  })

  test('tips off: no explainer and no kick-off', async () => {
    const fake = fakeClient({ tipsOff: true })
    window.history.replaceState(null, '', '#/fixes')
    render(<Shell client={fake.client} />)
    await screen.findByTestId('guide-pill')
    expect(screen.queryByRole('region')).toBeNull()
    go('#/overview')
    expect(screen.queryByRole('region', { name: 'Your first results are in' })).toBeNull()
  })

  test("the kick-off's Don't show again turns tips off as it closes and points to Settings", async () => {
    const fake = fakeClient()
    render(<Shell client={fake.client} />)
    const card = await screen.findByRole('region', { name: 'Your first results are in' })
    const box = within(card).getByRole('checkbox', { name: "Don't show again" })
    fireEvent.click(box)
    // Ticking alone changes nothing yet; it says where tips come back on.
    expect(fake.updates).not.toContainEqual({ tipsOff: true })
    expect(within(card).getByRole('link', { name: 'Settings › General' })).toHaveProperty(
      'hash',
      '#/settings?tab=general'
    )
    fireEvent.click(within(card).getByRole('button', { name: 'Later' }))
    await waitFor(() => expect(fake.updates).toContainEqual({ tipsOff: true }))
    expect(fake.updates).toContainEqual({ kickoff: 'later' })
    expect(screen.queryByRole('region', { name: 'Your first results are in' })).toBeNull()
    go('#/fixes')
    expect(screen.queryByRole('region', { name: 'What is Fixes?' })).toBeNull()
  })

  test('an explainer\'s Don\'t show again stops the others; the "?" card has no box', async () => {
    const fake = fakeClient({ kickoff: 'later' })
    window.history.replaceState(null, '', '#/fixes')
    render(<Shell client={fake.client} />)
    const card = await screen.findByRole('region', { name: 'What is Fixes?' })
    fireEvent.click(within(card).getByRole('checkbox', { name: "Don't show again" }))
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(fake.updates).toContainEqual({ tipsOff: true }))
    fireEvent.click(screen.getByRole('button', { name: 'What is this page?' }))
    const again = await screen.findByRole('region', { name: 'What is Fixes?' })
    expect(within(again).queryByRole('checkbox')).toBeNull()
  })

  test('Settings › General: restart asks first, explainers again, tips off, hide and resume', async () => {
    const fake = fakeClient({
      kickoff: 'later',
      steps: { summary: 'done' },
      explainersSeen: ['settings']
    })
    window.history.replaceState(null, '', '#/settings?tab=general')
    render(<Shell client={fake.client} />)
    expect((await screen.findByTestId('guide-settings-progress')).textContent).toContain(
      `1 of ${STEPS.length} steps done`
    )
    fireEvent.click(screen.getByRole('button', { name: 'Restart guide' }))
    await waitFor(() => expect(window.location.hash).toContain('guide=restart'))
    const confirm = await screen.findByRole('alertdialog', { name: 'Restart the guide?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Restart guide' }))
    await waitFor(() => expect(fake.restarts).toBe(1))
    await waitFor(() =>
      expect(screen.getByTestId('guide-settings-progress').textContent).toContain('0 of')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show page explainers again' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Show tips/ }))
    await waitFor(() =>
      expect(fake.updates).toEqual(
        expect.arrayContaining([{ explainersReset: true }, { tipsOff: true }])
      )
    )
    fireEvent.click(screen.getByTestId('guide-pill'))
    fireEvent.click(await screen.findByTestId('guide-hide'))
    await waitFor(() => expect(screen.queryByTestId('guide-pill')).toBeNull())
    go('#/settings?tab=general')
    fireEvent.click(await screen.findByRole('button', { name: 'Start guide' }))
    await waitFor(() => expect(fake.updates).toContainEqual({ hidden: false }))
    await waitFor(() => expect(screen.queryByTestId('guide-pill')).not.toBeNull())
  })
})
