import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isResendDelivery,
  type DeliveryRecord,
  type ReportFormat,
  type ReportSchedule
} from '@shared/domain'
import {
  callIpcHandler,
  type IpcArgs,
  type IpcHandlerMap,
  type IpcInvokeChannel,
  type IpcResult
} from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { createIpcHandlers, type IpcHandlerDeps } from '../../handlers'
import { deliverDueScheduledReports } from '../../headless/due-reports'
import { createLogger } from '../../logging/logger'
import { MemorySecretStore, SecretRegistry } from '../../secrets/secret-store'
import { openAppStorage, type AppStorage } from '../../storage/app-storage'
import { closeDatabase } from '../../storage/database'
import { addPageMarket, insertPage } from '../../storage/pages'
import { createProjectDatabase } from '../../storage/project-files'
import { insertMarket, writeProjectProfile } from '../../storage/project-profile'
import { insertProject } from '../../storage/records'
import { projectDatabaseRelativePath } from '../../storage/slug'
import { setEngineEmailTestPorts } from '../engine-email'
import { accountBody, PASSWORD } from '../harness'
import { createNodemailerTransport } from '../smtp-client'
import { startSmtpTestServer, type SmtpTestServer } from '../smtp-test-server.test-helper'

/**
 * Live check 2026-10-21: "Resend" on a scheduled delivery sent a one-line text email
 * with no file. A resend must carry the same report file the schedule attaches.
 * Both sends go through the production SMTP client to the in-process test server.
 */
const SUNDAY = '2026-02-01T00:00:00.000Z'
const MONDAY = '2026-02-02T09:00:00.000Z'
let current = SUNDAY
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('deliveries:resend', () => {
  test.each<[ReportFormat, RegExp]>([
    ['csv', /\.zip$/],
    ['excel', /\.xlsx$/],
    ['html_link', /\.zip$/]
  ])('a resent %s report attaches the same file as the scheduled send', async (format, ext) => {
    const { handlers, storage, server, secrets, logger } = await harness()
    await invoke(handlers, 'email:saveAccount', [
      accountBody({ host: '127.0.0.1', port: server.port, security: 'none' })
    ] as unknown as IpcArgs<'email:saveAccount'>)
    await invoke(handlers, 'reports:save', [weekly(format)])
    current = MONDAY

    await deliverDueScheduledReports({
      storage,
      delivery: { secrets, transport: createNodemailerTransport(), logger, redacted: [] },
      now: () => new Date(MONDAY),
      timeZone: 'UTC'
    })
    expect(server.mails).toHaveLength(1)
    const scheduled = server.mails[0]?.raw ?? ''
    const original = attachmentNames(scheduled)
    expect(original).toHaveLength(1)
    expect(original[0]).toMatch(ext)

    const history = await invoke(handlers, 'deliveries:list', [{}])
    const sent = history.find((row: DeliveryRecord) => row.trigger === 'weekly')
    if (sent === undefined) throw new Error('missing scheduled delivery')
    const resent = await invoke(handlers, 'deliveries:resend', [{ id: sent.id }])

    expect(resent).toMatchObject({ outcome: 'sent', scheduleId: 'sched-1', trigger: 'weekly' })
    expect(resent.recipients).toEqual(['client@example.com'])
    expect(isResendDelivery(resent)).toBe(true)
    expect(isResendDelivery(sent)).toBe(false)
    expect(server.mails).toHaveLength(2)
    const again = server.mails[1]?.raw ?? ''
    expect(attachmentNames(again)).toEqual(original)
    expect(subjectLine(again)).toBe(subjectLine(scheduled))
    expect(again).not.toContain('Resent Monday report.')
  })

  test('a resent summary-only report still sends no file', async () => {
    const { handlers, storage, server, secrets, logger } = await harness()
    await invoke(handlers, 'email:saveAccount', [
      accountBody({ host: '127.0.0.1', port: server.port, security: 'none' })
    ] as unknown as IpcArgs<'email:saveAccount'>)
    await invoke(handlers, 'reports:save', [weekly('summary')])
    current = MONDAY
    await deliverDueScheduledReports({
      storage,
      delivery: { secrets, transport: createNodemailerTransport(), logger, redacted: [] },
      now: () => new Date(MONDAY),
      timeZone: 'UTC'
    })
    const history = await invoke(handlers, 'deliveries:list', [{}])
    const sent = history[0]
    if (sent === undefined) throw new Error('missing scheduled delivery')
    const resent = await invoke(handlers, 'deliveries:resend', [{ id: sent.id }])
    expect(resent.outcome).toBe('sent')
    expect(server.mails).toHaveLength(2)
    expect(attachmentNames(server.mails[1]?.raw ?? '')).toEqual([])
  })
})

