// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { JSX, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockOnboardingClient, type MockScenario } from '../onboarding/mockClient'
import { SuggestionCard } from '../ui'
import { axeViolations } from '../ui/axe.test-helper'
import { createMockPermissionsClient } from './mock'
import { PermissionsPanel } from './PermissionsPanel'
import { PermissionsProvider } from './PermissionsProvider'
import { PermissionsScreen } from './PermissionsScreen'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '#/')
})

/** The onboarding mock and the permissions mock on top of it: no OS, no IPC. */
function setup(scenario: MockScenario = 'success'): {
  wrap: (node: ReactNode) => JSX.Element
  onboarding: ReturnType<typeof createMockOnboardingClient>
} {
  const onboarding = createMockOnboardingClient({
    scenario: () => scenario,
    paceMs: 0,
    wait: () => Promise.resolve()
  })
  const client = createMockPermissionsClient(onboarding, { platform: 'darwin' })
  return {
    onboarding,
    wrap: (node) => <PermissionsProvider client={client}>{node}</PermissionsProvider>
  }
}

describe('What CiteFox needs', () => {
  it('lists every item by need with its live state, and is accessible', async () => {
    const { wrap } = setup()
    const view = render(wrap(<PermissionsPanel variant="review" onSetup={() => undefined} />))
    await view.findByText(/of 9 ready/)
    for (const group of ['Required', 'Optional', 'Only if used']) {
      expect(view.getByRole('region', { name: group })).toBeTruthy()
    }
    expect(view.getByText('Claude Code')).toBeTruthy()
    expect(view.getByText('Not checked yet')).toBeTruthy()
    expect(view.getByText('macOS Keychain')).toBeTruthy()
    expect(view.getByText('Notifications')).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('says what the system will show before an action that asks it, and acts only on Continue', async () => {
    const { wrap } = setup()
    const view = render(wrap(<PermissionsPanel variant="review" onSetup={() => undefined} />))
    const turnOn = await view.findByRole('button', { name: 'Turn on: Notifications' })
    fireEvent.click(turnOn)
    expect(view.getByText(/would like to send you notifications/)).toBeTruthy()
    expect(view.getByText(/Before you continue/)).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    await view.findByText('Notifications are on. A test note was sent.')
    const row = view.container.querySelector('[data-permission="notifications"]')
    expect(row?.getAttribute('data-state')).toBe('ok')
  })

  it('a "set up" action opens its place; hidden where that screen is not reachable', async () => {
    const { wrap } = setup()
    const onSetup = vi.fn()
    const view = render(
      wrap(
        <PermissionsPanel variant="compact" onSetup={onSetup} canSetup={(id) => id === 'serpapi'} />
      )
    )
    fireEvent.click(await view.findByRole('button', { name: 'Add key: SerpApi key' }))
    expect(onSetup).toHaveBeenCalledWith('serpapi')
    expect(view.queryByRole('button', { name: 'Set up: Email (SMTP)' })).toBeNull()
  })

  it('the suggestion card footer says whether CiteFox AI works and updates after a checkup', async () => {
    const { wrap } = setup()
    const view = render(
      wrap(
        <>
          <SuggestionCard
            title="Explain this change"
            footnote="CiteFox AI · about 6 s"
            onClose={() => undefined}
          />
          <PermissionsPanel variant="compact" onSetup={() => undefined} title="Needs" />
        </>
      )
    )
    await view.findByText('CiteFox AI: not checked')
    fireEvent.click(await view.findByRole('button', { name: 'Check Claude Code: Claude Code' }))
    await view.findByText('CiteFox AI: connected', undefined, { timeout: 3000 })
  })
})

describe('Settings › What CiteFox needs', () => {
  it('shows the list grid and the open item, asking before a system prompt', async () => {
    const { wrap } = setup()
    const navigate = vi.fn()
    const view = render(wrap(<PermissionsScreen focusId="loginItem" navigate={navigate} />))
    await view.findByRole('heading', { name: 'Open at login', level: 2 })
    expect(view.getByText(/Login Item Added/)).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
    // Rows carry no buttons: the action is in the row's ⋯ menu.
    fireEvent.click(view.getByRole('button', { name: 'Actions for Open at login' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Turn on' }))
    expect(navigate).toHaveBeenCalledWith('#/permissions/loginItem')
    await view.findByText(/Before you continue/)
    fireEvent.click(view.getByRole('button', { name: 'Continue' }))
    await view.findAllByText('CiteFox now opens at login.')
  })

  it('keeps the Show filter in the URL and opens it from a link', async () => {
    window.history.replaceState(null, '', '#/permissions/loginItem')
    const { wrap } = setup()
    const navigate = vi.fn()
    const first = render(wrap(<PermissionsScreen focusId="loginItem" navigate={navigate} />))
    await first.findByRole('heading', { name: 'Open at login', level: 2 })
    fireEvent.click(first.getByRole('button', { name: 'Ready' }))
    await waitFor(() => expect(window.location.hash).toBe('#/permissions/loginItem?show=ready'))
    fireEvent.click(first.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(window.location.hash).toBe('#/permissions/loginItem'))
    cleanup()
    window.history.replaceState(null, '', '#/permissions/loginItem?show=todo')
    const again = render(wrap(<PermissionsScreen focusId="loginItem" navigate={navigate} />))
    await again.findByRole('heading', { name: 'Open at login', level: 2 })
    expect(again.getByRole('button', { name: 'Needs a step' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('keeps the grid search and sort on the URL too', async () => {
    window.history.replaceState(null, '', '#/permissions/loginItem')
    const { wrap } = setup()
    const view = render(wrap(<PermissionsScreen focusId="loginItem" navigate={vi.fn()} />))
    await view.findByRole('heading', { name: 'Open at login', level: 2 })
    fireEvent.change(view.getByRole('searchbox'), { target: { value: 'login' } })
    expect(window.location.hash).toBe('#/permissions/loginItem?perm.q=login')
    fireEvent.change(view.getByRole('searchbox'), { target: { value: '' } })
    expect(window.location.hash).toBe('#/permissions/loginItem')
  })
})
