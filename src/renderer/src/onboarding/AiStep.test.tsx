// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunClaudeCheckupRequest } from '@shared/ipc'
import type { OnboardingClient } from './client'
import { ClaudeScreen } from './ClaudeScreen'
import { createMockOnboardingClient } from './mockClient'

afterEach(cleanup)

function renderStep(client: OnboardingClient): ReturnType<typeof render> {
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

function recordingClient(): OnboardingClient & {
  checkups: RunClaudeCheckupRequest[]
  patches: Parameters<OnboardingClient['updateSettings']>[0][]
} {
  const base = createMockOnboardingClient({ paceMs: 0 })
  const checkups: RunClaudeCheckupRequest[] = []
  const patches: Parameters<OnboardingClient['updateSettings']>[0][] = []
  return {
    ...base,
    checkups,
    patches,
    runCheckup: (request) => {
      checkups.push(request)
      return base.runCheckup(request)
    },
    updateSettings: (patch) => {
      patches.push(patch)
      return base.updateSettings(patch)
    }
  }
}

describe('onboarding AI step', () => {
  it('starts on Claude Code and checks it', async () => {
    const client = recordingClient()
    const view = renderStep(client)
    const group = view.getByRole('radiogroup', { name: 'Which AI CiteFox uses' })
    expect(
      (within(group).getByRole('radio', { name: /Claude Code/ }) as HTMLInputElement).checked
    ).toBe(true)
    await waitFor(() => {
      expect(view.container.querySelector('.panel-ok')).not.toBeNull()
    })
    expect(view.getByRole('heading', { level: 1, name: 'Check Claude Code' })).toBeTruthy()
    expect(view.getByRole('region', { name: 'Claude Code checks' })).toBeTruthy()
    expect(client.checkups).toHaveLength(1)
  })

  it('choosing Codex saves it, checks Codex, and every check names Codex', async () => {
    const client = recordingClient()
    const view = renderStep(client)
    await waitFor(() => {
      expect(view.container.querySelector('.panel-ok')).not.toBeNull()
    })
    fireEvent.click(within(view.getByTestId('ai-codex')).getByRole('radio'))
    await waitFor(() => {
      expect(client.checkups.at(-1)?.provider).toBe('codex')
    })
    expect(client.patches).toContainEqual({ claudeProvider: 'codex' })
    await waitFor(() => {
      expect(view.container.querySelector('.panel-ok')).not.toBeNull()
    })
    expect(view.getByRole('heading', { level: 1, name: 'Check Codex' })).toBeTruthy()
    const checks = view.getByRole('region', { name: 'Codex checks' })
    expect(checks.textContent).toContain('Codex installed')
    expect(checks.textContent).not.toMatch(/claude/i)
    expect(view.getByText(/Runs on your ChatGPT plan/)).toBeTruthy()
    expect((await client.getSettings()).settings.claudeProvider).toBe('codex')
  })

  it('opens on Codex when Settings already chose it', async () => {
    const base = createMockOnboardingClient({ paceMs: 0 })
    await base.updateSettings({ claudeProvider: 'codex' })
    const runCheckup = vi.fn(base.runCheckup)
    const view = renderStep({ ...base, runCheckup })
    await waitFor(() => {
      expect(view.container.querySelector('.panel-ok')).not.toBeNull()
    })
    expect(
      (within(view.getByTestId('ai-codex')).getByRole('radio') as HTMLInputElement).checked
    ).toBe(true)
    expect(view.getByRole('region', { name: 'Codex checks' }).textContent).not.toMatch(/claude/i)
  })
})
