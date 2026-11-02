import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  callIpcHandler,
  type IpcArgs,
  type IpcHandlerMap,
  type IpcInvokeChannel,
  type IpcResult,
  type SaveEmailAccountRequest
} from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import type { EngineHost } from '../engine/host'
import { createIpcHandlers, type IpcHandlerDeps } from '../handlers'
import { createLogger } from '../logging/logger'
import type { HttpTransport } from '../providers/http'
import { MemorySecretStore, SecretRegistry } from '../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { setEngineEmailTestPorts } from './engine-email'
import { PASSWORD } from './harness'
import { createNodemailerTransport } from './smtp-client'
import {
  citefoxSmtpTestSelfSigned,
  closedLocalPort,
  startSilentLocalServer,
  startSmtpTestServer
} from './smtp-test-server.test-helper'
import { StorageAlertStore } from './storage-stores'
import { MemorySmtpTransport, SmtpTransportError, type SmtpTransport } from './transport'
import { MemoryWebhookTransport } from './webhook'

const WEBHOOK = 'https://hooks.slack.com/services/T00000000/B00000000/webhookSecretValue'
const TESTED_AT = '2026-10-20T05:33:00.000Z'
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('email IPC', () => {
  test('email:getSettings round-trips the default smtp mode', async () => {
    const { handlers } = harness()
    expect(await invoke(handlers, 'email:getSettings', [])).toEqual({
      mode: 'smtp',
      accounts: []
    })
  })

  test('email:setMode round-trips smtp and mail_app', async () => {
    const { handlers } = harness()
    expect(await invoke(handlers, 'email:setMode', [{ mode: 'mail_app' }])).toMatchObject({
      mode: 'mail_app',
      accounts: []
    })
    expect(await invoke(handlers, 'email:setMode', [{ mode: 'smtp' }])).toMatchObject({
      mode: 'smtp'
    })
    await expect(callIpcHandler(handlers, 'email:setMode', [{ mode: 'carrier' }])).rejects.toThrow(
      'email:setMode: Invalid request'
    )
  })

  test('email:saveAccount round-trips an account and keeps the password in the keychain', async () => {
    const { handlers, secrets, logs, storage } = harness()
    const created = await invoke(handlers, 'email:saveAccount', [gmailAccount()])
    expect(created.usedFor).toEqual([])
    expect(created.keychainRef.startsWith('citefox.smtp.')).toBe(true)
    expect(Object.hasOwn(created, 'password')).toBe(false)
    expect(secrets.get(created.keychainRef)).toBe(PASSWORD)
    expect(JSON.stringify(created)).not.toContain(PASSWORD)

    const renamed = await invoke(handlers, 'email:saveAccount', [
      gmailAccount({ id: created.id, fromName: 'CiteFox reports', password: null })
    ])
    expect(renamed.fromName).toBe('CiteFox reports')
    expect(renamed.keychainRef).toBe(created.keychainRef)
    expect(secrets.get(created.keychainRef)).toBe(PASSWORD)
    expect(JSON.stringify({ logs, created, renamed })).not.toContain(PASSWORD)
    expect(treeHas(storage.paths.root, PASSWORD)).toBe(false)
  })

  test('email:removeAccount round-trips removal and deletes the keychain password', async () => {
    const { handlers, secrets } = harness()
    const created = await invoke(handlers, 'email:saveAccount', [gmailAccount()])
    expect(await invoke(handlers, 'email:removeAccount', [{ id: created.id }])).toEqual({
      id: created.id
    })
    expect(secrets.get(created.keychainRef)).toBeNull()
    const settings = await invoke(handlers, 'email:getSettings', [])
    expect(settings.accounts).toEqual([])
  })

  test('email:test round-trips through the local SMTP server', async () => {
    const server = await startSmtpTestServer({
      mode: 'none',
      username: 'mailer',
      password: PASSWORD
    })
    try {
      const { handlers, logs, host } = harness()
      const created = await invoke(handlers, 'email:saveAccount', [
        gmailAccount({
          provider: 'other',
          host: '127.0.0.1',
          port: server.port,
          security: 'none'
        })
      ])
      const sent = await invoke(handlers, 'email:test', [{ id: created.id }])
      expect(sent.ok).toBe(true)
      expect(sent.host).toBe('127.0.0.1')
      expect(sent.nextStep).toBeNull()
      expect(sent.message).toBe(`Test sent through 127.0.0.1 at ${sent.testedAt}.`)
      expect(server.mails).toHaveLength(1)
      expect(server.mails[0]?.secure).toBe(false)
      expect(server.mails[0]?.raw).toContain('Subject: Test')
      expect(server.mails[0]?.raw).toContain('reports@example.com')
      expect(server.accepted).toBe(1)
      const deliveries = host.email.service.listDeliveries()
      expect(deliveries).toHaveLength(1)
      expect(deliveries[0]).toMatchObject({
        outcome: 'sent',
        trigger: 'account_test',
        ok: true
      })
      expect(JSON.stringify({ logs, sent, deliveries })).not.toContain(PASSWORD)
      await expect(
        callIpcHandler(handlers, 'email:test', [{ id: 'missing-account' }])
      ).rejects.toThrow('email:test: Unknown email account')
    } finally {
      await server.close()
    }
  })

  test('email:test reports a wrong password without the secret', async () => {
    const server = await startSmtpTestServer({
      mode: 'none',
      username: 'mailer',
      password: 'server-expects-other',
      echoPasswordOnReject: true
    })
    try {
      const { handlers, logs, host } = harness()
      const created = await invoke(handlers, 'email:saveAccount', [
        gmailAccount({
          provider: 'other',
          host: '127.0.0.1',
          port: server.port,
          security: 'none'
        })
      ])
      const failed = await invoke(handlers, 'email:test', [{ id: created.id }])
      expect(failed.ok).toBe(false)
      expect(failed.message).toBe('Authentication failed (535).')
      expect(failed.nextStep).toBe('Fix in Email setup')
      const deliveries = host.email.service.listDeliveries()
      expect(deliveries.some((row) => row.outcome === 'sent')).toBe(false)
      const blob = JSON.stringify({ logs, failed, deliveries })
      expect(blob).not.toContain(PASSWORD)
      expect(blob).not.toContain(Buffer.from(PASSWORD).toString('base64'))
      expect(blob).toContain('[REDACTED]')
      expect(server.mails).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('email:test reports connection refused', async () => {
    const port = await closedLocalPort()
    const { handlers, logs, host } = harness()
    const created = await invoke(handlers, 'email:saveAccount', [
      gmailAccount({
        provider: 'other',
        host: '127.0.0.1',
        port,
        security: 'none'
      })
    ])
    const failed = await invoke(handlers, 'email:test', [{ id: created.id }])
    expect(failed.ok).toBe(false)
    expect(failed.message).toBe(`Could not connect to 127.0.0.1:${port}: connection refused.`)
    expect(failed.nextStep).toBe('Fix in Email setup')
    expect(host.email.service.listDeliveries().some((row) => row.outcome === 'sent')).toBe(false)
    expect(JSON.stringify({ logs, failed })).not.toContain(PASSWORD)
  })

  test('email:test reports a timeout from a silent peer', async () => {
    const silent = await startSilentLocalServer()
    try {
      const { handlers, logs } = harness({
        transport: createNodemailerTransport({
          connectionTimeoutMs: 1_000,
          greetingTimeoutMs: 1_000,
          socketTimeoutMs: 1_000
        })
      })
      const created = await invoke(handlers, 'email:saveAccount', [
        gmailAccount({
          provider: 'other',
          host: '127.0.0.1',
          port: silent.port,
          security: 'none'
        })
      ])
      const failed = await invoke(handlers, 'email:test', [{ id: created.id }])
      expect(failed.ok).toBe(false)
      expect(failed.message).toBe('127.0.0.1 timed out.')
      expect(JSON.stringify({ logs, failed })).not.toContain(PASSWORD)
    } finally {
      await silent.close()
    }
  }, 20_000)

  test('email:test rejects an untrusted self-signed certificate', async () => {
    const cert = citefoxSmtpTestSelfSigned()
    const server = await startSmtpTestServer({
      mode: 'ssl',
      certPem: cert.certPem,
      keyPem: cert.keyPem,
      username: 'mailer',
      password: PASSWORD
    })
    try {
      const { handlers, logs, host } = harness()
      const created = await invoke(handlers, 'email:saveAccount', [
        gmailAccount({
          provider: 'other',
          host: '127.0.0.1',
          port: server.port,
          security: 'ssl'
        })
      ])
      const failed = await invoke(handlers, 'email:test', [{ id: created.id }])
      expect(failed.ok).toBe(false)
      expect(failed.message).not.toContain(PASSWORD)
      expect(server.mails).toEqual([])
      expect(server.accepted).toBe(0)
      expect(host.email.service.listDeliveries().some((row) => row.outcome === 'sent')).toBe(false)
      const blob = JSON.stringify({ logs, failed })
      expect(blob).not.toContain(PASSWORD)
      expect(blob).toMatch(/certificate|self-signed|unable to verify/i)
    } finally {
      await server.close()
    }
  })

  test('email:test reports a wired fake transport without a network send', async () => {
    const transport = new MemorySmtpTransport()
    const webhooks = new MemoryWebhookTransport()
    const { handlers, logs } = harness({ transport, webhooks, now: TESTED_AT })
    const created = await invoke(handlers, 'email:saveAccount', [gmailAccount()])
    const sent = await invoke(handlers, 'email:test', [{ id: created.id }])
    expect(sent).toEqual({
      ok: true,
      host: 'smtp.gmail.com',
      testedAt: TESTED_AT,
      message: `Test sent through smtp.gmail.com at ${TESTED_AT}.`,
      nextStep: null
    })
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.message.to).toEqual(['reports@example.com'])
    expect(transport.sent[0]?.auth.password).toBe(PASSWORD)
    expect(webhooks.posts).toEqual([])

    transport.failure = new SmtpTransportError(`535 rejected ${PASSWORD}`, 'auth', 535)
    const failed = await invoke(handlers, 'email:test', [{ id: created.id }])
    expect(failed.ok).toBe(false)
    expect(failed.message).toBe('535: Gmail needs an App Password')
    expect(failed.nextStep).toBe('Fix in Email setup')
    expect(JSON.stringify({ logs, sent, failed })).not.toContain(PASSWORD)

    transport.failure = null
    const directed = await invoke(handlers, 'email:test', [
      { id: created.id, to: 'ada@example.com' }
    ])
    expect(directed.ok).toBe(true)
    expect(transport.sent.at(-1)?.message.to).toEqual(['ada@example.com'])
    const attempts = transport.attempts
    await expect(
      invoke(handlers, 'email:test', [{ id: created.id, to: 'not-an-email' }])
    ).rejects.toThrow('email:test: Invalid request')
    await expect(
      invoke(handlers, 'email:test', [{ id: created.id, to: 'ada@example.com,bea@example.com' }])
    ).rejects.toThrow('email:test: Invalid request')
    expect(transport.attempts).toBe(attempts)
  })

  test('alerts:get round-trips the default project alerts', async () => {
    const { handlers } = harness()
    const project = await handlers['projects:create'](projectBody())
    expect(await invoke(handlers, 'alerts:get', [{ projectId: project.id }])).toEqual({
      projectId: project.id,
      desktop: true,
      emailAfterCheck: false,
      emailAccountId: null,
      emailTo: [],
      slackEnabled: false,
      slackWebhookStored: false,
      monthlyClientPdf: false,
      monthlyPdfTo: null
    })
  })

  test('alerts:update round-trips alert settings and stores the webhook only in the keychain', async () => {
    const { handlers, host, secrets, logs, storage } = harness()
    const project = await handlers['projects:create'](projectBody())
    const created = await invoke(handlers, 'email:saveAccount', [gmailAccount()])
    const updated = await invoke(handlers, 'alerts:update', [
      {
        projectId: project.id,
        desktop: true,
        emailAfterCheck: true,
        emailAccountId: created.id,
        emailTo: ['ada@example.com'],
        slackEnabled: true,
        slackWebhook: WEBHOOK,
        monthlyClientPdf: true
      }
    ])
    expect(updated).toEqual({
      projectId: project.id,
      desktop: true,
      emailAfterCheck: true,
      emailAccountId: created.id,
      emailTo: ['ada@example.com'],
      slackEnabled: true,
      slackWebhookStored: true,
      monthlyClientPdf: true,
      monthlyPdfTo: null
    })
    expect(JSON.stringify(updated)).not.toContain(WEBHOOK)
    expect(Object.hasOwn(updated, 'slackWebhook')).toBe(false)
    const slackRef = host.email.alerts.get(project.id)?.slackKeychainRef
    expect(slackRef?.startsWith('citefox.slack.')).toBe(true)
    expect(slackRef === null || slackRef === undefined ? null : secrets.get(slackRef)).toBe(WEBHOOK)

    const cleared = await invoke(handlers, 'alerts:update', [
      { projectId: project.id, slackWebhook: '' }
    ])
    expect(cleared.monthlyPdfTo).toBeNull()
    expect(cleared.slackWebhookStored).toBe(false)
    expect(cleared.desktop).toBe(true)
    expect(secrets.get(slackRef ?? '')).toBeNull()
    expect(JSON.stringify({ logs, updated, cleared })).not.toContain(WEBHOOK)
    expect(treeHas(storage.paths.root, WEBHOOK)).toBe(false)

    const withRecipient = await invoke(handlers, 'alerts:update', [
      { projectId: project.id, monthlyPdfTo: 'client@example.com' }
    ])
    expect(withRecipient.monthlyPdfTo).toBe('client@example.com')
    expect(withRecipient.desktop).toBe(true)
    expect((await invoke(handlers, 'alerts:get', [{ projectId: project.id }])).monthlyPdfTo).toBe(
      'client@example.com'
    )
    await expect(
      invoke(handlers, 'alerts:update', [
        { projectId: project.id, monthlyPdfTo: 'ada@example.com,bea@example.com' }
      ])
    ).rejects.toThrow('alerts:update: Invalid request')
    expect((await invoke(handlers, 'alerts:get', [{ projectId: project.id }])).monthlyPdfTo).toBe(
      'client@example.com'
    )
  })

  test('uses a real clock, the system time zone, and the host outbox', () => {
    const { storage, host } = harness()
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(host.email.clock.timeZone).toBe(zone.length > 0 ? zone : 'UTC')
    expect(Math.abs(host.email.clock.now().getTime() - Date.now())).toBeLessThan(2000)
    expect(host.email.outboxDir).toBe(join(storage.paths.root, 'outbox'))
  })

  test('evicts the project alert database after deleteProject rolls a create back', async () => {
    const { handlers, storage, host } = harness({ ids: ['proj-rollback', 'market-rollback'] })
    const closed: SqliteDatabase[] = []
    const evict = host.email.alerts.evictProject.bind(host.email.alerts)
    host.email.alerts.evictProject = (projectId: string): SqliteDatabase | null => {
      const handle = evict(projectId)
      if (handle !== null) closed.push(handle)
      return handle
    }
    storage.db = failActiveProjectWrite(storage.db, (projectId) => {
      host.email.alerts.get(projectId)
    })

    await expect(handlers['projects:create'](projectBody())).rejects.toThrow(
      'projects:create: Request failed'
    )
    expect(closed).toHaveLength(1)
    expect(closed[0]?.open).toBe(false)
    expect(host.email.alerts.evictProject('proj-rollback')).toBeNull()
    expect(host.email.alerts.get('proj-rollback')).toBeNull()
  })

  test('closes email before storage on shutdown using the host handle', async () => {
    const opened = harness()
    const project = await opened.handlers['projects:create'](projectBody())
    await invoke(opened.handlers, 'alerts:get', [{ projectId: project.id }])
    const handles = cachedAlertDatabases(opened.host.email.alerts)
    expect(handles).toHaveLength(1)
    expect(handles[0]?.open).toBe(true)

    const order: string[] = []
    const closeEmail = opened.host.email.close.bind(opened.host.email)
    opened.host.email.close = () => {
      order.push(opened.storage.db.open ? 'email' : 'email-after-storage')
      closeEmail()
    }
    const closeStorage = opened.storage.close.bind(opened.storage)
    opened.storage.close = () => {
      order.push('storage')
      closeStorage()
    }

    opened.host.email.close()
    expect(handles[0]?.open).toBe(false)
    expect(cachedAlertDatabases(opened.host.email.alerts)).toEqual([])
    expect(opened.storage.db.open).toBe(true)
    opened.storage.close()
    expect(order).toEqual(['email', 'storage'])
    expect(opened.storage.db.open).toBe(false)
    opened.host.email.close()
    expect(order).toEqual(['email', 'storage', 'email-after-storage'])

    const alone = harness()
    const second = await alone.handlers['projects:create'](projectBody())
    await invoke(alone.handlers, 'alerts:get', [{ projectId: second.id }])
    const stillOpen = cachedAlertDatabases(alone.host.email.alerts)
    expect(stillOpen[0]?.open).toBe(true)
    alone.storage.close()
    expect(alone.storage.db.open).toBe(false)
    expect(stillOpen[0]?.open).toBe(true)
    expect(cachedAlertDatabases(alone.host.email.alerts)).toEqual(stillOpen)
    alone.host.email.close()
    expect(stillOpen[0]?.open).toBe(false)
    alone.host.email.close()
  })
})

function invoke<C extends IpcInvokeChannel>(
  handlers: IpcHandlerMap,
  channel: C,
  args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return Promise.resolve(callIpcHandler(handlers, channel, args)) as Promise<IpcResult<C>>
}

function gmailAccount(overrides: Partial<SaveEmailAccountRequest> = {}): SaveEmailAccountRequest {
  return {
    id: null,
    provider: 'gmail',
    fromName: 'CiteFox',
    fromAddress: 'reports@example.com',
    replyTo: null,
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    username: 'mailer',
    password: PASSWORD,
    isDefault: true,
    ...overrides
  }
}

function cachedAlertDatabases(alerts: StorageAlertStore): readonly SqliteDatabase[] {
  const open = (alerts as unknown as { open: Map<string, SqliteDatabase> }).open
  return [...open.values()]
}

function failActiveProjectWrite(
  db: SqliteDatabase,
  onWrite: (projectId: string) => void
): SqliteDatabase {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          const statement = target.prepare(sql)
          if (!sql.includes('UPDATE app_state SET active_project_id')) return statement
          return {
            run(projectId: unknown) {
              if (typeof projectId === 'string') onWrite(projectId)
              throw new Error('active project write failed')
            }
          }
        }
      }
      const value: unknown = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as SqliteDatabase
}

