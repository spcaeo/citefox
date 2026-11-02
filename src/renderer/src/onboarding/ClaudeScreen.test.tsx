// @vitest-environment happy-dom
import { act, cleanup, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeCheckupProgress } from '@shared/ipc'
import type { OnboardingClient } from './client'
import { ClaudeScreen } from './ClaudeScreen'
import { createMockOnboardingClient } from './mockClient'

afterEach(cleanup)

describe('ClaudeScreen first checkup', () => {
  it('runs once and reports to the latest callbacks after the parent re-renders', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = createMockOnboardingClient({ paceMs: 0 })
    let runs = 0
    const client: OnboardingClient = {
      ...base,
      runCheckup: async (request) => {
        runs += 1
        await gate
        return base.runCheckup(request)
      }
    }
    const first = vi.fn()
    const second = vi.fn()
    const props = {
      client,
      onAnnounce: () => undefined,
      onBack: () => undefined,
      onContinue: () => undefined,
      onAnthropic: () => Promise.resolve({ error: null, hint: null })
    }
    const view = render(<ClaudeScreen {...props} onChecked={first} />)
    view.rerender(<ClaudeScreen {...props} onChecked={second} />)
    release()
    await waitFor(() => {
      expect(second).toHaveBeenCalledTimes(1)
    })
    expect(first).not.toHaveBeenCalled()
    expect(runs).toBe(1)
  })
})

describe('ClaudeScreen ready panel', () => {
  it('says the plan sentence once when the engine message already has it', async () => {
    const base = createMockOnboardingClient({ paceMs: 0 })
    const client: OnboardingClient = {
      ...base,
      runCheckup: async (request) => {
        const result = await base.runCheckup(request)
        return {
          ...result,
          ready: true,
          plan: 'Claude Max',
          message: 'Claude Code is ready. CiteFox will run its analysis on your Claude Max plan.'
        }
      }
    }
    const view = render(
      <ClaudeScreen
        client={client}
        onAnnounce={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
        onChecked={() => undefined}
        onAnthropic={() => Promise.resolve({ error: null, hint: null })}
      />
    )
    await waitFor(() => {
      expect(view.container.querySelector('.panel-ok')).not.toBeNull()
    })
    const text = view.container.querySelector('.panel-ok')?.textContent ?? ''
    expect(text.match(/will run its analysis/g)).toHaveLength(1)
  })
})

describe('ClaudeScreen checkup progress', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A checkup that never answers, whose progress the test pushes. */
  function pendingCheckup(): {
    client: OnboardingClient
    push: (event: ClaudeCheckupProgress) => void
  } {
    const base = createMockOnboardingClient({ paceMs: 0 })
    let listener: (event: ClaudeCheckupProgress) => void = () => undefined
    const client: OnboardingClient = {
      ...base,
      runCheckup: () => new Promise(() => undefined),
      onCheckupProgress: (next) => {
        listener = next
        return () => undefined
      }
    }
    return { client, push: (event) => act(() => listener(event)) }
  }

  function screenFor(client: OnboardingClient): ReturnType<typeof render> {
    return render(
      <ClaudeScreen
        client={client}
        onAnnounce={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
        onChecked={() => undefined}
        onAnthropic={() => Promise.resolve({ error: null, hint: null })}
      />
    )
  }

  function rowOf(view: ReturnType<typeof render>, title: string): HTMLElement {
    const rows = view.getAllByRole('listitem')
    const found = rows.find((row) => row.textContent?.startsWith(title))
    if (!found) throw new Error(`no row ${title}`)
    return found
  }

  it('spins the running row with its words and a live timer; later rows wait', () => {
    vi.useFakeTimers()
    const { client, push } = pendingCheckup()
    const view = screenFor(client)
    const card = view.getByRole('region', { name: 'Claude Code checks' })
    expect(card.getAttribute('aria-busy')).toBe('true')
    expect(card.querySelector('.ui-busy-bar')).not.toBeNull()

    push({ phase: 'binary', state: 'running', detail: 'Looking for Claude Code…', nextStep: null })
    const binary = rowOf(view, 'Claude Code installed')
    expect(within(binary).getByRole('img', { name: 'Checking' }).className).toContain('is-running')
    expect(binary.textContent).toContain('Checking the Claude Code program')
    expect(binary.textContent).not.toContain('Checking…')
    for (const title of ['Logged in', 'Test reply']) {
      const row = rowOf(view, title)
      expect(row.getAttribute('data-state')).toBe('waiting')
      expect(row.querySelector('.ui-busy-mark.is-waiting')).not.toBeNull()
      expect(row.textContent).toContain('Waiting')
    }

    push({ phase: 'binary', state: 'ok', detail: '/usr/local/bin/claude', nextStep: null })
    push({ phase: 'login', state: 'ok', detail: 'Logged in', nextStep: null })
    push({ phase: 'roundTrip', state: 'running', detail: 'Asking Claude…', nextStep: null })
    act(() => {
      vi.advanceTimersByTime(0)
    })
    const reply = rowOf(view, 'Test reply')
    expect(reply.querySelector('.ui-busy-label')?.textContent).toBe('Waiting for Claude’s reply')
    const time = reply.querySelector('.ui-busy-time')
    expect(time?.getAttribute('aria-hidden')).toBe('true')
    expect(time?.textContent).toBe('· 0 s · usually 5–10 s')
    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(time?.textContent).toBe('· 4 s · usually 5–10 s')
    // Done rows show their ✓ chip.
    expect(rowOf(view, 'Logged in').querySelector('.ui-busy-mark')).toBeNull()
    expect(rowOf(view, 'Logged in').textContent).toContain('OK')

    // Past twice the usual time it says so calmly and offers to check again.
    act(() => {
      vi.advanceTimersByTime(16_000)
    })
    expect(reply.textContent).toContain('Taking longer than usual…')
    expect(within(reply).getByRole('button', { name: 'Check again' })).toBeTruthy()
  })
})
