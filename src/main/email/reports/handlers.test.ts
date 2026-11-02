import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReportSchedule } from '@shared/domain'
import {
  callIpcHandler,
  REPORT_ERROR_MESSAGES,
  type IpcArgs,
  type IpcHandlerMap,
  type IpcInvokeChannel,
  type IpcResult,
  type SaveEmailAccountRequest
} from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { createIpcHandlers, type IpcHandlerDeps } from '../../handlers'
import { createLogger } from '../../logging/logger'
import type { HttpTransport } from '../../providers/http'
import { MemorySecretStore, SecretRegistry } from '../../secrets/secret-store'
import {
  closeProjectDatabase,
  openAppStorage,
  openProjectDatabase,
  readProjectSchedule,
  writeProjectSchedule,
  type AppStorage
} from '../../storage'
import { MemoryDraftOpener } from '../draft'
import type { EngineHost } from '../../engine/host'
import { setEngineEmailTestPorts } from '../engine-email'
import { PASSWORD } from '../harness'
import { StorageReportStore } from '../storage-stores'
import { SmtpTransportError, MemorySmtpTransport } from '../transport'

const NOW = '2026-02-04T12:00:00.000Z'
const TOKEN = 'quilt-token'
const closers: Array<() => void> = []

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

describe('scheduled report handlers', () => {
  test('a new schedule is active, null account stays null, and update keeps status', async () => {
    const { handlers } = harness()
    expect(await invoke(handlers, 'reports:list', [])).toEqual([])
    expect(Object.hasOwn(handlers, 'reports:preview')).toBe(false)
    expect(
      await invoke(handlers, 'reports:delete', [{ projectId: 'proj-1', scheduleId: 'missing' }])
    ).toEqual({
      channel: 'reports:delete',
      code: 'not_found',
      message: REPORT_ERROR_MESSAGES.not_found
    })

    const created = await invoke(handlers, 'reports:save', [
      schedule({ status: 'paused', createdAt: '1999-01-01T00:00:00.000Z' })
    ])
    expect(created.status).toBe('active')
    expect(created.createdAt).toBe(NOW)
    expect(created.accountId).toBeNull()
    expect(created.nextSendAt).toBe('2026-02-09T08:00:00.000Z')

    const paused = await invoke(handlers, 'reports:setStatus', [
      { id: created.id, status: 'paused' }
    ])
    expect(paused.status).toBe('paused')
    expect(paused.nextSendAt).toBe('2026-02-09T08:00:00.000Z')

    const renamed = await invoke(handlers, 'reports:save', [
      schedule({ name: 'Renamed', status: 'active', createdAt: '2099-01-01T00:00:00.000Z' })
    ])
    expect(renamed).toMatchObject({
      name: 'Renamed',
      status: 'paused',
      createdAt: NOW,
      accountId: null
    })
    await expect(invoke(handlers, 'reports:save', [schedule({ subject: '' })])).rejects.toThrow(
      'reports:save: Invalid request'
    )
    await expect(
      invoke(handlers, 'reports:sendTest', [{ scheduleId: 'missing', accountId: null }])
    ).rejects.toThrow('reports:sendTest: Unknown report')
  })

  test('reports:delete returns deletedAt and not_found for a mismatch, a repeat, or an unknown id', async () => {
    const { handlers, storage, host } = harness()
    const project = await handlers['projects:create'](projectBody())
    await invoke(handlers, 'reports:save', [schedule({ id: 'sched-all', projectId: null })])
    await invoke(handlers, 'reports:save', [
      schedule({ id: 'sched-proj', projectId: project.id, name: 'Project report' })
    ])

    const notFound = {
      channel: 'reports:delete' as const,
      code: 'not_found' as const,
      message: REPORT_ERROR_MESSAGES.not_found
    }
    expect(
      await invoke(handlers, 'reports:delete', [{ projectId: project.id, scheduleId: 'sched-all' }])
    ).toEqual(notFound)
    expect(
      await invoke(handlers, 'reports:delete', [{ projectId: null, scheduleId: 'sched-proj' }])
    ).toEqual(notFound)
    expect(
      await invoke(handlers, 'reports:delete', [
        { projectId: 'other-proj', scheduleId: 'sched-proj' }
      ])
    ).toEqual(notFound)
    expect((await invoke(handlers, 'reports:list', [])).map((row) => row.id)).toEqual([
      'sched-all',
      'sched-proj'
    ])
    expect(scheduleDeletedAt(storage.db, 'sched-all')).toBeNull()
    expect(scheduleDeletedAt(storage.db, 'sched-proj')).toBeNull()

    expect(
      await invoke(handlers, 'reports:delete', [{ projectId: null, scheduleId: 'sched-all' }])
    ).toEqual({ ok: true, deletedAt: NOW })
    expect(scheduleDeletedAt(storage.db, 'sched-all')).toBe(NOW)
    expect(host.email.reports.get('sched-all')).toBeNull()
    expect((await invoke(handlers, 'reports:list', [])).map((row) => row.id)).toEqual([
      'sched-proj'
    ])
    expect(
      await invoke(handlers, 'reports:delete', [{ projectId: null, scheduleId: 'sched-all' }])
    ).toEqual(notFound)
    expect(scheduleDeletedAt(storage.db, 'sched-all')).toBe(NOW)

    expect(
      await invoke(handlers, 'reports:delete', [
        { projectId: project.id, scheduleId: 'sched-proj' }
      ])
    ).toEqual({ ok: true, deletedAt: NOW })
    expect(await invoke(handlers, 'reports:list', [])).toEqual([])
    expect(host.email.reports.get('sched-proj')).toBeNull()
    expect(
      await invoke(handlers, 'reports:delete', [
        { projectId: project.id, scheduleId: 'sched-missing' }
      ])
    ).toEqual(notFound)
  })

  test('stores which ready report a schedule sends, and refuses an unknown one', async () => {
    const { handlers, storage, host } = harness()
    const saved = await invoke(handlers, 'reports:save', [
      schedule({ id: 'sched-rival', report: { kind: 'rival', rival: 'twilio.com' } })
    ])
    expect(saved.report).toEqual({ kind: 'rival', rival: 'twilio.com' })
    const restarted = new StorageReportStore(storage.db, host.email.clock)
    expect(restarted.get('sched-rival')?.report).toEqual({ kind: 'rival', rival: 'twilio.com' })
    const plain = await invoke(handlers, 'reports:save', [schedule({ id: 'sched-plain' })])
    expect(plain.report ?? null).toBeNull()
    await expect(
      invoke(handlers, 'reports:save', [
        schedule({ id: 'sched-bad', report: { kind: 'nope' as 'impact', rival: null } })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
    await expect(
      invoke(handlers, 'reports:save', [
        schedule({ id: 'sched-bad2', report: { kind: 'rival', rival: 'not a host' } })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
  })

  test('on_change events are stored and nextSendAt is null', async () => {
    const { handlers, storage, host } = harness()
    const saved = await invoke(handlers, 'reports:save', [
      schedule({
        id: 'sched-change',
        timing: { kind: 'on_change', events: ['lost_citation', 'score_drop'], scoreDropPoints: 5 }
      })
    ])
    expect(saved.timing).toEqual({
      kind: 'on_change',
      events: ['lost_citation', 'score_drop'],
      scoreDropPoints: 5
    })
    expect(saved.nextSendAt).toBeNull()
    const listed = await invoke(handlers, 'reports:list', [])
    expect(listed.find((row) => row.id === 'sched-change')?.timing).toEqual(saved.timing)

    const restarted = new StorageReportStore(storage.db, host.email.clock)
    expect(restarted.get('sched-change')?.timing).toEqual(saved.timing)

    await expect(
      invoke(handlers, 'reports:save', [
        schedule({
          id: 'sched-dup',
          timing: {
            kind: 'on_change',
            events: ['lost_citation', 'lost_citation'],
            scoreDropPoints: 5
          }
        })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
    await expect(
      invoke(handlers, 'reports:save', [
        schedule({
          id: 'sched-eq',
          timing: { kind: 'on_change', events: ['score_drop'], scoreDropPoints: 5.5 }
        })
      ])
    ).rejects.toThrow('reports:save: Invalid request')
  })

  test('a paused or archived project has no next send', async () => {
    const { handlers, storage } = harness()
    const project = await handlers['projects:create'](projectBody())
    const nextCheckAt = '2026-03-02T09:00:00.000Z'
    writeProject(storage, project.slug, project.id, { nextCheckAt, paused: false })

    const after = await invoke(handlers, 'reports:save', [
      schedule({
        id: 'sched-after',
        projectId: project.id,
        timing: { kind: 'after_check' }
      })
    ])
    expect(after.nextSendAt).toBe(nextCheckAt)

    await handlers['projects:update']({ projectId: project.id, status: 'paused' })
    const paused = await invoke(handlers, 'reports:list', [])
    expect(paused.find((row) => row.id === 'sched-after')?.nextSendAt).toBeNull()

    await handlers['projects:update']({ projectId: project.id, status: 'active' })
    writeProject(storage, project.slug, project.id, { nextCheckAt, paused: true })
    const held = await invoke(handlers, 'reports:list', [])
    expect(held.find((row) => row.id === 'sched-after')?.nextSendAt).toBeNull()

    writeProject(storage, project.slug, project.id, { nextCheckAt, paused: false })
    const resumed = await invoke(handlers, 'reports:list', [])
    expect(resumed.find((row) => row.id === 'sched-after')?.nextSendAt).toBe(nextCheckAt)

    await handlers['projects:update']({ projectId: project.id, status: 'archived' })
    const archived = await invoke(handlers, 'reports:list', [])
    expect(archived.find((row) => row.id === 'sched-after')?.nextSendAt).toBeNull()
  })

  test('sendTest uses the requested account and only that account address', async () => {
    const { handlers, transport } = harness()
    const primary = await invoke(handlers, 'email:saveAccount', [
      account({ fromAddress: 'ada@example.com', isDefault: true })
    ])
    const other = await invoke(handlers, 'email:saveAccount', [
      account({ fromAddress: 'bea@example.com', isDefault: false })
    ])
    await invoke(handlers, 'reports:save', [schedule({ accountId: other.id })])

    const byDefault = await invoke(handlers, 'reports:sendTest', [
      { scheduleId: 'sched-1', accountId: null }
    ])
    expect(byDefault).toMatchObject({
      ok: true,
      host: 'smtp.example.com',
      testedAt: NOW,
      nextStep: null
    })
    expect(byDefault.message).toBe(`Test sent through smtp.example.com at ${NOW}.`)
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.message.to).toEqual(['ada@example.com'])
    expect(transport.sent[0]?.auth.password).toBe(PASSWORD)
    expect(JSON.stringify(byDefault)).not.toContain(PASSWORD)

    const byId = await invoke(handlers, 'reports:sendTest', [
      { scheduleId: 'sched-1', accountId: other.id }
    ])
    expect(byId.ok).toBe(true)
    expect(transport.sent[1]?.message.to).toEqual(['bea@example.com'])
    expect(primary.fromAddress).toBe('ada@example.com')

    await invoke(handlers, 'email:setMode', [{ mode: 'mail_app' }])
    await invoke(handlers, 'reports:sendTest', [{ scheduleId: 'sched-1', accountId: null }])
    expect(transport.sent).toHaveLength(3)
  })

  test('sendTest and resend error paths redact a planted secret', async () => {
    const { handlers, transport, logs, storage } = harness()
    await invoke(handlers, 'email:saveAccount', [account()])
    await invoke(handlers, 'reports:save', [schedule()])
    const sent = await invoke(handlers, 'reports:sendTest', [
      { scheduleId: 'sched-1', accountId: null }
    ])
    expect(sent.ok).toBe(true)
    const deliveries = await invoke(handlers, 'deliveries:list', [{}])
    const original = deliveries[0]
    if (original === undefined) throw new Error('missing delivery')

    transport.failure = new SmtpTransportError(
      `auth failed ${PASSWORD} Bearer ${TOKEN} smtp_password=${PASSWORD}`,
      'auth',
      535
    )
    const failedTest = await invoke(handlers, 'reports:sendTest', [
      { scheduleId: 'sched-1', accountId: null }
    ])
    const failedResend = await invoke(handlers, 'deliveries:resend', [{ id: original.id }])
    const history = await invoke(handlers, 'deliveries:list', [{ scheduleId: 'sched-1' }])
    const blob = `${JSON.stringify(failedTest)}\n${JSON.stringify(failedResend)}\n${JSON.stringify(history)}\n${logs.join('\n')}`
    expect(failedTest.ok).toBe(false)
    expect(failedTest.message).toBe('Authentication failed (535).')
    expect(failedTest.nextStep).toBe('Fix in Email setup')
    expect(failedResend.outcome).toBe('failed')
    expect(failedResend.ok).toBe(false)
    expect(failedResend.reason).toBe('Authentication failed (535).')
    expect(blob).not.toContain(PASSWORD)
    expect(blob).not.toContain(TOKEN)
    expect(blob).toContain('[REDACTED]')
    expect(treeHas(storage.paths.root, PASSWORD)).toBe(false)
    expect(treeHas(storage.paths.root, TOKEN)).toBe(false)
  })

  test('delivery history filters by schedule, sorts failures first, and resend keeps recipients', async () => {
    const { handlers, transport, drafts } = harness()
    await invoke(handlers, 'email:saveAccount', [account({ fromAddress: 'ada@example.com' })])
    await invoke(handlers, 'reports:save', [schedule()])
    await invoke(handlers, 'reports:save', [
      schedule({ id: 'sched-2', timing: { kind: 'after_check' } })
    ])
    transport.failure = new SmtpTransportError('nope', 'auth', 535)
    await invoke(handlers, 'reports:sendTest', [{ scheduleId: 'sched-1', accountId: null }])
    transport.failure = null
    await invoke(handlers, 'reports:sendTest', [{ scheduleId: 'sched-1', accountId: null }])
    await invoke(handlers, 'reports:sendTest', [{ scheduleId: 'sched-2', accountId: null }])

    const one = await invoke(handlers, 'deliveries:list', [{ scheduleId: 'sched-1' }])
    expect(one.map((row) => row.outcome)).toEqual(['failed', 'sent'])
    expect(one.every((row) => row.scheduleId === 'sched-1')).toBe(true)
    const all = await invoke(handlers, 'deliveries:list', [{}])
    expect(all).toHaveLength(3)
    expect(all[0]).toMatchObject({ scheduleId: 'sched-1', outcome: 'failed' })
    expect(all.filter((row) => row.scheduleId === 'sched-2')).toHaveLength(1)

    const failed = one[0]
    if (failed === undefined) throw new Error('missing failed delivery')
    const again = await invoke(handlers, 'deliveries:resend', [{ id: failed.id }])
    expect(again.id).not.toBe(failed.id)
    expect(again.outcome).toBe('sent')
    expect(again.ok).toBe(true)
    expect(again.recipients).toEqual(failed.recipients)
    expect(again.recipients).toEqual(['ada@example.com'])
    expect(transport.sent.at(-1)?.message.to).toEqual(['ada@example.com'])
    expect(transport.sent.at(-1)?.message.subject).toBe('{project} {score}')
    expect(transport.sent.at(-1)?.message.text).toBe('Resent Monday report.')

    const before = transport.sent.length
    await invoke(handlers, 'email:setMode', [{ mode: 'mail_app' }])
    const drafted = await invoke(handlers, 'deliveries:resend', [{ id: again.id }])
    expect(drafted.outcome).toBe('draft')
    expect(drafted.ok).toBe(false)
    expect(drafts.drafts.at(-1)?.to).toEqual(['ada@example.com'])
    expect(transport.sent).toHaveLength(before)

    await expect(invoke(handlers, 'deliveries:resend', [{ id: 'missing' }])).rejects.toThrow(
      'deliveries:resend: Unknown delivery'
    )
    await expect(
      invoke(handlers, 'reports:sendTest', [
        { scheduleId: 'sched-1' } as Parameters<IpcHandlerMap['reports:sendTest']>[0]
      ])
    ).rejects.toThrow('reports:sendTest: Invalid request')
  })

  test('a secret-shaped subject is rejected and not stored', async () => {
    const { handlers, logs } = harness()
    await expect(
      invoke(handlers, 'reports:save', [schedule({ subject: `Bearer ${TOKEN}` })])
    ).rejects.toThrow('reports:save: subject cannot contain a secret')
    expect(await invoke(handlers, 'reports:list', [])).toEqual([])
    const blob = logs.join('\n')
    expect(blob).not.toContain(TOKEN)
  })
})

function writeProject(
  storage: AppStorage,
  slug: string,
  projectId: string,
  patch: { nextCheckAt: string; paused: boolean }
): void {
  const db = openProjectDatabase(storage.paths.projectsDirectory, slug)
  try {
    const current = readProjectSchedule(db, projectId)
    writeProjectSchedule(db, { ...current, ...patch })
  } finally {
    closeProjectDatabase(db)
  }
}

function schedule(overrides: Partial<ReportSchedule> = {}): ReportSchedule {
  return {
    id: 'sched-1',
    name: 'Monday report',
    projectId: null,
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format: 'summary',
    sections: ['results'],
    marketIds: [],
    recipients: ['client@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project} {score}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides
  }
}

function account(overrides: Partial<SaveEmailAccountRequest> = {}): SaveEmailAccountRequest {
  return {
    id: null,
    provider: 'other',
    fromName: 'CiteFox',
    fromAddress: 'reports@example.com',
    replyTo: null,
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: 'mailer',
    password: PASSWORD,
    isDefault: true,
    ...overrides
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

function invoke<C extends IpcInvokeChannel>(
  handlers: IpcHandlerMap,
  channel: C,
  args: IpcArgs<C>
): Promise<IpcResult<C>> {
  return Promise.resolve(callIpcHandler(handlers, channel, args)) as Promise<IpcResult<C>>
}

function harness(): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
  logs: string[]
  host: EngineHost
  transport: MemorySmtpTransport
  drafts: MemoryDraftOpener
} {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-reports-'))
  const storage = openAppStorage(directory)
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logs: string[] = []
  const transport = new MemorySmtpTransport()
  const drafts = new MemoryDraftOpener()
  setEngineEmailTestPorts(storage, {
    transport,
    drafts,
    clock: { now: () => new Date(NOW), timeZone: 'UTC' },
    sleep: async () => undefined
  })
  let host: EngineHost | undefined
  const deps: IpcHandlerDeps = {
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets,
    logger: createLogger({
      write: (_level, line) => {
        logs.push(line)
      },
      secrets: () => registry.list()
    }),
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
    createId: sequentialIds(),
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
  return { handlers, storage, logs, host: opened, transport, drafts }
}

function scheduleDeletedAt(db: AppStorage['db'], id: string): string | null | undefined {
  return db
    .prepare<unknown[], { deleted_at: string | null }>(
      `SELECT deleted_at FROM report_schedules WHERE id = ?`
    )
    .get(id)?.deleted_at
}

function sequentialIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}

function idleHttp(): HttpTransport {
  return {
    async request() {
      throw new Error('no network')
    }
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
