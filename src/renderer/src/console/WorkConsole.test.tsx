// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckProgress } from '@shared/ipc'
import type { ConsolePrefs } from './types'
import type { ConsoleClient } from './client'
import { createConsoleStore, type ConsoleStore } from './store'
import { WorkConsole } from './WorkConsole'

type Listener = (event: never) => void

/** A fake client: tests push events by channel; nothing reaches main. */
function fakeClient(): ConsoleClient & {
  emit: (channel: string, event: unknown) => void
  calls: string[]
} {
  const listeners = new Map<string, Set<Listener>>()
  const calls: string[] = []
  const on =
    (channel: string) =>
    (listener: Listener): (() => void) => {
      const set = listeners.get(channel) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(channel, set)
      return () => set.delete(listener)
    }
  return {
    calls,
    emit(channel, event) {
      for (const listener of listeners.get(channel) ?? []) listener(event as never)
    },
    onCheckProgress: on('checks:progress'),
    onCheckFinished: on('checks:finished'),
    onPageRead: on('pages:readProgress'),
    onAssist: on('assist:progress'),
    onTopic: on('topics:progress'),
    onSetup: on('setup:progress'),
    onStart: on('start:changed'),
    onExport: on('exports:progress'),
    retryCheck: (projectId, pageId) => {
      calls.push(`retryCheck ${projectId} ${pageId}`)
      return Promise.resolve()
    },
    retrySetup: (pageId) => {
      calls.push(`retrySetup ${pageId}`)
      return Promise.resolve()
    },
    cancelCheck: (jobId) => {
      calls.push(`cancelCheck ${jobId}`)
      return Promise.resolve()
    },
    stopStart: (projectId) => {
      calls.push(`stopStart ${projectId}`)
      return Promise.resolve()
    }
  }
}

function progress(extra: Partial<CheckProgress> = {}): CheckProgress {
  return {
    jobId: 'j1',
    projectId: 'p1',
    pageId: 'g1',
    marketId: 'm1',
    promptId: 'q1',
    sampleNo: 1,
    phase: 'search',
    state: 'running',
    detail: 'best sms api',
    nextStep: null,
    errorCode: null,
    retrySearches: 0,
    done: 3,
    total: 12,
    searchesUsed: 3,
    searchesMax: 60,
    monthUsed: null,
    monthLimit: null,
    markets: [],
    ...extra
  }
}

const stores: ConsoleStore[] = []

afterEach(() => {
  cleanup()
  for (const store of stores.splice(0)) store.dispose()
})

function setup(prefs: Partial<ConsolePrefs> = {}): {
  client: ReturnType<typeof fakeClient>
  store: ConsoleStore
  saved: ConsolePrefs[]
  tick: () => void
  clock: { now: number }
} {
  const client = fakeClient()
  const saved: ConsolePrefs[] = []
  const clock = { now: 1_000_000 }
  let timer: (() => void) | null = null
  const store = createConsoleStore(client, {
    now: () => clock.now,
    loadPrefs: () => ({ prefersMin: false, closeWhenDone: true, position: null, ...prefs }),
    savePrefs: (value) => saved.push(value),
    setTimer: (run) => {
      timer = run
      return () => {
        timer = null
      }
    }
  })
  stores.push(store)
  render(<WorkConsole store={store} />)
  return { client, store, saved, clock, tick: () => act(() => timer?.()) }
}

