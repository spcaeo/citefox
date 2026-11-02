// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudePauseInfo } from '@shared/ipc'
import type { AssistantClient } from '../../assistant/client'
import { TurnCard } from '../../assistant/drawer/TurnCard'
import { ClaudeWait } from './ClaudeWait'
import { LinkedText } from './LinkedText'
import { apiKeyHash, screenHash } from './screenLinks'
import type { ClaudePauseSource } from './source'
import { useClaudePause } from './useClaudePause'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.location.hash = ''
  delete (window as { citefox?: unknown }).citefox
})

const PAUSE: ClaudePauseInfo = {
  until: '2026-11-01T11:02:00.000Z',
  resetsAt: '2026-11-01T11:00:00.000Z',
  kind: 'weekly',
  availableAgain: 'Sunday, Nov 1 at 7:00 AM',
  hasApiKey: false
}

const LIMIT =
  "You've reached your weekly CiteFox AI usage limit. It resets Sunday, Nov 1 at 7:00 AM. Work already done is kept. You can wait, add an Anthropic API key in Connections and keys, or carry on with the steps that don't need AI."

/** A pause main can lift, with the change event the window hears. */
function fakeSource(start: ClaudePauseInfo | null): {
  source: ClaudePauseSource
  set: (next: ClaudePauseInfo | null) => void
  calls: () => number
} {
  let current = start
  let reads = 0
  const listeners = new Set<() => void>()
  return {
    source: {
      get: async () => {
        reads += 1
        return current
      },
      onChange: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    set: (next) => {
      current = next
      for (const listener of listeners) listener()
    },
    calls: () => reads
  }
}

function Probe({ active, source }: { active: boolean; source: ClaudePauseSource }): JSX.Element {
  const pause = useClaudePause(active, 'p1', source)
  return <p data-testid="probe">{pause ? pause.availableAgain : 'ready'}</p>
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('screen names in CiteFox AI messages are links', () => {
  it('"Connections and keys" opens Connections; "Settings › Connections" opens that tab', () => {
    const view = render(
      <p>
        <LinkedText
          text={`${LIMIT} Or check Settings › Connections. Renew at claude.ai (Settings › Billing).`}
        />
      </p>
    )
    expect(view.getByRole('link', { name: 'Connections and keys' }).getAttribute('href')).toBe(
      '#/connections'
    )
    expect(view.getByRole('link', { name: 'Settings › Connections' }).getAttribute('href')).toBe(
      '#/settings?tab=connections'
    )
    expect(view.getAllByRole('link')).toHaveLength(2)
    expect(view.container.textContent).toContain('(Settings › Billing).')
  })

  it('during setup both go to the "Connect an AI" step', () => {
    expect(screenHash('Connections and keys', '#/setup/read')).toBe('#/setup/claude')
    expect(screenHash('Settings › Connections', '#/welcome')).toBe('#/setup/claude')
    expect(apiKeyHash('#/topics')).toBe('#/connections')
    window.location.hash = '#/setup/questions'
    const view = render(<LinkedText text={LIMIT} />)
    expect(view.getByRole('link').getAttribute('href')).toBe('#/setup/claude')
  })

  it('text with no screen name stays plain', () => {
    const view = render(<LinkedText text="CiteFox AI is busy right now." />)
    expect(view.queryByRole('link')).toBeNull()
    expect(view.container.textContent).toBe('CiteFox AI is busy right now.')
  })
})

describe('ClaudeWait', () => {
  it('is a disabled "Available again" with the API key way when there is no key', () => {
    const view = render(<ClaudeWait pause={PAUSE} />)
    const wait = view.getByRole('button', { name: 'Available again Sunday, Nov 1 at 7:00 AM' })
    expect((wait as HTMLButtonElement).disabled).toBe(true)
    expect(view.getByRole('link', { name: 'Use an API key instead' }).getAttribute('href')).toBe(
      '#/connections'
    )
  })

  it('leaves out the API key way when a key is already there', () => {
    const view = render(<ClaudeWait pause={{ ...PAUSE, hasApiKey: true }} look="link" />)
    expect(view.getByTestId('claude-wait').hasAttribute('disabled')).toBe(true)
    expect(view.queryByRole('link')).toBeNull()
  })
})

describe('useClaudePause', () => {
  it('reads nothing while no error is on screen', async () => {
    const fake = fakeSource(PAUSE)
    const view = render(<Probe active={false} source={fake.source} />)
    await settle()
    expect(view.getByTestId('probe').textContent).toBe('ready')
    expect(fake.calls()).toBe(0)
  })

  it('follows main: paused, then lifted early', async () => {
    const fake = fakeSource(PAUSE)
    const view = render(<Probe active source={fake.source} />)
    await settle()
    expect(view.getByTestId('probe').textContent).toBe('Sunday, Nov 1 at 7:00 AM')
    act(() => fake.set(null))
    await settle()
    expect(view.getByTestId('probe').textContent).toBe('ready')
  })

  it('comes back by itself when the pause runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'))
    const fake = fakeSource(PAUSE)
    const view = render(<Probe active source={fake.source} />)
    await settle()
    expect(view.getByTestId('probe').textContent).toBe('Sunday, Nov 1 at 7:00 AM')
    // Main ends the pause at `until`; the next read finds none.
    fake.source.get = async () => null
    await act(async () => {
      vi.advanceTimersByTime(62 * 60_000 + 1000)
      await Promise.resolve()
    })
    await settle()
    expect(view.getByTestId('probe').textContent).toBe('ready')
  })
})

describe('the Ask drawer while CiteFox AI is paused', () => {
  function bridge(start: ClaudePauseInfo | null): (next: ClaudePauseInfo | null) => void {
    let current = start
    const listeners = new Set<() => void>()
    ;(window as { citefox?: unknown }).citefox = {
      'claudeCode:getPause': async () => current,
      'claudeCode:pauseChanged': (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    return (next) => {
      current = next
      for (const listener of listeners) listener()
    }
  }

  it('shows when CiteFox AI is back instead of a Try again that would fail, then gives it back', async () => {
    const lift = bridge(PAUSE)
    const retry = vi.fn()
    const view = render(
      <ul>
        <TurnCard
          turn={{
            id: 't1',
            question: 'Which questions lost us?',
            where: 'Topics',
            status: 'error',
            answer: null,
            error: LIMIT
          }}
          projectId="p1"
          client={{} as AssistantClient}
          onRetry={retry}
        />
      </ul>
    )
    await settle()
    expect(view.queryByRole('button', { name: 'Try again' })).toBeNull()
    const wait = view.getByRole('button', { name: /Available again Sunday, Nov 1 at 7:00 AM/ })
    expect((wait as HTMLButtonElement).disabled).toBe(true)
    expect(view.getByRole('link', { name: 'Connections and keys' }).getAttribute('href')).toBe(
      '#/connections'
    )
    expect(view.getByRole('link', { name: /Use an API key instead/ })).toBeTruthy()

    act(() => lift(null))
    await settle()
    view.getByRole('button', { name: /Try again/ }).click()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(view.queryByText(/Available again/)).toBeNull()
  })
})
