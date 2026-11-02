import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isResendDelivery,
  isSendNowDelivery,
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
 * Reports' Send now and the schedule scope, end to end through the IPC handlers.
 * Mail goes to the in-process SMTP test server only: no real email.
 */
const SUNDAY = '2026-02-01T00:00:00.000Z'
const MONDAY = '2026-02-02T09:00:00.000Z'
let current = SUNDAY
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('reports:save scope', () => {
  test('stores the scope, lists it back, and forces whole project where it cannot apply', async () => {
    const { handlers } = await harness()
    const saved = await invoke(handlers, 'reports:save', [
      weekly('pdf', { scope: { kind: 'group', ids: ['grp-1', 'grp-1', 'grp-2'] } })
    ])
    expect(saved.scope).toEqual({ kind: 'group', ids: ['grp-1', 'grp-2'] })
    const listed = await invoke(handlers, 'reports:list', [])
    expect(listed[0]?.scope).toEqual({ kind: 'group', ids: ['grp-1', 'grp-2'] })

    const project = await invoke(handlers, 'reports:save', [
      weekly('pdf', { scope: { kind: 'project', ids: ['grp-1'] } })
    ])
    expect(project.scope).toBeNull()
    const old = await invoke(handlers, 'reports:save', [weekly('pdf')])
    expect(old.scope).toBeNull()
    const all = await invoke(handlers, 'reports:save', [
      weekly('pdf', { projectId: null, scope: { kind: 'pages', ids: ['page-1'] } })
    ])
    expect(all.scope).toBeNull()

    await expect(
      invoke(handlers, 'reports:save', [
        weekly('pdf', { scope: { kind: 'everything', ids: [] } as unknown as null })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
    await expect(
      invoke(handlers, 'reports:save', [
        weekly('pdf', { scope: { kind: 'pages', ids: ['bad id!'] } })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
    await expect(
      invoke(handlers, 'reports:save', [
        weekly('pdf', {
          scope: { kind: 'pages', ids: Array.from({ length: 501 }, (_, i) => `p-${i}`) }
        })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
  })
})

describe('reports:sendNow', () => {
  test('emails the recipients the report with its file now, without taking the next slot', async () => {
    const { handlers, storage, server, secrets, logger } = await harness()
    await saveAccount(handlers, server)
    await invoke(handlers, 'reports:save', [weekly('pdf')])

    const sent = await invoke(handlers, 'reports:sendNow', [{ scheduleId: 'sched-1' }])
    expect(sent).toMatchObject({
      outcome: 'sent',
      ok: true,
      scheduleId: 'sched-1',
      projectId: 'proj-1',
      trigger: 'weekly'
    })
    expect(sent.recipients).toEqual(['client@example.com', 'boss@example.com'])
    expect(isSendNowDelivery(sent)).toBe(true)
    expect(isResendDelivery(sent)).toBe(false)
    expect(sent.occurrenceKey).toMatch(/^now:/)
    expect(server.mails).toHaveLength(1)
    const raw = server.mails[0]?.raw ?? ''
    expect(attachmentNames(raw)).toHaveLength(1)
    expect(attachmentNames(raw)[0]).toMatch(/\.pdf$/)
    expect(raw).toContain('client@example.com')
    expect(raw).toContain('boss@example.com')

    const history = await invoke(handlers, 'deliveries:list', [{ scheduleId: 'sched-1' }])
    expect(history.map((row) => row.id)).toEqual([sent.id])

    // Monday's scheduled send still goes out.
    current = MONDAY
    await deliverDueScheduledReports({
      storage,
      delivery: { secrets, transport: createNodemailerTransport(), logger, redacted: [] },
      now: () => new Date(MONDAY),
      timeZone: 'UTC'
    })
    expect(server.mails).toHaveLength(2)
  })

  test('a failed Send now keeps its now: key, so history still says Sent now', async () => {
    const { handlers } = await harness()
    await invoke(handlers, 'reports:save', [weekly('summary')])
    const failed = await invoke(handlers, 'reports:sendNow', [{ scheduleId: 'sched-1' }])
    expect(failed.outcome).toBe('failed')
    expect(isSendNowDelivery(failed)).toBe(true)
    const history = await invoke(handlers, 'deliveries:list', [{ scheduleId: 'sched-1' }])
    expect(history).toHaveLength(1)
    expect(isSendNowDelivery(history[0]!)).toBe(true)
  })

  test('a paused schedule still sends when asked; an unknown or deleted one is rejected', async () => {
    const { handlers, server } = await harness()
    await saveAccount(handlers, server)
    await invoke(handlers, 'reports:save', [weekly('summary')])
    await invoke(handlers, 'reports:setStatus', [{ id: 'sched-1', status: 'paused' }])

    const sent = await invoke(handlers, 'reports:sendNow', [{ scheduleId: 'sched-1' }])
    expect(sent.outcome).toBe('sent')
    expect(server.mails).toHaveLength(1)
    expect(attachmentNames(server.mails[0]?.raw ?? '')).toEqual([])

    await expect(invoke(handlers, 'reports:sendNow', [{ scheduleId: 'missing' }])).rejects.toThrow(
      'reports:sendNow: Unknown report'
    )
    await invoke(handlers, 'reports:delete', [{ projectId: 'proj-1', scheduleId: 'sched-1' }])
    await expect(invoke(handlers, 'reports:sendNow', [{ scheduleId: 'sched-1' }])).rejects.toThrow(
      'reports:sendNow: Unknown report'
    )
    await expect(
      invoke(handlers, 'reports:sendNow', [
        { scheduleId: 'sched-1', extra: 1 } as unknown as { scheduleId: string }
      ])
    ).rejects.toThrow('reports:sendNow: Invalid request')
    expect(server.mails).toHaveLength(1)
  })
})

async function saveAccount(handlers: IpcHandlerMap, server: SmtpTestServer): Promise<void> {
  await invoke(handlers, 'email:saveAccount', [
    accountBody({ host: '127.0.0.1', port: server.port, security: 'none' })
  ] as unknown as IpcArgs<'email:saveAccount'>)
}

function attachmentNames(raw: string): string[] {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ')
  return [...unfolded.matchAll(/Content-Disposition: attachment;\s*filename="?([^";\r\n]+)"?/gi)]
    .map((match) => match[1] ?? '')
    .filter((name) => name.length > 0)
}

function weekly(format: ReportFormat, overrides: Partial<ReportSchedule> = {}): ReportSchedule {
  return {
    id: 'sched-1',
    name: 'Monday report',
    projectId: 'proj-1',
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format,
    sections: [],
    marketIds: ['mkt-us'],
    recipients: ['client@example.com', 'boss@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project} weekly report',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides
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
  const directory = mkdtempSync(join(tmpdir(), 'citefox-send-now-'))
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