describe('WorkConsole', () => {
  it('keeps the C:\\ question on Windows', () => {
    const agent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/38')
    try {
      const { client } = setup()
      act(() => client.emit('checks:progress', progress()))
      expect(screen.getByRole('log').textContent).toContain('C:\\CITEFOX\\CHECKS\\SEARCH>')
    } finally {
      agent.mockRestore()
    }
  })

  it('names the question, the questions and keywords, and the credits used', () => {
    const { client } = setup()
    act(() =>
      client.emit(
        'checks:progress',
        progress({
          detail: 'Searching Google',
          promptText: 'nagios email to text not working',
          mix: { questions: 8, keywords: 4 },
          creditsUsed: 14
        })
      )
    )
    const log = screen.getByRole('log').textContent ?? ''
    expect(log).toContain('check 8 questions and 4 keywords')
    expect(log).toContain(
      '3 of 12 done · 14 credits used · Searching Google for "nagios email to text not working"… please wait'
    )
    expect(log).not.toContain('12 questions')
  })

  it('renders nothing until work starts, then a log with the stage question', () => {
    const { client } = setup()
    expect(screen.queryByRole('log')).toBeNull()
    act(() => client.emit('checks:progress', progress()))
    const log = screen.getByRole('log')
    expect(log.getAttribute('aria-live')).toBe('polite')
    // happy-dom reports X11, so the prompt is the macOS and Linux one.
    expect(log.textContent).toContain('citefox/checks/search $')
    expect(log.textContent).not.toContain('C:\\')
    expect(log.textContent).toContain('3 of 12 questions')
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
  })

  it('minimises to the pill on Escape and saves that for next time', () => {
    const { client, saved } = setup()
    act(() => client.emit('checks:progress', progress()))
    fireEvent.keyDown(screen.getByRole('log'), { key: 'Escape' })
    expect(screen.queryByRole('log')).toBeNull()
    const pill = screen.getByRole('button', { name: /Open the work console/u })
    expect(pill.textContent).toContain('checks/search $')
    expect(saved.at(-1)?.prefersMin).toBe(true)
    fireEvent.click(pill)
    expect(screen.getByRole('log')).toBeTruthy()
  })

  it('shakes the pill green when the check ends while minimised', () => {
    const { client } = setup({ prefersMin: true })
    act(() => client.emit('checks:progress', progress()))
    const busy = screen.getByRole('button', { name: /Open the work console/u })
    expect(busy.className).toContain('wc-pill-busy')
    act(() => client.emit('checks:progress', progress({ done: 12, state: 'ok' })))
    const pill = screen.getByRole('button', { name: /Open the work console/u })
    expect(pill.className).toContain('wc-pill-done')
    expect(pill.className).toMatch(/wc-pill-(shake|glow)/u)
    expect(screen.getByRole('status').textContent).toContain('Check done')
  })

  it('counts down and closes after the work is done; "keep open" stops it', () => {
    const { client, clock, tick } = setup()
    act(() => client.emit('checks:progress', progress()))
    act(() => client.emit('checks:progress', progress({ done: 12, state: 'ok' })))
    expect(screen.getByRole('log').textContent).toMatch(/closing in \d/u)
    fireEvent.click(screen.getByRole('button', { name: /keep open/u }))
    clock.now += 60_000
    tick()
    expect(screen.getByRole('log')).toBeTruthy()
    act(() => client.emit('checks:progress', progress({ jobId: 'j2', done: 12, state: 'ok' })))
    clock.now += 6_000
    tick()
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('shows an error in red with retry, which starts the check again', () => {
    const { client } = setup()
    act(() =>
      client.emit(
        'checks:progress',
        progress({ state: 'error', detail: 'SerpApi refused the key', nextStep: 'Check the key.' })
      )
    )
    const log = screen.getByRole('log')
    expect(log.textContent).toContain('SerpApi refused the key')
    expect(log.textContent).toContain('Check the key.')
    fireEvent.click(screen.getByRole('button', { name: /retry/u }))
    expect(client.calls).toEqual(['retryCheck p1 g1'])
    expect(screen.getByRole('log').textContent).toContain('retry sent')
  })

  it('stops a running check from the footer', () => {
    const { client } = setup()
    act(() => client.emit('checks:progress', progress()))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(client.calls).toEqual(['cancelCheck j1'])
  })

  it('shows page reads and AI generation as tabs when both run', () => {
    const { client } = setup()
    act(() =>
      client.emit('pages:readProgress', {
        pageId: 'g1',
        phase: 'fetch',
        state: 'running',
        detail: 'Fetching the page.',
        nextStep: null
      })
    )
    act(() =>
      client.emit('assist:progress', {
        runId: 'r1',
        channel: 'projects:fillFromWebsite',
        scope: 'textbolt.com',
        stepId: 'ask',
        kind: 'claude',
        label: 'Asking CiteFox AI to find competitors',
        state: 'running',
        detail: null,
        startedAt: 1_000_000,
        endedAt: null,
        claude: null
      })
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringContaining('Fill from textbolt.com'),
      expect.stringContaining('Page read')
    ])
    expect(screen.getByRole('log').textContent).toContain('citefox/fill/claude $')
    fireEvent.click(tabs[1] as HTMLElement)
    expect(screen.getByRole('log').textContent).toContain('citefox/pages/fetch $')
  })

  it('stays open when "Close when done" is off', () => {
    const { client, clock, tick, saved } = setup()
    act(() => client.emit('checks:progress', progress()))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Close when done' }))
    expect(saved.at(-1)?.closeWhenDone).toBe(false)
    act(() => client.emit('checks:progress', progress({ done: 12, state: 'ok' })))
    clock.now += 60_000
    tick()
    expect(screen.getByRole('log').textContent).not.toMatch(/closing in/u)
  })
})

describe('console store', () => {
  it('ignores a malformed event instead of breaking', () => {
    const { client, store } = setup()
    const before = store.getSnapshot()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    act(() => client.emit('checks:progress', null))
    expect(store.getSnapshot()).toBe(before)
  })
})
