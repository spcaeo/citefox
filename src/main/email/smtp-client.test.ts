import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SmtpSecurity } from '@shared/domain'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { Logger } from '../logging/logger'
import { MemorySecretStore } from '../secrets/secret-store'
import {
  closeDatabase,
  closeProjectDatabase,
  createProjectDatabase,
  insertProject,
  openAppDatabase,
  projectDatabaseRelativePath,
  type SqliteDatabase
} from '../storage'
import { MemoryDraftOpener } from './draft'
import { FIX_IN_EMAIL_SETUP } from './errors'
import { accountBody, notice, PASSWORD } from './harness'
import {
  createNodemailerTransport,
  plaintextLoginProblem,
  smtpConnectionConfig,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
  type SmtpClientOptions
} from './smtp-client'
import {
  citefoxSmtpTestSelfSigned,
  closedLocalPort,
  startSilentLocalServer,
  startSmtpTestServer,
  type SelfSignedFixture,
  type SmtpTestMode,
  type SmtpTestServer
} from './smtp-test-server.test-helper'
import { createEmailService, createMemoryEmailPorts, type EmailService } from './service'
import { createStorageEmailStores } from './storage-stores'
import { SmtpTransportError, type SmtpSendRequest, type SmtpTransport } from './transport'
import { translateSmtpFailure } from './translate'
import type { EmailClock } from './types'
import { MemoryWebhookTransport } from './webhook'

const USER = 'mailer'
const WHEN = '2026-02-04T12:00:00.000Z'
const BOUNDED: SmtpClientOptions = {
  connectionTimeoutMs: 5_000,
  greetingTimeoutMs: 5_000,
  socketTimeoutMs: 5_000
}
const QUICK: SmtpClientOptions = {
  connectionTimeoutMs: 1_000,
  greetingTimeoutMs: 1_000,
  socketTimeoutMs: 1_000
}

let fixture: SelfSignedFixture
const closers: Array<() => void> = []

beforeAll(() => {
  fixture = citefoxSmtpTestSelfSigned()
})

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('SMTP connection config', () => {
  test('FR-23.3 maps STARTTLS, implicit TLS, and plaintext, with validation on', () => {
    const auth = {
      host: '127.0.0.1',
      port: 587,
      security: 'starttls' as const,
      username: USER,
      password: PASSWORD
    }
    expect(smtpConnectionConfig(auth)).toMatchObject({
      host: '127.0.0.1',
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      logger: false,
      debug: false,
      transactionLog: false,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }
    })
    expect(smtpConnectionConfig(auth).tls?.ca).toBeUndefined()
    expect(smtpConnectionConfig({ ...auth, security: 'ssl' }, { ca: ['pem'] }).secure).toBe(true)
    expect(smtpConnectionConfig({ ...auth, security: 'ssl' }).requireTLS).toBe(false)
    expect(smtpConnectionConfig({ ...auth, security: 'ssl' }).tls).toMatchObject({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    })
    expect(smtpConnectionConfig({ ...auth, security: 'ssl' }, { ca: ['pem'] }).tls).toEqual({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ca: ['pem']
    })
    expect(smtpConnectionConfig({ ...auth, security: 'none' })).toMatchObject({
      secure: false,
      requireTLS: false,
      ignoreTLS: true
    })
    expect(smtpConnectionConfig({ ...auth, security: 'none' }).tls).toEqual({
      rejectUnauthorized: true
    })
  })
})

