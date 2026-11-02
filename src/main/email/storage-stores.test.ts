import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { Logger } from '../logging/logger'
import { MemorySecretStore } from '../secrets/secret-store'
import {
  closeDatabase,
  closeProjectDatabase,
  createProjectDatabase,
  deleteProject,
  insertDelivery,
  insertProject,
  markEmailThrottle,
  getAlertSettings,
  openAppDatabase,
  openProjectDatabase,
  projectDatabaseRelativePath,
  StorageError,
  type SqliteDatabase
} from '../storage'
import { requireOptionalLabel } from '../storage/values'
import { MemoryDraftOpener } from './draft'
import { FIX_IN_EMAIL_SETUP } from './errors'
import { dueOccurrences } from './due'
import { accountBody, facts, notice, PASSWORD, reportBody } from './harness'
import { createEmailService, type EmailService } from './service'
import {
  createStorageEmailStores,
  StorageAlertStore,
  StorageDeliveryStore,
  StorageReportStore,
  type StorageEmailStores
} from './storage-stores'
import { SmtpTransportError, MemorySmtpTransport } from './transport'
import type { DeliveryRecord, EmailClock, ReportSchedule, StoredAlertSettings } from './types'
import { MemoryWebhookTransport } from './webhook'

const WEBHOOK = 'https://hooks.slack.com/services/T00/B00/quiltmaplehook'
const WHEN = '2026-02-04T12:00:00.000Z'
const fixtures: Fixture[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close()
})

