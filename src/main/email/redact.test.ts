import { describe, expect, test } from 'vitest'
import { EmailError } from './errors'
import { SmtpTransportError } from './transport'
import { PASSWORD, accountBody, emailHarness } from './harness'
import type { SecretStore } from '../secrets/secret-store'

describe('secret redaction', () => {
  test('passwords and tokens are removed from logs and errors', async () => {
    const { service, ports, lines } = emailHarness()
    const saved = service.saveAccount(accountBody())
    ports.transport.failure = new SmtpTransportError(
      `auth failed ${PASSWORD} Bearer quilt-token smtp_password=${PASSWORD}`,
      'auth',
      535
    )
    const result = await service.testAccount({ id: saved.id })
    const blob = `${JSON.stringify(result)}\n${lines.join('\n')}\n${JSON.stringify(service.listDeliveries())}`
    expect(blob).not.toContain(PASSWORD)
    expect(blob).not.toContain('quilt-token')
    expect(blob).toContain('[REDACTED]')
    expect(result.message).toBe('Authentication failed (535).')
    expect(ports.transport.sent).toHaveLength(0)
    expect(ports.transport.attempts).toBe(1)
  })

  test('a keychain error that echoes the password is redacted', () => {
    const secrets: SecretStore = {
      set() {
        throw new Error(`could not store ${PASSWORD}`)
      },
      get() {
        return null
      },
      delete() {
        return undefined
      }
    }
    const { service } = emailHarness({ secrets })
    expect(() => service.saveAccount(accountBody())).toThrow(EmailError)
    try {
      service.saveAccount(accountBody())
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EmailError)
      const message = error instanceof Error ? error.message : ''
      expect(message).not.toContain(PASSWORD)
      expect(message).toContain('[REDACTED]')
    }
  })

  test('a successful send log does not include the password the transport received', async () => {
    const { service, ports, lines } = emailHarness()
    service.saveAccount(accountBody())
    service.updateAlerts({
      projectId: 'proj-1',
      emailAfterCheck: true,
      emailTo: ['ada@example.com']
    })
    await service.notifyCheckFinished({
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [
        {
          failed: false,
          notice: {
            jobId: 'job-1',
            projectId: 'proj-1',
            pageId: 'page-1',
            pageLabel: 'Alerts',
            marketId: 'us',
            pageCited: 1,
            aiosShown: 1,
            pageCitedChange: 0,
            score: 1,
            scoreChange: 0,
            contentChanged: false
          }
        }
      ]
    })
    expect(ports.transport.sent[0]?.auth.password).toBe(PASSWORD)
    expect(lines.join('\n')).not.toContain(PASSWORD)
  })
})

describe('production webhook wiring', () => {
  test('engine email uses the HTTP webhook transport, not the unconfigured stand-in', async () => {
    const { defaultEngineWebhookTransport } = await import('./engine-email')
    const transport = defaultEngineWebhookTransport()
    await expect(transport.post('https://example.com/hook', '{}')).rejects.toThrow(
      /hooks\.slack\.com/
    )
  })
})