function harness(options?: {
  transport?: SmtpTransport
  webhooks?: MemoryWebhookTransport
  now?: string
  ids?: readonly string[]
}): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  secrets: MemorySecretStore
  logs: string[]
  host: EngineHost
} {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-email-ipc-'))
  const storage = openAppStorage(directory)
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logs: string[] = []
  const logger = createLogger({
    write: (_level, line) => {
      logs.push(line)
    },
    secrets: () => registry.list()
  })
  const now = options?.now
  if (options?.transport !== undefined || options?.webhooks !== undefined || now !== undefined) {
    setEngineEmailTestPorts(storage, {
      ...(options?.transport !== undefined ? { transport: options.transport } : {}),
      ...(options?.webhooks !== undefined ? { webhooks: options.webhooks } : {}),
      ...(now !== undefined ? { clock: { now: () => new Date(now), timeZone: 'UTC' } } : {}),
      sleep: async () => undefined
    })
  }
  let sequence = 0
  const ids = options?.ids ?? []
  let host: EngineHost | undefined
  const deps: IpcHandlerDeps = {
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger,
    http: idleHttp(),
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => registry.list(),
    createId: () => {
      const reserved = ids[sequence]
      sequence += 1
      return reserved ?? `id-${sequence}`
    },
    onHost: (opened) => {
      host = opened
    }
  }
  const handlers = createIpcHandlers(deps)
  if (host === undefined) throw new Error('email host was not opened')
  const opened = host
  closers.push(() => {
    opened.email.close()
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { handlers, storage, secrets, logs, host: opened }
}

function idleHttp(): HttpTransport {
  return {
    async request() {
      throw new Error('no network')
    }
  }
}

function projectBody(): {
  name: string
  domain: string
  includeSubdomains: boolean
  brandNames: string[]
  competitors: string[]
  clientName: null
  country: string
  language: string
  location: null
  device: 'desktop'
} {
  return {
    name: 'TextBolt',
    domain: 'textbolt.com',
    includeSubdomains: true,
    brandNames: ['TextBolt'],
    competitors: [],
    clientName: null,
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop'
  }
}

function treeHas(root: string, secret: string): boolean {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(current)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) pending.push(join(current, entry))
      continue
    }
    if (!stats.isFile() || stats.size > 5_000_000) continue
    if (readFileSync(current).includes(Buffer.from(secret))) return true
  }
  return false
}
