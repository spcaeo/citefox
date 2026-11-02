import { join } from 'node:path'
import type { IpcHandlerMap, IpcInvokeChannel } from '@shared/ipc'
import { IpcRequestError } from '../ipc-request'
import type { Logger } from '../logging/logger'
import type { SecretStore } from '../secrets/secret-store'
import type { AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { unconfiguredDraftOpener, type MailAppDraftOpener } from './draft'
import { EmailError } from './errors'
import { createEmailService, type EmailService } from './service'
import { createNodemailerTransport } from './smtp-client'
import {
  createStorageEmailStores,
  type StorageAlertStore,
  type StorageEmailStores
} from './storage-stores'
import { SmtpTransportError, type SmtpTransport } from './transport'
import type { EmailClock, SummaryWriter } from './types'
import type { WebhookTransport } from './webhook'
import { createHttpWebhookTransport } from './webhook-http'

export { bindReportIpcHandlers } from './reports/ipc'

type EmailChannel =
  | 'email:getSettings'
  | 'email:setMode'
  | 'email:saveAccount'
  | 'email:removeAccount'
  | 'email:test'
  | 'alerts:get'
  | 'alerts:update'
  | 'alerts:testSlack'

/**
 * Email service for one engine host.
 * SMTP passwords and Slack webhooks stay in the host's secret store (the OS
 * keychain in production). This module does not open a second secret path.
 * `outboxDir` is computed once as `<root>/outbox`.
 */
export interface EngineEmail {
  service: EmailService
  alerts: StorageAlertStore
  reports: StorageEmailStores['reports']
  deliveries: StorageEmailStores['deliveries']
  db: SqliteDatabase
  projectsDirectory: string
  outboxDir: string
  clock: EmailClock
  close(): void
}

/** Offline stand-ins. Production leaves these unset and uses the real transports. */
export interface EngineEmailTestPorts {
  transport?: SmtpTransport
  webhooks?: WebhookTransport
  drafts?: MailAppDraftOpener
  clock?: EmailClock
  sleep?: (ms: number) => Promise<void>
}

const testPorts = new WeakMap<AppStorage, EngineEmailTestPorts>()
const openHosts = new WeakMap<SqliteDatabase, EngineEmail>()

/** Test seam. Production never calls this. The ports are not a secret store. */
export function setEngineEmailTestPorts(storage: AppStorage, ports: EngineEmailTestPorts): void {
  testPorts.set(storage, ports)
}

/**
 * Production Slack delivery: a JSON POST to hooks.slack.com through the
 * shared HTTP transport, with a timeout. Tests replace it with a port.
 */
export function defaultEngineWebhookTransport(): WebhookTransport {
  return createHttpWebhookTransport()
}

export function engineEmailFor(app: SqliteDatabase): EngineEmail | undefined {
  return openHosts.get(app)
}

export function openEngineEmail(deps: {
  storage: AppStorage
  secrets: SecretStore
  logger: Logger
  createId?: () => string
  knownSecrets?: () => readonly string[]
  /** Rewrites a scheduled report's summary with Claude when it has a summary style. */
  summaryWriter?: SummaryWriter
}): EngineEmail {
  const ports = testPorts.get(deps.storage)
  const outboxDir = join(deps.storage.paths.root, 'outbox')
  const clock: EmailClock = ports?.clock ?? {
    now: () => new Date(),
    timeZone: systemTimeZone()
  }
  const stores = createStorageEmailStores({
    app: deps.storage.db,
    projectsDirectory: deps.storage.paths.projectsDirectory,
    outboxDir,
    clock,
    logger: deps.logger
  })
  const service = createEmailService({
    secrets: deps.secrets,
    transport: ports?.transport ?? createNodemailerTransport(),
    webhooks: ports?.webhooks ?? defaultEngineWebhookTransport(),
    drafts: ports?.drafts ?? unconfiguredDraftOpener(),
    accounts: stores.accounts,
    alerts: stores.alerts,
    reports: stores.reports,
    deliveries: stores.deliveries,
    pdfs: stores.pdfs,
    logger: deps.logger,
    clock,
    ...(deps.createId !== undefined ? { createId: deps.createId } : {}),
    ...(deps.knownSecrets !== undefined ? { knownSecrets: deps.knownSecrets } : {}),
    ...(ports?.sleep !== undefined ? { sleep: ports.sleep } : {}),
    ...(deps.summaryWriter !== undefined ? { summaryWriter: deps.summaryWriter } : {})
  })
  let closed = false
  const email: EngineEmail = {
    service,
    alerts: stores.alerts,
    reports: stores.reports,
    deliveries: stores.deliveries,
    db: deps.storage.db,
    projectsDirectory: deps.storage.paths.projectsDirectory,
    outboxDir,
    clock,
    close() {
      if (closed) return
      closed = true
      if (openHosts.get(deps.storage.db) === email) openHosts.delete(deps.storage.db)
      stores.close()
    }
  }
  openHosts.set(deps.storage.db, email)
  return email
}

/**
 * Email and alert invoke handlers.
 * Report schedules and delivery history are registered by `bindReportIpcHandlers`.
 */
export function bindEmailIpcHandlers(
  email: EngineEmail,
  guard: <T>(channel: IpcInvokeChannel, run: () => Promise<T> | T) => Promise<T>
): Pick<IpcHandlerMap, EmailChannel> {
  const call = <T>(channel: EmailChannel, run: () => Promise<T> | T): Promise<T> =>
    guard(channel, () => settleEmail(channel, run))
  return {
    'email:getSettings': () => call('email:getSettings', () => email.service.getSettings()),
    'email:setMode': (request) => call('email:setMode', () => email.service.setMode(request)),
    'email:saveAccount': (request) =>
      call('email:saveAccount', () => email.service.saveAccount(request)),
    'email:removeAccount': (request) =>
      call('email:removeAccount', () => email.service.removeAccount(request)),
    'email:test': (request) => call('email:test', () => email.service.testAccount(request)),
    'alerts:get': (request) => call('alerts:get', () => email.service.getAlerts(request)),
    'alerts:update': (request) => call('alerts:update', () => email.service.updateAlerts(request)),
    'alerts:testSlack': (request) =>
      call('alerts:testSlack', () => email.service.testSlack(request))
  }
}

function settleEmail<T>(channel: string, run: () => Promise<T> | T): Promise<T> | T {
  try {
    const result = run()
    if (isPromise(result)) {
      return result.then(
        (value) => value,
        (error: unknown) => {
          throw toIpcError(channel, error)
        }
      )
    }
    return result
  } catch (error: unknown) {
    throw toIpcError(channel, error)
  }
}

function toIpcError(channel: string, error: unknown): unknown {
  if (error instanceof EmailError || error instanceof SmtpTransportError) {
    return new IpcRequestError(channel, error.message)
  }
  return error
}

function isPromise<T>(value: Promise<T> | T): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function'
}

function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length > 0 ? zone : 'UTC'
}