describe('SMTP security modes', () => {
  test('STARTTLS delivers only after the upgrade', async () => {
    await withServer('starttls', {}, async (server) => {
      const transport = createNodemailerTransport({ ...BOUNDED, ca: [fixture.certPem] })
      await transport.send(sample(server.port, 'starttls'))
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.secure).toBe(true)
      expect(server.mails[0]?.raw).toContain('Subject: Visibility')
      expect(server.mails[0]?.raw).toContain('reply@example.com')
      expect(server.mails[0]?.raw).toContain('report.csv')
      expect(server.mails[0]?.raw).toContain('Score 40')
      expect(server.accepted).toBe(1)
    })
  })

  test('implicit TLS delivers on a secure port', async () => {
    await withServer('ssl', {}, async (server) => {
      const transport = createNodemailerTransport({ ...BOUNDED, ca: [fixture.certPem] })
      await transport.send(sample(server.port, 'ssl'))
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.secure).toBe(true)
    })
  })

  test('None stays plaintext', async () => {
    await withServer('none', {}, async (server) => {
      const transport = createNodemailerTransport(BOUNDED)
      await transport.send(sample(server.port, 'none'))
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.secure).toBe(false)
    })
  })

  test('None does not upgrade when the server offers STARTTLS', async () => {
    await withServer('starttls-offered', {}, async (server) => {
      const transport = createNodemailerTransport(BOUNDED)
      await transport.send(sample(server.port, 'none'))
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.secure).toBe(false)
    })
  })

  test('STARTTLS required does not send when the server has no upgrade', async () => {
    await withServer('none', {}, async (server) => {
      const transport = createNodemailerTransport({ ...BOUNDED, ca: [fixture.certPem] })
      await expect(transport.send(sample(server.port, 'starttls'))).rejects.toBeInstanceOf(
        SmtpTransportError
      )
      expect(server.mails).toEqual([])
    })
  })
})

describe('SMTP certificate validation', () => {
  test('an untrusted self-signed certificate is rejected for implicit TLS', async () => {
    await withServer('ssl', {}, async (server) => {
      const transport = createNodemailerTransport(BOUNDED)
      await expect(transport.send(sample(server.port, 'ssl'))).rejects.toThrow(
        /certificate|self-signed|unable to verify/i
      )
      expect(server.mails).toEqual([])
      expect(server.accepted).toBe(0)
    })
  })

  test('an untrusted self-signed certificate is rejected for STARTTLS', async () => {
    await withServer('starttls', {}, async (server) => {
      const transport = createNodemailerTransport(BOUNDED)
      await expect(transport.send(sample(server.port, 'starttls'))).rejects.toThrow(
        /certificate|self-signed|unable to verify/i
      )
      expect(server.mails).toEqual([])
    })
  })

  test('the same certificate is accepted when the test trusts it', async () => {
    await withServer('ssl', {}, async (server) => {
      const transport = createNodemailerTransport({ ...BOUNDED, ca: [fixture.certPem] })
      await transport.send(sample(server.port, 'ssl'))
      expect(server.mails).toHaveLength(1)
      expect(server.accepted).toBe(1)
    })
  })
})

