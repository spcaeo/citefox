import { afterEach, describe, expect, it } from 'vitest'
import type { AlertSettings } from '@shared/domain'
import type { CiteFoxApi, SaveEmailAccountRequest } from '@shared/ipc'
import { createLiveAlertsClient } from './client'
import { createMockAlertsClient } from './mock'
import { emptyAccountDraft, toSaveRequest } from './model'

const SECRET = 'placeholder-not-a-secret'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('alerts mock client', () => {
  it('drops the password and never returns it', async () => {
    const client = createMockAlertsClient()
    const saved = await client.saveAccount(request(SECRET))
    expect(saved.unavailable).toBeNull()
    expect(JSON.stringify(saved)).not.toContain(SECRET)
    expect(JSON.stringify(await client.getEmail())).not.toContain(SECRET)
    const kept = await client.saveAccount({ ...request(null), id: saved.value?.id ?? null })
    expect(kept.value?.id).toBe(saved.value?.id)
    expect(JSON.stringify(kept)).not.toContain(SECRET)
  })

  it('round-trips schedule, alerts, and the unencrypted warning is not a stored field', async () => {
    const client = createMockAlertsClient()
    const app = await client.updateApp({ checkWhenClosed: true })
    expect(app.value?.checkWhenClosed).toBe(true)
    const project = await client.updateProject({ projectId: 'textbolt', paused: true })
    expect(project.value?.paused).toBe(true)
    expect(project.value?.pagesDueToday).toBe(0)
    const alerts = await client.updateAlerts({
      projectId: 'textbolt',
      emailAfterCheck: true,
      emailTo: ['ops@textbolt.com'],
      monthlyPdfTo: 'client@example.com'
    })
    expect(alerts.value?.emailTo).toEqual(['ops@textbolt.com'])
    expect(alerts.value?.monthlyPdfTo).toBe('client@example.com')
    expect(JSON.stringify(alerts)).not.toContain('hooks.slack.com')
  })
})

describe('alerts live client', () => {
  it('calls email:getSettings and does not fall back to the sample', async () => {
    install({
      'email:getSettings': () =>
        Promise.reject(
          new Error("Error invoking remote method 'email:getSettings': Error: The engine is busy.")
        ),
      'schedule:getApp': () => Promise.reject(new Error('The engine is busy.'))
    })
    const client = createLiveAlertsClient()
    const email = await client.getEmail()
    expect(email.value).toBeNull()
    expect(email.unavailable?.reason).toBe('The engine is busy.')
    expect(JSON.stringify(email)).not.toContain('Error invoking remote method')
    expect(JSON.stringify(email)).not.toContain('you@textbolt.com')
  })

  it('strips a password that an error message echoes', async () => {
    install({
      'email:saveAccount': () => Promise.reject(new Error(`rejected ${SECRET}`))
    })
    const client = createLiveAlertsClient()
    const saved = await client.saveAccount(request(SECRET))
    expect(saved.value).toBeNull()
    expect(saved.unavailable?.reason).toBe('Something went wrong. Try again.')
    expect(JSON.stringify(saved)).not.toContain(SECRET)
  })

  it('sends email:test with the account id and the test recipient', async () => {
    const seen: unknown[] = []
    install({
      'email:test': (args) => {
        seen.push(args)
        return Promise.resolve({
          ok: true,
          host: 'smtp.gmail.com',
          testedAt: '2026-10-20T15:00:00.000Z',
          message: 'Test sent through smtp.gmail.com.',
          nextStep: null
        })
      }
    })
    const client = createLiveAlertsClient()
    const result = await client.testAccount({ id: 'acct-1', to: ' ops@example.com ' })
    await client.testAccount({ id: 'acct-1', to: '  ' })
    expect(seen).toEqual([{ id: 'acct-1', to: 'ops@example.com' }, { id: 'acct-1' }])
    expect(JSON.stringify(seen)).not.toContain(SECRET)
    expect(result.value?.ok).toBe(true)
  })

  it('reads and writes the monthly PDF recipient through alerts:get and alerts:update', async () => {
    const updates: unknown[] = []
    let stored: string | null = 'client@example.com'
    install({
      'alerts:get': (request) => Promise.resolve(settings(request.projectId, stored)),
      'alerts:update': (request) => {
        updates.push(request)
        if (request.monthlyPdfTo !== undefined) stored = request.monthlyPdfTo
        return Promise.resolve(settings(request.projectId, stored))
      }
    })
    const client = createLiveAlertsClient()
    const read = await client.getAlerts({ projectId: 'p1' })
    expect(read.value?.monthlyPdfTo).toBe('client@example.com')

    const saved = await client.updateAlerts({ projectId: 'p1', monthlyPdfTo: 'boss@example.com' })
    expect(saved.value?.monthlyPdfTo).toBe('boss@example.com')
    expect(updates[0]).toEqual({ projectId: 'p1', monthlyPdfTo: 'boss@example.com' })

    const cleared = await client.updateAlerts({ projectId: 'p1', monthlyPdfTo: '' })
    expect(updates[1]).toEqual({ projectId: 'p1', monthlyPdfTo: null })
    expect(cleared.value?.monthlyPdfTo).toBe('')

    await client.updateAlerts({ projectId: 'p1', desktop: false })
    expect(updates[2]).toEqual({ projectId: 'p1', desktop: false })
  })
})

function settings(projectId: string, monthlyPdfTo: string | null): AlertSettings {
  return {
    projectId,
    desktop: true,
    emailAfterCheck: false,
    emailAccountId: null,
    emailTo: [],
    slackEnabled: false,
    slackWebhookStored: false,
    monthlyClientPdf: true,
    monthlyPdfTo
  }
}

function request(password: string | null): SaveEmailAccountRequest {
  return toSaveRequest({
    ...emptyAccountDraft('gmail'),
    fromAddress: 'you@textbolt.com',
    username: 'you@textbolt.com',
    password: password ?? ''
  })
}

function install(api: Partial<CiteFoxApi>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { citefox: api }
  })
}
