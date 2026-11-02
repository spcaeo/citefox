// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSX } from 'react'
import type { CiteFoxApi } from '@shared/ipc'
import { AlertsScreen } from './AlertsScreen'
import { AppCheckTiming, AppEmailAccounts, ProjectRecheck } from './homes'
import { alertsTabFor } from './tabs'
import { createLiveAlertsClient, type AlertsClient } from './client'
import { createMockAlertsClient } from './mock'
import { createMemoryRulesClient } from './rules/rulesClient'
import { UNENCRYPTED_MAIL_WARNING, type EmailAccountRow } from './model'

const SECRET = 'placeholder-not-a-secret'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'citefox')
})

describe('schedule, check timing and notifications, each in its one home', () => {
  const others = [
    { projectId: 'harbor', name: 'Harbor Dental', intervalDays: 30, time: '06:00', paused: false },
    { projectId: 'north', name: 'Northwind', intervalDays: 7, time: '07:30', paused: true }
  ]

  it('Check timing shows the app-wide switches', async () => {
    const view = render(<AppCheckTiming client={createMockAlertsClient()} />)
    const body = within(view.container)
    const login = await body.findByRole('switch', {
      name: 'Start CiteFox at login and keep it in the tray'
    })
    expect(login.getAttribute('aria-checked')).toBe('true')
    expect(
      body.getByText(/every hour while CiteFox is closed\. Turning this off removes it\./)
    ).toBeTruthy()
  })

  it('Re-check shows the cadence, the pages due and the note on every project', async () => {
    const view = render(
      <ProjectRecheck
        client={createMockAlertsClient()}
        projectId="textbolt"
        projectName="TextBolt"
        projectSchedules={others}
        timeZone="America/Chicago"
        now={new Date('2026-10-20T15:00:00.000Z')}
      />
    )
    const body = within(view.container)
    expect(await body.findByRole('radio', { name: /Every 14 days/ })).toBeTruthy()
    expect(body.getByRole('radio', { name: /Every 30 days/ })).toBeTruthy()
    const due = await body.findByRole('button', {
      name: '14 pages due at the next check: list them'
    })
    expect(due.closest('strong')?.textContent).toMatch(/14 pages due/)
    expect(due.querySelector('[data-nfr-figure="due:next"]')?.textContent).toBe('14')
    const note = body.getByText(/each project runs on its own schedule/)
    expect(note.textContent).toMatch(/TextBolt every 14 days at 0?9:00/)
    expect(note.textContent).toMatch(/Harbor Dental every 30 days at 0?6:00/)
    expect(note.textContent).toContain('Northwind paused')
    expect(note.textContent).not.toContain('Acme Clinics')
    fireEvent.click(body.getByRole('radio', { name: /Every 30 days/ }))
    await waitFor(() => {
      expect(body.getByText(/then each page 30 days after its last check/)).toBeTruthy()
    })
    fireEvent.click(body.getByRole('switch', { name: 'Pause all checks for this project' }))
    await waitFor(() => {
      expect(body.getByText('None while this project is paused')).toBeTruthy()
    })
  })

  it('Alerts keeps only Alert rules, Notifications and Alert log', async () => {
    const view = render(
      <AlertsScreen
        rulesClient={createMemoryRulesClient()}
        client={createMockAlertsClient()}
        projectId="textbolt"
        projectName="TextBolt"
        focus="notifications"
      />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByRole('heading', { level: 1, name: 'Alerts & schedules' })).toBeTruthy()
    })
    const tabs = await body.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Alert rules',
      'Notifications',
      'Alert log'
    ])
    expect(
      body.getByRole('switch', {
        name: 'Desktop notification when a check finishes or a page gains or loses a citation'
      })
    ).toBeTruthy()
    fireEvent.click(body.getByRole('switch', { name: 'Email a summary after each check' }))
    await waitFor(() => {
      expect(body.getByLabelText('Email to')).toBeTruthy()
    })
    expect(view.container.textContent).not.toContain(SECRET)
  })
})