describe('SMTP failures', () => {
  test('a wrong password is an auth failure and the echoed secret is redacted', async () => {
    await withServer('none', { password: 'server-expects-other', echo: true }, async (server) => {
      const lines: string[] = []
      const transport = createNodemailerTransport(BOUNDED)
      try {
        await transport.send(sample(server.port, 'none'))
        throw new Error('expected auth failure')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SmtpTransportError)
        if (error instanceof SmtpTransportError) {
          expect(error.kind).toBe('auth')
          expect(error.smtpCode).toBe(535)
          expect(error.message).not.toContain(PASSWORD)
          expect(error.message).toContain('[REDACTED]')
        }
      }
      const { service } = memoryService(transport, lines)
      const saved = service.saveAccount(
        accountBody({ host: '127.0.0.1', port: server.port, security: 'none', username: USER })
      )
      const result = await service.testAccount({ id: saved.id })
      expect(result).toMatchObject({
        ok: false,
        message: 'Authentication failed (535).',
        nextStep: FIX_IN_EMAIL_SETUP
      })
      const blob = `${JSON.stringify(result)}\n${lines.join('\n')}\n${JSON.stringify(service.listDeliveries())}`
      expect(blob).not.toContain(PASSWORD)
      expect(blob).not.toContain(Buffer.from(PASSWORD).toString('base64'))
      expect(blob).toContain('[REDACTED]')
      expect(server.mails).toEqual([])
      expect(service.listDeliveries().some((row) => row.outcome === 'sent')).toBe(false)
    })
  })

  test('connection refused is classified and retried three times', async () => {
    const port = await closedLocalPort()
    const lines: string[] = []
    const { transport, attempts } = counting(createNodemailerTransport(QUICK))
    const { service } = memoryService(transport, lines)
    const saved = service.saveAccount(
      accountBody({ host: '127.0.0.1', port, security: 'none', username: USER })
    )
    const result = await service.testAccount({ id: saved.id })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(`Could not connect to 127.0.0.1:${port}: connection refused.`)
    expect(attempts()).toBe(3)
    expect(lines.join('\n')).not.toContain(PASSWORD)
    expect(service.listDeliveries().some((row) => row.outcome === 'sent')).toBe(false)
  })

  test('a silent peer hits the greeting timeout and is retried three times', async () => {
    const silent = await startSilentLocalServer()
    try {
      const lines: string[] = []
      const { transport, attempts } = counting(createNodemailerTransport(QUICK))
      const { service } = memoryService(transport, lines)
      const saved = service.saveAccount(
        accountBody({
          host: '127.0.0.1',
          port: silent.port,
          security: 'none',
          username: USER
        })
      )
      const result = await service.testAccount({ id: saved.id })
      expect(result.message).toBe('127.0.0.1 timed out.')
      expect(attempts()).toBe(3)
      expect(lines.join('\n')).not.toContain(PASSWORD)
      expect(service.listDeliveries().some((row) => row.outcome === 'sent')).toBe(false)
    } finally {
      await silent.close()
    }
  }, 20_000)
})

describe('alert send through the SMTP transport', () => {
  test('a check summary is sent once and the throttle is marked', async () => {
    await withServer('starttls', {}, async (server) => {
      const lines: string[] = []
      const transport = createNodemailerTransport({ ...BOUNDED, ca: [fixture.certPem] })
      const { db, service, secrets } = openStorage(transport, lines)
      const saved = service.saveAccount(
        accountBody({
          host: '127.0.0.1',
          port: server.port,
          security: 'starttls',
          username: USER
        })
      )
      expect(secrets.gets).toBe(0)
      service.updateAlerts({
        projectId: 'proj-1',
        emailAfterCheck: true,
        emailAccountId: saved.id,
        emailTo: ['ada@example.com']
      })
      const finished = {
        checkId: 'check-1',
        projectId: 'proj-1',
        projectName: 'TextBolt',
        paused: false,
        pages: [{ failed: false, notice: notice() }]
      }
      const first = await service.notifyCheckFinished(finished)
      expect(first.email.action).toBe('recorded')
      expect(secrets.gets).toBe(1)
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.secure).toBe(true)
      expect(server.mails[0]?.raw).toContain('TextBolt')
      expect(server.accepted).toBe(1)
      const second = await service.notifyCheckFinished(finished)
      expect(second.email).toEqual({ action: 'skipped', reason: 'already_sent' })
      expect(server.mails).toHaveLength(1)
      expect(server.accepted).toBe(1)
      expect(secrets.gets).toBe(1)
      expect(deliveryRows(db)).toEqual([
        { trigger: 'check_summary', outcome: 'sent', occurrence_key: 'summary:proj-1:check-1' }
      ])
      expect(throttleKeys(db)).toEqual(['desktop:proj-1:page-1:check-1', 'summary:proj-1:check-1'])
      expect(lines.join('\n')).not.toContain(PASSWORD)
    })
  })

  test('a failed alert send records no sent delivery', async () => {
    await withServer(
      'starttls',
      { password: 'server-expects-other', echo: true },
      async (server) => {
        const lines: string[] = []
        const transport = createNodemailerTransport({ ...BOUNDED, ca: [fixture.certPem] })
        const { db, service } = openStorage(transport, lines)
        const saved = service.saveAccount(
          accountBody({
            host: '127.0.0.1',
            port: server.port,
            security: 'starttls',
            username: USER
          })
        )
        service.updateAlerts({
          projectId: 'proj-1',
          emailAfterCheck: true,
          emailAccountId: saved.id,
          emailTo: ['ada@example.com']
        })
        const failed = await service.notifyCheckFinished({
          checkId: 'check-1',
          projectId: 'proj-1',
          projectName: 'TextBolt',
          paused: false,
          pages: [{ failed: false, notice: notice() }]
        })
        expect(failed.email.action).toBe('recorded')
        if (failed.email.action === 'recorded') {
          expect(failed.email.delivery.outcome).toBe('failed')
          expect(failed.email.delivery.ok).toBe(false)
          expect(failed.email.delivery.occurrenceKey).toBeNull()
          expect(failed.email.delivery.reason ?? '').not.toContain(PASSWORD)
        }
        expect(server.mails).toEqual([])
        expect(deliveryRows(db)).toEqual([
          { trigger: 'check_summary', outcome: 'failed', occurrence_key: null }
        ])
        expect(throttleKeys(db)).toEqual(['desktop:proj-1:page-1:check-1'])
        const blob = `${lines.join('\n')}\n${JSON.stringify(service.listDeliveries())}`
        expect(blob).not.toContain(PASSWORD)
        expect(blob).toContain('[REDACTED]')
      }
    )
  })
})