describe('storage-backed email sends', () => {
  test('sends summary, slack, cap, and the monthly pdf once', async () => {
    const { db, service, transport, webhooks, stores, outbox } = openFixture()
    const account = service.saveAccount(accountBody())
    service.updateAlerts({
      projectId: 'proj-1',
      emailAfterCheck: true,
      emailAccountId: account.id,
      emailTo: ['ada@example.com'],
      slackEnabled: true,
      slackWebhook: WEBHOOK,
      monthlyClientPdf: true
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
    expect(first.slack.action).toBe('recorded')
    const second = await service.notifyCheckFinished(finished)
    expect(second.email).toEqual({ action: 'skipped', reason: 'already_sent' })
    expect(second.slack).toEqual({ action: 'skipped', reason: 'already_sent' })

    const alert = {
      at: WHEN,
      projectId: 'proj-1',
      name: 'TextBolt',
      used: 10,
      cap: 10,
      month: '2026-02'
    }
    expect((await service.notifyCap({ alert, paused: false })).action).toBe('recorded')
    expect(await service.notifyCap({ alert, paused: false })).toEqual({
      action: 'skipped',
      reason: 'already_sent'
    })

    service.queueMonthlyPdf({
      projectId: 'proj-1',
      projectName: 'TextBolt',
      dueDate: '2026-02-01',
      filename: 'textbolt.pdf',
      bytes: Uint8Array.of(1, 2, 3)
    })
    const released = await service.releaseDue({ isPaused: () => false, factsFor: () => null })
    expect(released.map((result) => result.action)).toEqual(['recorded'])
    const releasedAgain = await service.releaseDue({
      isPaused: () => false,
      factsFor: () => null
    })
    expect(releasedAgain).toEqual([])

    expect(transport.sent).toHaveLength(3)
    expect(webhooks.posts).toHaveLength(1)
    expect(deliveryRows(db)).toEqual([
      { trigger: 'check_summary', outcome: 'sent', occurrence_key: 'summary:proj-1:check-1' },
      { trigger: 'slack', outcome: 'sent', occurrence_key: 'slack:proj-1:check-1' },
      { trigger: 'cap', outcome: 'sent', occurrence_key: 'cap:proj-1:2026-02' },
      { trigger: 'monthly_pdf', outcome: 'sent', occurrence_key: 'pdf:proj-1:2026-02-01' }
    ])
    expect(throttleKeys(db)).toEqual([
      'cap:proj-1:2026-02',
      'desktop:proj-1:page-1:check-1',
      'pdf:proj-1:2026-02-01',
      'slack:proj-1:check-1',
      'summary:proj-1:check-1'
    ])
    const raced = stores.deliveries.add(sentRow('del-race', 'summary:proj-1:check-1'))
    expect(raced).toBe('already_sent')
    expect(count(db, 'deliveries')).toBe(4)
    expect(count(db, 'email_throttle')).toBe(5)
    expect(readdirSync(outbox).filter((name) => name.endsWith('.pdf'))).toEqual([])
    const dumped = JSON.stringify(db.prepare(`SELECT * FROM email_accounts`).all())
    expect(dumped).not.toContain(PASSWORD)
    expect(dumped).not.toContain('quiltmaplehook')
  })

  test('a failed summary stores a null occurrence key and the retry succeeds', async () => {
    const { db, service, transport } = openFixture()
    const account = service.saveAccount(accountBody())
    service.updateAlerts({
      projectId: 'proj-1',
      emailAfterCheck: true,
      emailAccountId: account.id,
      emailTo: ['ada@example.com']
    })
    transport.failure = new SmtpTransportError('nope', 'auth', 535)
    const finished = {
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: false,
      pages: [{ failed: false, notice: notice() }]
    }
    const failed = await service.notifyCheckFinished(finished)
    expect(failed.email.action).toBe('recorded')
    if (failed.email.action === 'recorded') {
      expect(failed.email.delivery.outcome).toBe('failed')
      expect(failed.email.delivery.occurrenceKey).toBeNull()
      expect(failed.email.delivery.ok).toBe(false)
    }
    expect(deliveryRows(db)).toEqual([
      { trigger: 'check_summary', outcome: 'failed', occurrence_key: null }
    ])
    expect(nextSteps(db)).toEqual([FIX_IN_EMAIL_SETUP])
    expect(throttleKeys(db)).toEqual(['desktop:proj-1:page-1:check-1'])

    transport.failure = null
    const retried = await service.notifyCheckFinished(finished)
    expect(retried.email.action).toBe('recorded')
    if (retried.email.action === 'recorded') {
      expect(retried.email.delivery.outcome).toBe('sent')
      expect(retried.email.delivery.occurrenceKey).toBe('summary:proj-1:check-1')
      expect(retried.email.delivery.ok).toBe(true)
    }
    expect(deliveryRows(db)).toEqual([
      { trigger: 'check_summary', outcome: 'failed', occurrence_key: null },
      { trigger: 'check_summary', outcome: 'sent', occurrence_key: 'summary:proj-1:check-1' }
    ])
    expect(nextSteps(db)).toEqual([FIX_IN_EMAIL_SETUP, null])
    expect(await service.notifyCheckFinished(finished)).toMatchObject({
      email: { action: 'skipped', reason: 'already_sent' }
    })
    expect(transport.sent).toHaveLength(1)
  })

  test('a throttle mark failure rolls back the delivery, and an insert failure rolls back the mark', () => {
    const { db, clock, stores } = openFixture()
    const markFails = new StorageDeliveryStore(
      db,
      clock,
      {
        insert: (database, delivery) => insertDelivery(database, delivery),
        mark: (database, key, at) => {
          markEmailThrottle(database, key, at)
          throw new Error('throttle mark failed')
        }
      },
      quietLogger()
    )
    expect(() => markFails.add(sentRow('del-mark', 'summary:proj-1:check-mark'))).toThrow(
      /throttle mark failed/
    )
    expect(count(db, 'deliveries')).toBe(0)
    expect(count(db, 'email_throttle')).toBe(0)

    const insertFails = new StorageDeliveryStore(
      db,
      clock,
      {
        insert: (database, delivery) => {
          // The mark is inside this callback, which the store runs in its transaction.
          // Throwing after both writes must undo the throttle as well as the row.
          if (delivery.occurrenceKey !== null) {
            markEmailThrottle(database, delivery.occurrenceKey, delivery.at)
          }
          insertDelivery(database, delivery)
          throw new Error('delivery insert failed')
        },
        mark: () => {
          throw new Error('mark ran after a failed insert')
        }
      },
      quietLogger()
    )
    expect(() => insertFails.add(sentRow('del-insert', 'summary:proj-1:check-insert'))).toThrow(
      /delivery insert failed/
    )
    expect(count(db, 'deliveries')).toBe(0)
    expect(count(db, 'email_throttle')).toBe(0)

    expect(() =>
      stores.deliveries.add({
        ...sentRow('del-fk', 'summary:proj-1:check-fk'),
        projectId: 'missing-proj'
      })
    ).toThrow(/referenced row is missing/)
    expect(count(db, 'deliveries')).toBe(0)
    expect(count(db, 'email_throttle')).toBe(0)
  })

  test('a duplicate monthly pdf is already queued and leaves no extra file', () => {
    const { db, stores, outbox } = openFixture()
    const first = stores.pdfs.add(pdf('pdf-1'))
    const second = stores.pdfs.add(pdf('pdf-2'))
    expect(first).toBe('queued')
    expect(second).toBe('already_queued')
    expect(stores.pdfs.list().map((item) => item.id)).toEqual(['pdf-1'])
    expect(readdirSync(outbox)).toEqual(['pdf-1.pdf'])
    const created = db
      .prepare<unknown[], { created_at: string }>(`SELECT created_at FROM pending_client_pdfs`)
      .get()
    expect(created).toEqual({ created_at: WHEN })
  })

  test('a paused project or schedule skips without marking the occurrence', async () => {
    const { db, service, stores, transport } = openFixture()
    const account = service.saveAccount(accountBody())
    service.updateAlerts({
      projectId: 'proj-1',
      desktop: true,
      emailAfterCheck: true,
      emailAccountId: account.id,
      emailTo: ['ada@example.com'],
      monthlyClientPdf: true
    })
    const finished = {
      checkId: 'check-1',
      projectId: 'proj-1',
      projectName: 'TextBolt',
      paused: true,
      pages: [{ failed: false, notice: notice() }]
    }
    const pausedProject = await service.notifyCheckFinished(finished)
    expect(pausedProject.skipped).toBe('paused')
    expect(pausedProject.email).toEqual({ action: 'skipped', reason: 'paused' })
    expect(count(db, 'deliveries')).toBe(0)
    expect(throttleKeys(db)).toEqual([])

    const schedule = service.saveReport(reportBody({ timing: { kind: 'after_check' } }))
    stores.reports.save({ ...schedule, status: 'paused' })
    const pausedSchedule = await service.sendAfterChecks({
      checkId: 'check-2',
      projectId: 'proj-1',
      paused: false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(pausedSchedule).toEqual([{ action: 'skipped', reason: 'paused' }])
    expect(stores.deliveries.hasThrottle(`after:${schedule.id}:check-2`)).toBe(false)

    service.queueMonthlyPdf({
      projectId: 'proj-1',
      projectName: 'TextBolt',
      dueDate: '2026-02-01',
      filename: 'textbolt.pdf',
      bytes: Uint8Array.of(4)
    })
    const held = await service.releaseDue({ isPaused: () => true, factsFor: () => null })
    expect(held).toEqual([{ action: 'skipped', reason: 'paused' }])
    expect(stores.deliveries.hasThrottle('pdf:proj-1:2026-02-01')).toBe(false)
    expect(stores.pdfs.list()).toHaveLength(1)
    expect(transport.sent).toHaveLength(0)

    stores.reports.save({ ...schedule, status: 'active' })
    const sent = await service.sendAfterChecks({
      checkId: 'check-2',
      projectId: 'proj-1',
      paused: false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(sent.map((result) => result.action)).toEqual(['recorded'])
    expect(stores.deliveries.hasThrottle(`after:${schedule.id}:check-2`)).toBe(true)
    const woke = await service.releaseDue({ isPaused: () => false, factsFor: () => null })
    expect(woke.map((result) => result.action)).toEqual(['recorded'])
    expect(stores.pdfs.list()).toEqual([])
    expect(stores.deliveries.hasThrottle('pdf:proj-1:2026-02-01')).toBe(true)
  })

  test('createdAt comes from the clock, stays put on update, and catch-up uses it after restart', async () => {
    const { db, service, stores, clock, setNow, transport, webhooks, secrets } = openFixture()
    service.saveAccount(accountBody())
    stores.reports.save(weeklySchedule('1999-01-01T00:00:00.000Z'))
    expect(stores.reports.get('sched-week')?.createdAt).toBe(WHEN)
    expect(scheduleCreatedAt(db, 'sched-week')).toBe(WHEN)
    expect(
      await service.releaseDue({
        isPaused: () => false,
        factsFor: () => ({ facts: facts(), attachment: null })
      })
    ).toEqual([])

    setNow('2026-02-09T10:00:00.000Z')
    const current = stores.reports.get('sched-week')
    if (current === null) throw new Error('schedule missing')
    stores.reports.save({ ...current, name: 'Renamed', createdAt: '2001-01-01T00:00:00.000Z' })
    expect(stores.reports.get('sched-week')).toMatchObject({ name: 'Renamed', createdAt: WHEN })
    expect(scheduleCreatedAt(db, 'sched-week')).toBe(WHEN)

    const restartedReports = new StorageReportStore(db, clock)
    expect(restartedReports.get('sched-week')?.createdAt).toBe(WHEN)
    const restarted = emailService({
      stores,
      clock,
      transport,
      webhooks,
      secrets,
      reports: restartedReports
    })
    const sent = await restarted.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(sent.map((result) => result.action)).toEqual(['recorded'])
    expect(restartedReports.get('sched-week')?.createdAt).toBe(WHEN)
    expect(scheduleCreatedAt(db, 'sched-week')).toBe(WHEN)
    expect(
      await restarted.releaseDue({
        isPaused: () => false,
        factsFor: () => ({ facts: facts(), attachment: null })
      })
    ).toEqual([])
    expect(transport.sent).toHaveLength(1)
  })

  test('nextStep round-trips, including null and a value storage would reject', () => {
    const { db, stores, lines } = openFixture()
    expect(stores.deliveries.add(sentRow('del-step', 'summary:proj-1:check-step'))).toBe('recorded')
    const withStep = failedRow('del-guide', 'Fix in Email setup')
    expect(stores.deliveries.add(withStep)).toBe('recorded')
    expect(stores.deliveries.list().find((row) => row.id === 'del-guide')?.nextStep).toBe(
      'Fix in Email setup'
    )
    expect(storedNextStep(db, 'del-guide')).toBe('Fix in Email setup')
    expect(storedNextStep(db, 'del-step')).toBeNull()

    const omitted = failedRow('del-null', null)
    expect(stores.deliveries.add(omitted)).toBe('recorded')
    expect(stores.deliveries.list().find((row) => row.id === 'del-null')?.nextStep).toBeNull()
    expect(storedNextStep(db, 'del-null')).toBeNull()

    const exact = 'B'.repeat(500)
    expect(stores.deliveries.add(failedRow('del-exact', exact))).toBe('recorded')
    expect(stores.deliveries.list().find((row) => row.id === 'del-exact')?.nextStep).toBe(exact)

    const over = `${'A'.repeat(499)} tail`
    expect(over.length).toBeGreaterThan(500)
    expect(stores.deliveries.add(failedRow('del-long', over))).toBe('recorded')
    const capped = `${'A'.repeat(499)}`
    expect(stores.deliveries.list().find((row) => row.id === 'del-long')?.nextStep).toBe(capped)
    expect(storedNextStep(db, 'del-long')).toBe(capped)
    expect(count(db, 'deliveries')).toBe(5)
    expect(lines).toEqual([])
  })

  test('an invalid next step is omitted and the occurrence is still sent once', () => {
    const { db, stores, lines } = openFixture()
    const control = 'Fix\u0007setup'
    const secret = 'sk-ant-abcdefghijklmnopqrstuvwxyz'
    expect(() => requireOptionalLabel(control, 'next step', 500)).toThrow(StorageError)
    expect(() => requireOptionalLabel(secret, 'next step', 500)).toThrow(StorageError)
    expect(requireOptionalLabel('Fix in Email setup', 'next step', 500)).toBe('Fix in Email setup')

    const controlKey = 'summary:proj-1:check-control'
    expect(stores.deliveries.add(sentWithStep('del-control', controlKey, control))).toBe('recorded')
    expect(storedNextStep(db, 'del-control')).toBeNull()
    expect(stores.deliveries.hasThrottle(controlKey)).toBe(true)
    expect(stores.deliveries.add(sentWithStep('del-control-2', controlKey, control))).toBe(
      'already_sent'
    )

    const secretKey = 'summary:proj-1:check-secret'
    expect(stores.deliveries.add(sentWithStep('del-secret', secretKey, secret))).toBe('recorded')
    expect(storedNextStep(db, 'del-secret')).toBeNull()
    expect(stores.deliveries.hasThrottle(secretKey)).toBe(true)
    expect(stores.deliveries.add(sentWithStep('del-secret-2', secretKey, secret))).toBe(
      'already_sent'
    )

    expect(count(db, 'deliveries')).toBe(2)
    expect(count(db, 'email_throttle')).toBe(2)
    const logged = lines.join('\n')
    expect(logged).toContain('Delivery next step omitted')
    expect(logged).toContain('[REDACTED]')
    expect(logged).not.toContain(control)
    expect(logged).not.toContain(secret)
    // Each add checks the step before insert, including the already-sent retry.
    expect(logged.match(/Delivery next step omitted/g)).toHaveLength(4)
  })

  test('delete stamps deleted_at, rejects a project mismatch, and due delivery skips the row', async () => {
    const { db, service, stores, transport, clock, setNow } = openFixture()
    service.saveAccount(accountBody())
    const created = '2026-02-01T00:00:00.000Z'
    setNow(created)
    stores.reports.save(weeklySchedule(created, { id: 'sched-all', projectId: null }))
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-proj',
        projectId: 'proj-1',
        recipients: ['proj@example.com']
      })
    )
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-live',
        projectId: 'proj-1',
        recipients: ['live@example.com']
      })
    )
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-raw',
        projectId: 'proj-1',
        recipients: ['raw@example.com']
      })
    )
    setNow(WHEN)
    const pending = stores.reports.get('sched-all')
    if (pending === null) throw new Error('schedule missing')
    expect(dueOccurrences(pending, Date.parse(WHEN)).map((item) => item.key)).toEqual([
      'weekly:2026-02-02'
    ])

    expect(stores.reports.delete('proj-1', 'sched-all')).toBeNull()
    expect(stores.reports.delete(null, 'sched-proj')).toBeNull()
    expect(stores.reports.delete('proj-other', 'sched-proj')).toBeNull()
    expect(scheduleDeletedAt(db, 'sched-all')).toBeNull()
    expect(scheduleDeletedAt(db, 'sched-proj')).toBeNull()

    expect(stores.reports.delete(null, 'sched-all')).toBe(WHEN)
    expect(stores.reports.delete('proj-1', 'sched-proj')).toBe(WHEN)
    expect(stores.reports.delete(null, 'sched-all')).toBeNull()
    expect(stores.reports.delete('proj-1', 'sched-proj')).toBeNull()
    expect(stores.reports.delete('proj-1', 'sched-missing')).toBeNull()
    expect(scheduleDeletedAt(db, 'sched-all')).toBe(WHEN)
    expect(scheduleDeletedAt(db, 'sched-proj')).toBe(WHEN)

    db.prepare(`UPDATE report_schedules SET deleted_at = ? WHERE id = ?`).run(WHEN, 'sched-raw')
    const restarted = new StorageReportStore(db, clock)
    expect(restarted.list().map((row) => row.id)).toEqual(['sched-live'])
    expect(restarted.get('sched-all')).toBeNull()
    expect(restarted.get('sched-proj')).toBeNull()
    expect(restarted.get('sched-raw')).toBeNull()
    expect(restarted.get('sched-live')?.recipients).toEqual(['live@example.com'])

    const sent = await service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(
      sent.map((result) => (result.action === 'recorded' ? result.delivery.scheduleId : result))
    ).toEqual(['sched-live'])
    expect(transport.sent.map((item) => [...item.message.to])).toEqual([['live@example.com']])
    expect(scheduleDeletedAt(db, 'sched-live')).toBeNull()
  })

  test('a project with no alerts row defaults desktop on and does not insert a row', () => {
    const { db, projectsDirectory } = openFixture()
    const alerts = new StorageAlertStore(db, projectsDirectory)
    try {
      expect(alerts.get('proj-1')).toMatchObject({
        projectId: 'proj-1',
        desktop: true,
        emailAfterCheck: false,
        emailAccountId: null,
        emailTo: [],
        slackEnabled: false,
        slackKeychainRef: null,
        monthlyClientPdf: false,
        monthlyPdfTo: null
      })
      const project = openProjectDatabase(projectsDirectory, 'textbolt')
      try {
        const count = project
          .prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM alert_settings`)
          .get()
        expect(count?.n).toBe(0)
        expect(getAlertSettings(project, 'proj-1').desktop).toBe(false)
      } finally {
        closeProjectDatabase(project)
      }
      alerts.save(alertSettings({ desktop: false, emailAfterCheck: true }))
      expect(alerts.get('proj-1')).toMatchObject({ desktop: false, emailAfterCheck: true })
    } finally {
      alerts.close()
    }
  })

  test('deleting a project closes and evicts its alert database', () => {
    const { db, projectsDirectory } = openFixture()
    const alerts = new RecordingAlertStore(db, projectsDirectory)
    const saved = alertSettings({ emailAfterCheck: true })
    alerts.save(saved)

    try {
      const closed = alerts.evictProject('proj-1')
      expect(closed?.open).toBe(false)
      expect(alerts.evictProject('proj-1')).toBeNull()
      expect(alerts.get('proj-1')).toEqual(saved)

      deleteProject(db, 'proj-1')
      expect(alerts.get('proj-1')).toBeNull()
      expect(() => alerts.save(saved)).toThrow(/Project database does not exist/)
      expect(alerts.evictProject('proj-1')).toBeNull()
      expect(alerts.closed).toHaveLength(2)
      expect(alerts.closed.every((handle) => handle.open === false)).toBe(true)

      insertProject(db, textboltProject())
      expect(alerts.get('proj-1')).toEqual(saved)
    } finally {
      alerts.close()
    }
  })

  test('monthlyPdfTo round-trips on a project database migrated through 014', () => {
    const { db, service, stores, projectsDirectory } = openFixture()
    const migrated = openProjectDatabase(projectsDirectory, 'textbolt')
    try {
      const applied = migrated
        .prepare<unknown[], { version: number; name: string }>(
          `SELECT version, name FROM schema_migrations ORDER BY version ASC`
        )
        .all()
      expect(applied.find((row) => row.version === 14)).toEqual({
        version: 14,
        name: '014_alert_settings_monthly_pdf_to'
      })
      expect(
        migrated
          .prepare<unknown[], { name: string }>(
            `SELECT name FROM pragma_table_info('alert_settings') WHERE name = ?`
          )
          .get('monthly_pdf_to')?.name
      ).toBe('monthly_pdf_to')
    } finally {
      closeProjectDatabase(migrated)
    }

    const before = service.updateAlerts({ projectId: 'proj-1', desktop: true })
    expect(before.monthlyPdfTo).toBeNull()
    expect(before.desktop).toBe(true)
    expect(storedMonthlyPdfTo(projectsDirectory, 'textbolt')).toBeNull()

    const saved = service.updateAlerts({
      projectId: 'proj-1',
      monthlyPdfTo: 'client@example.com',
      monthlyClientPdf: true
    })
    expect(saved.monthlyPdfTo).toBe('client@example.com')
    expect(service.getAlerts({ projectId: 'proj-1' }).monthlyPdfTo).toBe('client@example.com')
    expect(storedMonthlyPdfTo(projectsDirectory, 'textbolt')).toBe('client@example.com')

    const kept = service.updateAlerts({ projectId: 'proj-1', desktop: false })
    expect(kept.monthlyPdfTo).toBe('client@example.com')
    expect(kept.desktop).toBe(false)
    const cleared = service.updateAlerts({ projectId: 'proj-1', monthlyPdfTo: null })
    expect(cleared.monthlyPdfTo).toBeNull()
    expect(storedMonthlyPdfTo(projectsDirectory, 'textbolt')).toBeNull()

    service.updateAlerts({ projectId: 'proj-1', monthlyPdfTo: 'ada@example.com' })
    stores.close()
    const reopened = new StorageAlertStore(db, projectsDirectory)
    try {
      expect(reopened.get('proj-1')?.monthlyPdfTo).toBe('ada@example.com')
    } finally {
      reopened.close()
    }
  })

  test('usedFor lists projects and live schedules that name the account', () => {
    const { db, service, stores, projectsDirectory } = openFixture()
    const primary = service.saveAccount(accountBody())
    const other = service.saveAccount(
      accountBody({ fromAddress: 'other@example.com', username: 'other', isDefault: false })
    )
    const unused = service.saveAccount(
      accountBody({ fromAddress: 'spare@example.com', username: 'spare', isDefault: false })
    )
    expect(primary.usedFor).toEqual([])

    service.updateAlerts({ projectId: 'proj-1', emailAccountId: primary.id })
    const second = createProjectDatabase(projectsDirectory, 'northwind')
    closeProjectDatabase(second)
    insertProject(db, {
      id: 'proj-2',
      name: 'Northwind',
      slug: 'northwind',
      domain: 'northwind.example',
      dbPath: projectDatabaseRelativePath('northwind'),
      clientName: null,
      status: 'active'
    })
    service.updateAlerts({ projectId: 'proj-2', emailAccountId: primary.id })

    const created = '2026-02-01T00:00:00.000Z'
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-monday',
        name: 'Monday report',
        projectId: 'proj-1',
        accountId: primary.id
      })
    )
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-all',
        name: 'All projects',
        projectId: null,
        accountId: primary.id
      })
    )
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-default',
        name: 'Uses default',
        projectId: 'proj-1',
        accountId: null
      })
    )
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-other',
        name: 'Other account',
        projectId: 'proj-1',
        accountId: other.id
      })
    )
    stores.reports.save(
      weeklySchedule(created, {
        id: 'sched-gone',
        name: 'Deleted schedule',
        projectId: 'proj-1',
        accountId: primary.id
      })
    )
    expect(
      service.getSettings().accounts.find((account) => account.id === primary.id)?.usedFor
    ).toEqual([
      { projectId: 'proj-1', label: 'TextBolt' },
      { projectId: 'proj-2', label: 'Northwind' },
      { projectId: 'proj-1', scheduleId: 'sched-monday', label: 'Monday report' },
      { projectId: null, scheduleId: 'sched-all', label: 'All projects' },
      { projectId: 'proj-1', scheduleId: 'sched-gone', label: 'Deleted schedule' }
    ])

    expect(stores.reports.delete('proj-1', 'sched-gone')).toBe(WHEN)
    const accounts = service.getSettings().accounts
    expect(accounts.find((account) => account.id === primary.id)?.usedFor).toEqual([
      { projectId: 'proj-1', label: 'TextBolt' },
      { projectId: 'proj-2', label: 'Northwind' },
      { projectId: 'proj-1', scheduleId: 'sched-monday', label: 'Monday report' },
      { projectId: null, scheduleId: 'sched-all', label: 'All projects' }
    ])
    expect(accounts.find((account) => account.id === other.id)?.usedFor).toEqual([
      { projectId: 'proj-1', scheduleId: 'sched-other', label: 'Other account' }
    ])
    expect(accounts.find((account) => account.id === unused.id)?.usedFor).toEqual([])
    expect(stores.accounts.get(primary.id)?.usedFor).toEqual(
      accounts.find((account) => account.id === primary.id)?.usedFor
    )
    expect(
      accounts
        .find((account) => account.id === primary.id)
        ?.usedFor.some((use) => use.scheduleId === 'sched-default')
    ).toBe(false)
    expect(
      accounts
        .find((account) => account.id === primary.id)
        ?.usedFor.some((use) => use.scheduleId === 'sched-gone')
    ).toBe(false)
  })
})

interface Fixture {
  db: SqliteDatabase
  stores: StorageEmailStores
  service: EmailService
  transport: MemorySmtpTransport
  webhooks: MemoryWebhookTransport
  secrets: MemorySecretStore
  projectsDirectory: string
  outbox: string
  clock: EmailClock
  lines: string[]
  setNow(iso: string): void
  close(): void
}

function openFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'citefox-e7b-'))
  const db = openAppDatabase(join(root, 'app.sqlite'))
  const projectsDirectory = join(root, 'projects')
  const outbox = join(root, 'outbox')
  const created = createProjectDatabase(projectsDirectory, 'textbolt')
  closeProjectDatabase(created)
  insertProject(db, textboltProject())
  let current = new Date(WHEN)
  const clock: EmailClock = { now: () => current, timeZone: 'UTC' }
  const lines: string[] = []
  const stores = createStorageEmailStores({
    app: db,
    projectsDirectory,
    outboxDir: outbox,
    clock,
    logger: captureLogger(lines)
  })
  const transport = new MemorySmtpTransport()
  const webhooks = new MemoryWebhookTransport()
  const secrets = new MemorySecretStore()
  const service = emailService({ stores, clock, transport, webhooks, secrets })
  const fixture: Fixture = {
    db,
    stores,
    service,
    transport,
    webhooks,
    secrets,
    projectsDirectory,
    outbox,
    clock,
    lines,
    setNow(iso: string) {
      current = new Date(iso)
    },
    close() {
      stores.close()
      closeDatabase(db)
      rmSync(root, { recursive: true, force: true })
    }
  }
  fixtures.push(fixture)
  return fixture
}

function emailService(input: {
  stores: StorageEmailStores
  clock: EmailClock
  transport: MemorySmtpTransport
  webhooks: MemoryWebhookTransport
  secrets: MemorySecretStore
  reports?: StorageEmailStores['reports']
}): EmailService {
  return createEmailService({
    secrets: input.secrets,
    transport: input.transport,
    webhooks: input.webhooks,
    drafts: new MemoryDraftOpener(),
    accounts: input.stores.accounts,
    alerts: input.stores.alerts,
    reports: input.reports ?? input.stores.reports,
    deliveries: input.stores.deliveries,
    pdfs: input.stores.pdfs,
    logger: quietLogger(),
    clock: input.clock,
    sleep: async () => undefined,
    createId: sequentialIds(),
    knownSecrets: () => [PASSWORD]
  })
}

class RecordingAlertStore extends StorageAlertStore {
  readonly closed: SqliteDatabase[] = []

  override evictProject(projectId: string): SqliteDatabase | null {
    const handle = super.evictProject(projectId)
    if (handle !== null) this.closed.push(handle)
    return handle
  }
}

function textboltProject(): Parameters<typeof insertProject>[1] {
  return {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.example',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  }
}

function weeklySchedule(
  createdAt: string,
  overrides: Partial<ReportSchedule> = {}
): ReportSchedule {
  return {
    id: 'sched-week',
    name: 'Monday report',
    projectId: 'proj-1',
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format: 'summary',
    sections: [],
    marketIds: [],
    recipients: ['client@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt,
    ...overrides
  }
}

function scheduleDeletedAt(db: SqliteDatabase, id: string): string | null | undefined {
  return db
    .prepare<unknown[], { deleted_at: string | null }>(
      `SELECT deleted_at FROM report_schedules WHERE id = ?`
    )
    .get(id)?.deleted_at
}

function alertSettings(overrides: Partial<StoredAlertSettings> = {}): StoredAlertSettings {
  return {
    projectId: 'proj-1',
    desktop: false,
    emailAfterCheck: false,
    emailAccountId: null,
    emailTo: [],
    slackEnabled: false,
    slackKeychainRef: null,
    monthlyClientPdf: false,
    monthlyPdfTo: null,
    ...overrides
  }
}

function storedMonthlyPdfTo(projectsDirectory: string, slug: string): string | null | undefined {
  const db = openProjectDatabase(projectsDirectory, slug)
  try {
    return db
      .prepare<unknown[], { monthly_pdf_to: string | null }>(
        `SELECT monthly_pdf_to FROM alert_settings WHERE id = 1`
      )
      .get()?.monthly_pdf_to
  } finally {
    closeProjectDatabase(db)
  }
}

function failedRow(id: string, nextStep: string | null): DeliveryRecord {
  return {
    id,
    scheduleId: null,
    at: WHEN,
    trigger: 'check_summary',
    projectId: 'proj-1',
    recipients: ['ada@example.com'],
    outcome: 'failed',
    ok: false,
    reason: 'The SMTP send failed.',
    nextStep,
    occurrenceKey: null
  }
}

function sentRow(id: string, occurrenceKey: string): DeliveryRecord {
  return {
    id,
    scheduleId: null,
    at: WHEN,
    trigger: 'check_summary',
    projectId: 'proj-1',
    recipients: ['ada@example.com'],
    outcome: 'sent',
    ok: true,
    reason: null,
    nextStep: null,
    occurrenceKey
  }
}

function pdf(id: string): {
  id: string
  projectId: string
  projectName: string
  dueDate: string
  filename: string
  bytes: Uint8Array
} {
  return {
    id,
    projectId: 'proj-1',
    projectName: 'TextBolt',
    dueDate: '2026-02-01',
    filename: 'textbolt.pdf',
    bytes: Uint8Array.of(1, 2, 3)
  }
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

function count(db: SqliteDatabase, table: 'deliveries' | 'email_throttle'): number {
  const row = db.prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()
  return row?.n ?? 0
}

function scheduleCreatedAt(db: SqliteDatabase, id: string): string | undefined {
  return db
    .prepare<unknown[], { created_at: string }>(
      `SELECT created_at FROM report_schedules WHERE id = ?`
    )
    .get(id)?.created_at
}

function storedNextStep(db: SqliteDatabase, id: string): string | null | undefined {
  return db
    .prepare<unknown[], { next_step: string | null }>(
      `SELECT next_step FROM deliveries WHERE id = ?`
    )
    .get(id)?.next_step
}

function nextSteps(db: SqliteDatabase): (string | null)[] {
  return db
    .prepare<unknown[], { next_step: string | null }>(
      `SELECT next_step FROM deliveries ORDER BY rowid`
    )
    .all()
    .map((row) => row.next_step)
}

function sentWithStep(id: string, occurrenceKey: string, nextStep: string): DeliveryRecord {
  return { ...sentRow(id, occurrenceKey), nextStep }
}

function captureLogger(lines: string[]): Logger {
  const write = (message: string, extra?: unknown): void => {
    lines.push(JSON.stringify({ message, extra }))
  }
  return { debug: write, info: write, warn: write, error: write }
}

function quietLogger(): Logger {
  const lines: string[] = []
  const write = (message: string, extra?: unknown): void => {
    lines.push(JSON.stringify({ message, extra }))
  }
  return { debug: write, info: write, warn: write, error: write }
}

function sequentialIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}