function attachmentNames(raw: string): string[] {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  return [...unfolded.matchAll(/Content-Disposition: attachment;\s*filename="?([^";\r\n]+)"?/gi)]
    .map((match) => match[1] ?? '')
    .filter((name) => name.length > 0)
}

function subjectLine(raw: string): string | undefined {
  return raw.split(/\r?\n/).find((line) => line.startsWith('Subject:'))
}

function weekly(format: ReportFormat): ReportSchedule {
  return {
    id: 'sched-1',
    name: 'Monday report',
    projectId: 'proj-1',
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format,
    sections: [],
    marketIds: ['mkt-us'],
    recipients: ['client@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project} weekly report',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z'
  }
}

function invoke<C extends IpcInvokeChannel>(
  handlers: IpcHandlerMap,
  channel: C,
  args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return Promise.resolve(callIpcHandler(handlers, channel, args)) as Promise<IpcResult<C>>
}

async function harness(): Promise<{
  handlers: IpcHandlerMap
  storage: AppStorage
  server: SmtpTestServer
  secrets: MemorySecretStore
  logger: ReturnType<typeof createLogger>
}> {
  current = SUNDAY
  const server = await startSmtpTestServer({ mode: 'none', username: 'mailer', password: PASSWORD })
  cleanups.push(() => server.close())
  const directory = mkdtempSync(join(tmpdir(), 'citefox-resend-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  seedProject(directory)
  const storage = openAppStorage(directory)
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logger = createLogger({ write: () => undefined, secrets: () => registry.list() })
  setEngineEmailTestPorts(storage, {
    clock: { now: () => new Date(current), timeZone: 'UTC' },
    sleep: async () => undefined
  })
  let closeHost: (() => void) | undefined
  let sequence = 0
  const deps: IpcHandlerDeps = {
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger,
    http: {
      async request() {
        throw new Error('no network')
      }
    },
    claudeCommand: {
      async run() {
        throw new Error('claude cli')
      }
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => registry.list(),
    now: () => new Date(current),
    createId: () => {
      sequence += 1
      return `id-${sequence}`
    },
    onHost: (opened) => {
      closeHost = () => opened.email.close()
    }
  }
  const handlers = createIpcHandlers(deps)
  cleanups.push(() => {
    closeHost?.()
    storage.close()
  })
  return { handlers, storage, server, secrets, logger }
}

function seedProject(directory: string): void {
  const storage = openAppStorage(directory)
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const project = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  const market = {
    id: 'mkt-us',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop' as const,
    localWording: false,
    serpapiLocation: null
  }
  insertMarket(project, market)
  writeProjectProfile(project, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: [],
    market
  })
  insertPage(project, {
    id: 'page-1',
    projectId: 'proj-1',
    url: 'https://textbolt.com/text-alerts',
    title: 'Text alerts',
    label: 'Alerts',
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: 40,
    promptSetVersion: null
  })
  addPageMarket(project, {
    pageId: 'page-1',
    marketId: 'mkt-us',
    addedAt: '2026-01-01T08:00:00.000Z',
    baselineRunId: null
  })
  closeDatabase(project)
  storage.close()
}