describe('plaintext SMTP login', () => {
  test('refuses to send a password over None to a remote host, before any socket', async () => {
    const request = sample(25, 'none')
    const remote = { ...request, auth: { ...request.auth, host: 'smtp.example.invalid' } }
    const error = await createNodemailerTransport(QUICK)
      .send(remote)
      .then(
        () => null,
        (caught: unknown) => caught
      )
    expect(error).toBeInstanceOf(SmtpTransportError)
    expect(error).toMatchObject({ kind: 'insecure', smtpCode: null })
    expect((error as Error).message).toMatch(/STARTTLS/)
    expect((error as Error).message).not.toContain(PASSWORD)
  })

  test.each(['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]'])(
    'allows None to the local relay %s',
    (host) => {
      expect(plaintextLoginProblem({ host, security: 'none', password: PASSWORD })).toBeNull()
    }
  )

  test('allows None without a password, and any host with TLS', () => {
    expect(
      plaintextLoginProblem({ host: 'smtp.example.com', security: 'none', password: '' })
    ).toBeNull()
    expect(
      plaintextLoginProblem({ host: 'smtp.example.com', security: 'starttls', password: PASSWORD })
    ).toBeNull()
    expect(
      plaintextLoginProblem({ host: 'smtp.example.com', security: 'ssl', password: PASSWORD })
    ).toBeNull()
  })

  test('the delivery message tells the user what to change', () => {
    const translated = translateSmtpFailure({
      kind: 'insecure',
      smtpCode: null,
      provider: 'other',
      host: 'smtp.example.com',
      port: 25
    })
    expect(translated.message).toContain('smtp.example.com')
    expect(translated.message).toMatch(/STARTTLS or SSL/)
  })
})

function sample(port: number, security: SmtpSecurity, password = PASSWORD): SmtpSendRequest {
  return {
    auth: { host: '127.0.0.1', port, security, username: USER, password },
    message: {
      fromName: 'CiteFox',
      fromAddress: 'reports@example.com',
      replyTo: 'reply@example.com',
      to: ['ada@example.com'],
      subject: 'Visibility',
      text: 'Score 40',
      attachment: {
        filename: 'report.csv',
        contentType: 'text/csv',
        bytes: Buffer.from('score,40\n')
      }
    }
  }
}

