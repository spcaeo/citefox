import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PASSWORD } from '../email/harness'
import { startSmtpTestServer } from '../email/smtp-test-server.test-helper'
import type { SmtpSendRequest } from '../email/transport'
import { createLogger } from '../logging/logger'
import { MemorySecretStore } from '../secrets/secret-store'
import { createHeadlessReportsPort } from './reports-port'

describe('createHeadlessReportsPort', () => {
  test('returns the keychain store, the logger, and a copy of the redacted values', () => {
    const secrets = new MemorySecretStore()
    const lines: string[] = []
    const logger = createLogger({
      write: (_level, line) => {
        lines.push(line)
      },
      secrets: () => [PASSWORD]
    })
    const redacted = [PASSWORD]
    const port = createHeadlessReportsPort({ secrets, logger, redacted })
    redacted.push('later-secret')

    expect(port.secrets).toBe(secrets)
    expect(port.logger).toBe(logger)
    expect(port.redacted).toEqual([PASSWORD])
    expect(lines.join('\n')).not.toContain(PASSWORD)
  })

  test('omits redacted when the caller has no values to mask', () => {
    const port = createHeadlessReportsPort({
      secrets: new MemorySecretStore(),
      logger: createLogger({ write: () => undefined })
    })
    expect(port.redacted).toBeUndefined()
  })

  test('the production SMTP sender delivers one message to the in-process server', async () => {
    const server = await startSmtpTestServer({
      mode: 'none',
      username: 'mailer',
      password: PASSWORD
    })
    try {
      const lines: string[] = []
      const port = createHeadlessReportsPort({
        secrets: new MemorySecretStore(),
        logger: createLogger({
          write: (_level, line) => {
            lines.push(line)
          },
          secrets: () => [PASSWORD]
        }),
        redacted: [PASSWORD]
      })
      await port.transport.send(sample(server.port))
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.raw).toContain('Subject: Weekly report')
      expect(server.mails[0]?.raw).not.toContain(PASSWORD)
      expect(lines.join('\n')).not.toContain(PASSWORD)
    } finally {
      await server.close()
    }
  })

  test('uses the production SMTP sender and the packaged entry passes that port', () => {
    const source = readFileSync(new URL('./reports-port.ts', import.meta.url), 'utf8')
    expect(source).toContain('createNodemailerTransport()')
    expect(source.includes("from 'electron'")).toBe(false)
    expect(source.includes('smtp-test-server')).toBe(false)
    expect(source.includes('MemorySmtpTransport')).toBe(false)
    const main = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const imported = main.slice(0, main.indexOf("} from './headless'"))
    expect(imported).toContain('createHeadlessReportsPort')
    const run = main.indexOf('runCheckDueCommand({')
    const call = main.slice(run, main.indexOf('} catch (error: unknown) {', run))
    expect(call).toContain('reports: createHeadlessReportsPort({')
    expect(call).toContain('secrets,')
    expect(call).toContain('redacted: appSecretRegistry().list()')
  })
})

function sample(port: number): SmtpSendRequest {
  return {
    auth: {
      host: '127.0.0.1',
      port,
      security: 'none',
      username: 'mailer',
      password: PASSWORD
    },
    message: {
      fromName: 'CiteFox',
      fromAddress: 'reports@example.com',
      replyTo: null,
      to: ['client@example.com'],
      subject: 'Weekly report',
      text: 'Score 40',
      attachment: null
    }
  }
}