describe('SMTP email settings', () => {
  it('shows an inline warning linked to Security when security is none', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByLabelText('Security')).toBeTruthy()
    })
    const security = body.getByLabelText('Security')
    expect(security.getAttribute('aria-describedby')).toBeNull()
    expect(body.queryByText(UNENCRYPTED_MAIL_WARNING)).toBeNull()
    fireEvent.change(security, { target: { value: 'none' } })
    const warning = body.getByText(UNENCRYPTED_MAIL_WARNING)
    expect(warning.id).toBe('e-sec-warn')
    expect(security.getAttribute('aria-describedby')).toBe('e-sec-warn')
    fireEvent.change(security, { target: { value: 'starttls' } })
    expect(body.queryByText(UNENCRYPTED_MAIL_WARNING)).toBeNull()
    expect(security.getAttribute('aria-describedby')).toBeNull()
    expect(body.getByLabelText('App Password').getAttribute('type')).toBe('password')
  })

  it('keeps the password masked and out of the account list', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByLabelText('App Password')).toBeTruthy()
    })
    const password = body.getByLabelText('App Password')
    fireEvent.change(password, { target: { value: SECRET } })
    expect(password.getAttribute('type')).toBe('password')
    fireEvent.click(body.getByRole('button', { name: 'Show password' }))
    expect(password.getAttribute('type')).toBe('text')
    fireEvent.click(body.getByRole('button', { name: 'Hide password' }))
    expect(password.getAttribute('type')).toBe('password')
    fireEvent.click(body.getByRole('button', { name: 'Cancel' }))
    expect((password as HTMLInputElement).value).toBe('')
    expect(view.container.textContent).not.toContain(SECRET)
  })

  it('opens the remove dialog, focuses Cancel, and closes on Escape', async () => {
    const view = render(emailScreen())
    const body = within(view.container)
    fireEvent.click(await body.findByRole('button', { name: 'Actions for you@textbolt.com' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Remove Gmail account' }))
    const dialog = body.getByRole('alertdialog', { name: 'Remove this sending account?' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    await waitFor(() => {
      expect(document.activeElement).toBe(cancel)
    })
    expect(dialog.textContent).toContain('you@textbolt.com')
    expect(dialog.textContent).not.toContain(SECRET)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => {
      expect(body.queryByRole('alertdialog')).toBeNull()
    })
  })

  it('virtualizes 2,000 sending accounts', async () => {
    const started = performance.now()
    const view = render(
      <AppEmailAccounts client={manyAccounts(2000)} activeProjectId="textbolt" timeZone="UTC" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(
        body.getByRole('grid', { name: 'Sending accounts' }).getAttribute('aria-rowcount')
      ).toBe('2001')
    })
    const shown = view.container.textContent?.match(/person\d+@example.com/g) ?? []
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(40)
    expect(performance.now() - started).toBeLessThan(300)
  })

  it('shows no sample accounts when the email channel fails', async () => {
    install({
      'schedule:getApp': () => Promise.reject(new Error('The engine is busy.')),
      'schedule:getProject': () => Promise.reject(new Error('The engine is busy.')),
      'alerts:get': () => Promise.reject(new Error('The engine is busy.')),
      'email:getSettings': () =>
        Promise.reject(
          new Error("Error invoking remote method 'email:getSettings': Error: The engine is busy.")
        )
    })
    const view = render(
      <AppEmailAccounts client={createLiveAlertsClient()} activeProjectId="harbor" />
    )
    const body = within(view.container)
    await waitFor(() => {
      expect(body.getByRole('alert').textContent).toContain('The engine is busy.')
    })
    expect(view.container.textContent).not.toContain('you@textbolt.com')
    expect(view.container.textContent).not.toContain('Error invoking remote method')
    expect(body.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('loads again on Try again after a failed load', async () => {
    const base = createMockAlertsClient()
    let appCalls = 0
    const flaky: AlertsClient = {
      ...base,
      getEmail: () => {
        appCalls += 1
        return appCalls === 1
          ? Promise.resolve({
              value: null,
              unavailable: { reason: 'The engine is busy.', nextStep: null }
            })
          : base.getEmail()
      }
    }
    const view = render(
      <AlertsScreen
        rulesClient={createMemoryRulesClient()}
        client={flaky}
        projectId="textbolt"
        projectName="TextBolt"
      />
    )
    const body = within(view.container)
    fireEvent.click(await body.findByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(body.queryByRole('alert')).toBeNull()
    })
    expect(appCalls).toBe(2)
    expect(body.getByRole('heading', { level: 1, name: 'Alerts & schedules' })).toBeTruthy()
  })
})

describe('schedule and alerts tabs', () => {
  it('opens the tab named by the route and falls back to Alert rules', () => {
    expect(alertsTabFor('notifications')).toBe('notifications')
    expect(alertsTabFor('log')).toBe('log')
    expect(alertsTabFor(undefined)).toBe('rules')
    expect(alertsTabFor('nonsense')).toBe('rules')
    // An older `#/alerts?tab=log` link still opens its tab; the path wins.
    expect(alertsTabFor(undefined, 'log')).toBe('log')
    expect(alertsTabFor('notifications', 'log')).toBe('notifications')
    expect(alertsTabFor(undefined, 'nope')).toBe('rules')
  })

  it('a tab click on the alerts route moves the hash to that tab', async () => {
    window.location.hash = '#/alerts'
    const view = render(
      <AlertsScreen
        rulesClient={createMemoryRulesClient()}
        client={createMockAlertsClient()}
        projectId="textbolt"
        projectName="TextBolt"
      />
    )
    const body = within(view.container)
    fireEvent.click(await body.findByRole('tab', { name: 'Alert log' }))
    expect(window.location.hash).toBe('#/alerts/log')
    fireEvent.click(body.getByRole('tab', { name: 'Notifications' }))
    expect(window.location.hash).toBe('#/alerts/notifications')
    fireEvent.click(body.getByRole('tab', { name: 'Alert rules' }))
    expect(window.location.hash).toBe('#/alerts')
    window.location.hash = ''
  })
})

function emailScreen(): JSX.Element {
  return (
    <AppEmailAccounts client={createMockAlertsClient()} activeProjectId="textbolt" timeZone="UTC" />
  )
}

function manyAccounts(count: number): AlertsClient {
  const base = createMockAlertsClient()
  const accounts: EmailAccountRow[] = Array.from({ length: count }, (_, index) => ({
    id: `acct-${index}`,
    provider: 'other',
    fromName: 'CiteFox reports',
    fromAddress: `person${index}@example.com`,
    replyTo: null,
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: `person${index}@example.com`,
    keychainRef: `email/acct-${index}`,
    isDefault: index === 0,
    lastTestAt: null,
    lastTestOk: null,
    lastTestMessage: null,
    lastTestNextStep: null,
    usedFor: null
  }))
  return {
    ...base,
    async getEmail() {
      return { value: { mode: 'smtp' as const, accounts }, unavailable: null }
    }
  }
}

function install(api: Partial<CiteFoxApi>): void {
  Object.defineProperty(window, 'citefox', { configurable: true, value: api })
}
