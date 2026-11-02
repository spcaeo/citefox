// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { ApiKeyMetadata } from '@shared/domain'
import { serpUsageSummary } from '../keys/serpUsage'
import { createMockOnboardingClient } from '../onboarding/mockClient'
import { createMockAlertsClient } from '../alerts/mock'
import { SettingsScreen } from './SettingsScreen'
import { draftFromSettings } from './validate'

afterEach(() => {
  cleanup()
  // The open tab lives in the hash; start each test on the default tab.
  window.location.hash = ''
})

function key(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k',
    provider: 'serpapi',
    name: 'My plan',
    keychainRef: 'ref',
    hint: 'ab12',
    rotationOrder: 1,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: { used: 1240, planLimit: 5000, plan: 'Developer' },
    ...patch
  }
}

const KEYS: ApiKeyMetadata[] = [
  key({ id: 'mine' }),
  key({
    id: 'backup',
    name: 'Backup',
    rotationOrder: 2,
    serpapiUsage: { used: 18, planLimit: 250, plan: null },
    state: 'warning',
    lastReason: 'rate_limited'
  }),
  key({ id: 'new', name: 'New key', rotationOrder: 3, state: 'unchecked', serpapiUsage: null })
]

const CHECKUP = {
  binaryPath: '/usr/local/bin/claude',
  version: '2.1.0',
  login: 'logged_in',
  plan: 'Claude Max',
  roundTrip: 'failed',
  durationMs: null,
  resolvedModel: null,
  ready: false,
  message: 'Claude Code did not answer.',
  nextStep: 'Run claude in a terminal.',
  rows: {
    binary: { state: 'ok', statusLabel: 'OK', detail: 'Found', nextStep: null },
    login: { state: 'ok', statusLabel: 'OK', detail: 'Logged in', nextStep: null },
    roundTrip: {
      state: 'warning',
      statusLabel: 'No answer',
      detail: 'Timed out',
      nextStep: 'Run claude in a terminal.'
    }
  }
} as const

async function renderScreen(): Promise<void> {
  const client = createMockOnboardingClient({ wait: () => Promise.resolve() })
  const snapshot = await client.getSettings()
  const overview = await client.getOverview()
  render(
    <SettingsScreen
      client={client}
      alertsClient={createMockAlertsClient()}
      overview={{ ...overview, keys: KEYS, serpapi: 'warning', claudeCheckup: CHECKUP }}
      settings={{ ...draftFromSettings(snapshot.settings, ''), userName: 'Rakesh' }}
      dataDirectory={snapshot.dataDirectory}
      onChanged={() => Promise.resolve()}
    />
  )
}

function drawer(): HTMLElement {
  return screen.getByRole('dialog')
}

function rows(): HTMLElement[] {
  return Array.from(drawer().querySelectorAll<HTMLElement>('[data-drill-row]'))
}

describe('Settings drill-downs', () => {
  test('"Used this month" adds up every counted key and opens them', async () => {
    await renderScreen()
    const summary = serpUsageSummary(KEYS)
    expect(summary).toMatchObject({ used: 1258, limit: 5250, counted: 2, keys: 3 })
    // No CiteFox cap: the figure is the SerpApi accounts', labelled as such.
    expect(screen.getByText('SerpApi account this month (all apps)')).toBeTruthy()
    const used = screen.getByRole('button', {
      name: /^1,258 of 5,250 used on the SerpApi account this month \(all apps\)/
    })
    expect(used.tagName).toBe('BUTTON')
    fireEvent.click(used)
    expect(rows()).toHaveLength(3)
    expect(drawer().textContent).toContain('1,258 of 5,250 used')
    const counted = within(drawer()).getByRole('button', { name: /Counted/ })
    expect(counted.textContent).toContain('2')
  })

  test('the Claude line opens the checkup', async () => {
    await renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Checkup details' }))
    expect(rows()).toHaveLength(3)
    expect(drawer().textContent).toContain('No answer')
  })
})
