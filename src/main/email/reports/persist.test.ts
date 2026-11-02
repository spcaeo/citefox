import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../../logging/logger'
import { MemorySecretStore } from '../../secrets/secret-store'
import { closeDatabase, openAppDatabase } from '../../storage'
import { MemoryDraftOpener } from '../draft'
import { PASSWORD, accountBody, facts, reportBody } from '../harness'
import { createEmailService, type EmailService } from '../service'
import { createStorageEmailStores, type StorageEmailStores } from '../storage-stores'
import { MemorySmtpTransport } from '../transport'
import { MemoryWebhookTransport } from '../webhook'
import type { ChangeEvent } from '../types'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('persisted on_change events', () => {
  test('a fresh store on the same file keeps score_drop and ignores other kinds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'citefox-report-events-'))
    roots.push(root)
    const dbPath = join(root, 'app.sqlite')
    const transport = new MemorySmtpTransport()
    const secrets = new MemorySecretStore()
    const first = openMail(dbPath, transport, secrets)
    first.service.saveAccount(accountBody())
    const saved = first.service.saveReport(
      reportBody({
        projectId: null,
        timing: { kind: 'on_change', events: ['score_drop'], scoreDropPoints: 5 },
        subject: '{project}'
      })
    )
    first.close()

    const second = openMail(dbPath, transport, secrets)
    const schedule = second.stores.reports.get(saved.id)
    expect(schedule?.timing).toEqual({
      kind: 'on_change',
      events: ['score_drop'],
      scoreDropPoints: 5
    })

    const equal = await second.service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-equal',
      paused: false,
      events: [drop(5), other('lost_citation'), other('gained_citation'), other('check_failed')],
      payload: { facts: facts(), attachment: null }
    })
    expect(equal).toEqual({ action: 'skipped', reason: 'empty' })
    expect(transport.sent).toHaveLength(0)

    const above = await second.service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-above',
      paused: false,
      events: [drop(6), other('lost_citation'), other('gained_citation'), other('check_failed')],
      payload: { facts: facts(), attachment: null }
    })
    expect(above.action).toBe('recorded')
    expect(transport.sent).toHaveLength(1)
    expect(transport.sent[0]?.message.text).toBe('Alerts score dropped by 6 points')
    second.close()
  })
})

function drop(points: number): ChangeEvent {
  return { kind: 'score_drop', pageId: 'page-1', pageLabel: 'Alerts', points }
}

function other(kind: 'lost_citation' | 'gained_citation' | 'check_failed'): ChangeEvent {
  return { kind, pageId: 'page-1', pageLabel: 'Alerts', points: null }
}

function openMail(
  dbPath: string,
  transport: MemorySmtpTransport,
  secrets: MemorySecretStore
): { service: EmailService; stores: StorageEmailStores; close(): void } {
  const db = openAppDatabase(dbPath)
  const stores = createStorageEmailStores({
    app: db,
    projectsDirectory: join(dbPath, '..', 'projects'),
    outboxDir: join(dbPath, '..', 'outbox'),
    clock: { now: () => new Date('2026-02-04T12:00:00.000Z'), timeZone: 'UTC' },
    logger: createLogger({ write: () => undefined })
  })
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
    logger: createLogger({ write: () => undefined }),
    clock: { now: () => new Date('2026-02-04T12:00:00.000Z'), timeZone: 'UTC' },
    sleep: async () => undefined,
    createId: (() => {
      let n = 0
      return () => {
        n += 1
        return `id-${n}`
      }
    })(),
    knownSecrets: () => [PASSWORD]
  })
  return {
    service,
    stores,
    close() {
      stores.close()
      closeDatabase(db)
    }
  }
}