async function withServer(
  mode: SmtpTestMode,
  options: { password?: string; echo?: boolean },
  run: (server: SmtpTestServer) => Promise<void>
): Promise<void> {
  const server = await startSmtpTestServer({
    mode,
    certPem: fixture.certPem,
    keyPem: fixture.keyPem,
    username: USER,
    password: options.password ?? PASSWORD,
    echoPasswordOnReject: options.echo === true
  })
  try {
    await run(server)
  } finally {
    await server.close()
  }
}

function memoryService(transport: SmtpTransport, lines: string[]): { service: EmailService } {
  const ports = createMemoryEmailPorts()
  let n = 0
  const service = createEmailService({
    secrets: new MemorySecretStore(),
    transport,
    webhooks: ports.webhooks,
    drafts: ports.drafts,
    accounts: ports.accounts,
    alerts: ports.alerts,
    reports: ports.reports,
    deliveries: ports.deliveries,
    pdfs: ports.pdfs,
    logger: capture(lines),
    clock: { now: () => new Date(WHEN), timeZone: 'UTC' },
    sleep: async () => undefined,
    createId: () => {
      n += 1
      return `id-${n}`
    },
    knownSecrets: () => [PASSWORD]
  })
  return { service }
}

function counting(inner: SmtpTransport): { transport: SmtpTransport; attempts: () => number } {
  let n = 0
  return {
    attempts: () => n,
    transport: {
      async send(request) {
        n += 1
        await inner.send(request)
      }
    }
  }
}

class CountingSecretStore extends MemorySecretStore {
  gets = 0

  override get(keychainRef: string): string | null {
    this.gets += 1
    return super.get(keychainRef)
  }
}

function openStorage(
  transport: SmtpTransport,
  lines: string[]
): { db: SqliteDatabase; service: EmailService; secrets: CountingSecretStore } {
  const root = mkdtempSync(join(tmpdir(), 'citefox-smtp-alert-'))
  const db = openAppDatabase(join(root, 'app.sqlite'))
  const projectsDirectory = join(root, 'projects')
  const created = createProjectDatabase(projectsDirectory, 'textbolt')
  closeProjectDatabase(created)
  insertProject(db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const clock: EmailClock = { now: () => new Date(WHEN), timeZone: 'UTC' }
  const stores = createStorageEmailStores({
    app: db,
    projectsDirectory,
    outboxDir: join(root, 'outbox'),
    clock,
    logger: capture(lines)
  })
  const secrets = new CountingSecretStore()
  let n = 0
  const service = createEmailService({
    secrets,
    transport,
    webhooks: new MemoryWebhookTransport(),
    drafts: new MemoryDraftOpener(),
    accounts: stores.accounts,
    alerts: stores.alerts,
    reports: stores.reports,
    deliveries: stores.deliveries,
    pdfs: stores.pdfs,
    logger: capture(lines),
    clock,
    sleep: async () => undefined,
    createId: () => {
      n += 1
      return `id-${n}`
    },
    knownSecrets: () => [PASSWORD]
  })
  closers.push(() => {
    stores.close()
    closeDatabase(db)
    rmSync(root, { recursive: true, force: true })
  })
  return { db, service, secrets }
}

function deliveryRows(
  db: SqliteDatabase
): { trigger: string; outcome: string; occurrence_key: string | null }[] {
  return db
    .prepare<unknown[], { trigger: string; outcome: string; occurrence_key: string | null }>(
      `SELECT trigger, outcome, occurrence_key FROM deliveries ORDER BY rowid`
    )
    .all()
}

function throttleKeys(db: SqliteDatabase): string[] {
  return db
    .prepare<unknown[], { key: string }>(`SELECT key FROM email_throttle ORDER BY key`)
    .all()
    .map((row) => row.key)
}

function capture(lines: string[]): Logger {
  const write = (message: string, extra?: unknown): void => {
    lines.push(JSON.stringify({ message, extra }))
  }
  return { debug: write, info: write, warn: write, error: write }
}
