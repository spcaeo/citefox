import { DEFAULT_REPORT_SCHEDULE_STATUS } from '@shared'
import { describe, expect, test } from 'vitest'
import { PDF_LINK_INSTEAD_BYTES } from './types'
import { dueOccurrences } from './due'
import { SmtpTransportError } from './transport'
import type { ReportSchedule } from './types'
import { PASSWORD, accountBody, emailHarness, facts, notice, reportBody } from './harness'
import { changeEventsFromPages } from './compose'

describe('scheduled reports', () => {
  test('preview fills the subject tokens and does not send', () => {
    const { service, ports } = emailHarness()
    const saved = service.saveReport(
      reportBody({ subject: '{project} {date_range} {market} {score} {other}' })
    )
    const preview = service.previewReport(saved.id, facts())
    expect(preview.subject).toBe('TextBolt 1 Feb 2026 – 4 Feb 2026 US 40 {other}')
    expect(preview.text).toBe('Score 40')
    const missing = service.previewReport(saved.id, { ...facts(), score: null })
    expect(missing.subject).toContain('{score}')
    expect(ports.transport.attempts).toBe(0)
  })

  test('FR-23.9 send a test now goes only to the user', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    const saved = service.saveReport(reportBody())
    const paused = await service.sendReportTest({
      scheduleId: saved.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: true
    })
    expect(paused).toEqual({ action: 'skipped', reason: 'paused' })
    const sent = await service.sendReportTest({
      scheduleId: saved.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: false
    })
    expect(sent.action).toBe('recorded')
    expect(ports.transport.sent).toHaveLength(1)
    expect(ports.transport.sent[0]?.message.to).toEqual(['owner@example.com'])
    expect(ports.transport.sent[0]?.message.subject).toBe('TextBolt 40')
    expect(ports.transport.sent[0]?.auth.password).toBe(PASSWORD)
  })

  test('FR-23.8 sends one email listing every event and does not send a second for that check', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    const saved = service.saveReport(
      reportBody({
        timing: { kind: 'on_change', scoreDropPoints: 5 },
        subject: '{project}'
      })
    )
    const events = changeEventsFromPages(
      [
        {
          failed: true,
          notice: notice({ pageLabel: 'Alerts', pageCitedChange: -1, scoreChange: -6 })
        },
        {
          failed: false,
          notice: notice({
            pageId: 'page-2',
            pageLabel: 'Other',
            pageCitedChange: 1,
            scoreChange: 2
          })
        }
      ],
      5
    )
    const first = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(first.action).toBe('recorded')
    expect(ports.transport.sent).toHaveLength(1)
    expect(ports.transport.sent[0]?.message.text).toBe(
      [
        'Alerts lost a citation',
        'Alerts score dropped by 6 points',
        'Alerts check failed',
        'Other gained a citation'
      ].join('\n')
    )
    const second = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(second).toEqual({ action: 'skipped', reason: 'already_sent' })
    expect(ports.transport.sent).toHaveLength(1)
    const paused = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-2',
      paused: true,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(paused).toEqual({ action: 'skipped', reason: 'paused' })
    expect(ports.transport.sent).toHaveLength(1)
  })

  test('a score drop of exactly N does not send', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    const saved = service.saveReport(
      reportBody({ timing: { kind: 'on_change', scoreDropPoints: 5 } })
    )
    const result = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events: changeEventsFromPages(
        [{ failed: false, notice: notice({ pageCitedChange: 0, scoreChange: -5 }) }],
        5
      ),
      payload: { facts: facts(), attachment: null }
    })
    expect(result).toEqual({ action: 'skipped', reason: 'empty' })
    expect(ports.transport.attempts).toBe(0)
  })

  test('a failed on-change send keeps a null occurrence key and the retry succeeds', async () => {
    const { service, ports } = emailHarness()
    const saved = service.saveReport(
      reportBody({ timing: { kind: 'on_change', scoreDropPoints: 5 } })
    )
    const events = changeEventsFromPages(
      [{ failed: true, notice: notice({ pageCitedChange: 0, scoreChange: 0 }) }],
      5
    )
    const failed = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(failed.action).toBe('recorded')
    if (failed.action === 'recorded') {
      expect(failed.delivery.reason).toBe('No sending account.')
      expect(failed.delivery.occurrenceKey).toBeNull()
    }
    expect(ports.deliveries.hasThrottle(`change:${saved.id}:check-1`)).toBe(false)
    service.saveAccount(accountBody())
    const again = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(again.action).toBe('recorded')
    if (again.action === 'recorded') expect(again.delivery.outcome).toBe('sent')
    expect(ports.transport.sent).toHaveLength(1)
    const third = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(third).toEqual({ action: 'skipped', reason: 'already_sent' })
    expect(ports.transport.sent).toHaveLength(1)
  })

  test('weekly and monthly reports missed while asleep go out once on wake', () => {
    const weekly = schedule({
      timing: { kind: 'weekly', day: 1, time: '08:00' },
      createdAt: '2026-02-01T00:00:00.000Z'
    })
    expect(
      dueOccurrences(weekly, Date.parse('2026-02-04T12:00:00.000Z')).map((item) => item.key)
    ).toEqual(['weekly:2026-02-02'])
    const monthly = schedule({
      timing: { kind: 'monthly', when: 'last', time: '08:00' },
      createdAt: '2026-02-01T00:00:00.000Z'
    })
    expect(
      dueOccurrences(monthly, Date.parse('2026-03-01T12:00:00.000Z')).map((item) => item.key)
    ).toEqual(['monthly:2026-02-28'])
    const fifteenth = schedule({
      timing: { kind: 'monthly', when: '15', time: '08:00' },
      createdAt: '2026-02-01T00:00:00.000Z'
    })
    expect(dueOccurrences(fifteenth, Date.parse('2026-02-15T07:00:00.000Z'))).toEqual([])
    expect(
      dueOccurrences(fifteenth, Date.parse('2026-02-15T08:00:00.000Z')).map((item) => item.key)
    ).toEqual(['monthly:2026-02-15'])
  })

  test('releaseDue sends a missed weekly report and not a slot from before the schedule existed', async () => {
    const harness = emailHarness({ now: '2026-02-02T09:00:00.000Z' })
    harness.service.saveAccount(accountBody())
    const saved = harness.service.saveReport(
      reportBody({ timing: { kind: 'weekly', day: 1, time: '08:00' } })
    )
    const tooSoon = await harness.service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(tooSoon).toEqual([])
    expect(harness.ports.transport.attempts).toBe(0)

    harness.setNow('2026-02-09T10:00:00.000Z')
    const sent = await harness.service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(sent).toHaveLength(1)
    expect(harness.ports.transport.sent).toHaveLength(1)
    const again = await harness.service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(again).toEqual([])
    expect(harness.ports.transport.sent).toHaveLength(1)
    expect(saved.id).toBeTruthy()
  })

  test('FR-23.12 a paused schedule sends nothing and is still sent after it is active again', async () => {
    const harness = emailHarness({ now: '2026-02-01T00:00:00.000Z' })
    harness.service.saveAccount(accountBody())
    const saved = harness.service.saveReport(
      reportBody({ timing: { kind: 'weekly', day: 1, time: '08:00' } })
    )
    expect(saved.status).toBe(DEFAULT_REPORT_SCHEDULE_STATUS)
    harness.ports.reports.save({ ...saved, status: 'paused' })
    const kept = harness.service.saveReport(
      reportBody({
        id: saved.id,
        timing: { kind: 'weekly', day: 1, time: '08:00' }
      })
    )
    expect(kept.status).toBe('paused')
    harness.setNow('2026-02-04T12:00:00.000Z')
    const paused = await harness.service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(paused).toEqual([{ action: 'skipped', reason: 'paused' }])
    expect(harness.ports.transport.attempts).toBe(0)

    const after = harness.service.saveReport(reportBody())
    harness.ports.reports.save({ ...after, status: 'paused' })
    const afterPaused = await harness.service.sendAfterChecks({
      checkId: 'check-1',
      projectId: 'proj-1',
      paused: false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(afterPaused).toEqual([{ action: 'skipped', reason: 'paused' }])

    const change = harness.service.saveReport(
      reportBody({ timing: { kind: 'on_change', scoreDropPoints: 5 } })
    )
    harness.ports.reports.save({ ...change, status: 'paused' })
    const changePaused = await harness.service.sendChangeReport({
      scheduleId: change.id,
      checkId: 'check-1',
      paused: false,
      events: changeEventsFromPages(
        [{ failed: true, notice: notice({ pageCitedChange: -1, scoreChange: -6 }) }],
        5
      ),
      payload: { facts: facts(), attachment: null }
    })
    expect(changePaused).toEqual({ action: 'skipped', reason: 'paused' })

    const testPaused = await harness.service.sendReportTest({
      scheduleId: after.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: false
    })
    expect(testPaused).toEqual({ action: 'skipped', reason: 'paused' })
    expect(harness.ports.transport.attempts).toBe(0)

    const stored = harness.ports.reports.get(saved.id)
    expect(stored).not.toBeNull()
    if (stored !== null) harness.ports.reports.save({ ...stored, status: 'active' })
    const sent = await harness.service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(sent).toHaveLength(1)
    expect(harness.ports.transport.sent).toHaveLength(1)
  })

  test('a paused project sends nothing and the report is still sent after resume', async () => {
    const harness = emailHarness({ now: '2026-02-01T00:00:00.000Z' })
    harness.service.saveAccount(accountBody())
    harness.service.saveReport(reportBody({ timing: { kind: 'weekly', day: 1, time: '08:00' } }))
    harness.setNow('2026-02-04T12:00:00.000Z')
    const paused = await harness.service.releaseDue({
      isPaused: () => true,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(paused).toEqual([{ action: 'skipped', reason: 'paused' }])
    expect(harness.ports.transport.attempts).toBe(0)
    const sent = await harness.service.releaseDue({
      isPaused: () => false,
      factsFor: () => ({ facts: facts(), attachment: null })
    })
    expect(sent).toHaveLength(1)
    expect(harness.ports.transport.sent).toHaveLength(1)
  })

  test('FR-23.10 rewrites the summary fresh and does not send when Claude is missing', async () => {
    let calls = 0
    const harness = emailHarness({
      summaryWriter: {
        async write(input) {
          calls += 1
          return `fresh ${calls}: ${input.facts}`
        }
      }
    })
    harness.service.saveAccount(accountBody())
    const saved = harness.service.saveReport(reportBody({ summaryStyle: 'client_friendly' }))
    await harness.service.sendReportTest({
      scheduleId: saved.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: false
    })
    await harness.service.sendReportTest({
      scheduleId: saved.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: false
    })
    expect(calls).toBe(2)
    expect(harness.ports.transport.sent.map((item) => item.message.text)).toEqual([
      'fresh 1: Score 40',
      'fresh 2: Score 40'
    ])

    const plain = emailHarness()
    plain.service.saveAccount(accountBody())
    const blocked = plain.service.saveReport(reportBody({ summaryStyle: 'standard' }))
    const failed = await plain.service.sendReportTest({
      scheduleId: blocked.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: false
    })
    expect(failed.action).toBe('recorded')
    if (failed.action === 'recorded') {
      expect(failed.delivery.reason).toBe('The email summary was not rewritten.')
    }
    expect(plain.ports.transport.attempts).toBe(0)
  })

  test('html link format attaches the self-contained HTML file and a PDF over 10 MB is not attached', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    const linked = service.saveReport(reportBody({ format: 'html_link', subject: '{project}' }))
    const html = new TextEncoder().encode('<!doctype html><title>Report</title>')
    await service.sendReportTest({
      scheduleId: linked.id,
      toUser: 'owner@example.com',
      payload: {
        facts: facts(),
        attachment: { filename: 'report.html', contentType: 'text/html', bytes: html }
      },
      paused: false
    })
    expect(ports.transport.sent[0]?.message.attachment).toEqual({
      filename: 'report.html',
      contentType: 'text/html',
      bytes: html
    })
    expect(ports.transport.sent[0]?.message.text).not.toMatch(/https?:/)

    const missing = await service.sendReportTest({
      scheduleId: linked.id,
      toUser: 'owner@example.com',
      payload: { facts: facts(), attachment: null },
      paused: false
    })
    expect(missing.action).toBe('recorded')
    if (missing.action === 'recorded') {
      expect(missing.delivery.reason).toBe('The report file is missing.')
    }
    expect(ports.transport.sent).toHaveLength(1)

    const summary = service.saveReport(reportBody({ format: 'summary', subject: '{project}' }))
    await service.sendReportTest({
      scheduleId: summary.id,
      toUser: 'owner@example.com',
      payload: {
        facts: facts(),
        attachment: { filename: 'report.html', contentType: 'text/html', bytes: html }
      },
      paused: false
    })
    expect(ports.transport.sent[1]?.message.attachment).toBeNull()

    const pdf = service.saveReport(reportBody({ format: 'pdf', subject: '{project}' }))
    const oversized = await service.sendReportTest({
      scheduleId: pdf.id,
      toUser: 'owner@example.com',
      payload: {
        facts: facts(),
        attachment: {
          filename: 'report.pdf',
          contentType: 'application/pdf',
          bytes: new Uint8Array(PDF_LINK_INSTEAD_BYTES + 1)
        }
      },
      paused: false
    })
    expect(oversized.action).toBe('recorded')
    if (oversized.action === 'recorded') {
      expect(oversized.delivery.reason).toBe(
        'Attach the HTML report (.zip) instead of a PDF over 10 MB.'
      )
    }
    expect(ports.transport.sent).toHaveLength(2)
  })

  test('the monthly client PDF goes out after the 1st if the computer was asleep', async () => {
    const harness = emailHarness({ now: '2026-02-02T12:00:00.000Z' })
    harness.service.saveAccount(accountBody())
    harness.service.updateAlerts({
      projectId: 'proj-1',
      monthlyClientPdf: true,
      emailTo: ['client@example.com']
    })
    harness.service.queueMonthlyPdf({
      projectId: 'proj-1',
      projectName: 'TextBolt',
      dueDate: '2026-02-01',
      filename: 'textbolt.pdf',
      bytes: Uint8Array.of(1, 2, 3)
    })
    const sent = await harness.service.releaseDue({ isPaused: () => false, factsFor: () => null })
    expect(sent).toHaveLength(1)
    expect(harness.ports.transport.sent[0]?.message.attachment?.filename).toBe('textbolt.pdf')
    const again = await harness.service.releaseDue({ isPaused: () => false, factsFor: () => null })
    expect(again).toEqual([])
    expect(harness.ports.transport.sent).toHaveLength(1)
  })

  test('a monthly PDF is not queued when the project toggle is off', async () => {
    const { service, ports } = emailHarness()
    service.queueMonthlyPdf({
      projectId: 'proj-1',
      projectName: 'TextBolt',
      dueDate: '2026-02-01',
      filename: 'textbolt.pdf',
      bytes: Uint8Array.of(1)
    })
    const results = await service.releaseDue({ isPaused: () => false, factsFor: () => null })
    expect(results).toEqual([])
    expect(ports.transport.attempts).toBe(0)
    expect(() =>
      service.queueMonthlyPdf({
        projectId: 'proj-1',
        projectName: 'TextBolt',
        dueDate: '2026-02-02',
        filename: 'textbolt.pdf',
        bytes: Uint8Array.of(1)
      })
    ).not.toThrow()
  })

  test('failed sends sort first and a mail-app export waits for a click', async () => {
    const { service, ports } = emailHarness()
    const account = service.saveAccount(accountBody())
    await service.testAccount({ id: 'missing' }).catch(() => undefined)
    ports.transport.failure = new SmtpTransportError('nope', 'auth', 535)
    await service.testAccount({ id: account.id })
    ports.transport.failure = null
    service.setMode({ mode: 'mail_app' })
    const draft = await service.sendExport({
      projectId: 'proj-1',
      paused: false,
      to: ['ada@example.com'],
      accountId: null,
      subject: 'Export',
      text: 'Stored overview',
      filename: 'report.pdf',
      contentType: 'application/pdf',
      bytes: Uint8Array.of(9)
    })
    expect(draft.action).toBe('recorded')
    if (draft.action === 'recorded') expect(draft.delivery.outcome).toBe('draft')
    expect(ports.transport.sent).toHaveLength(0)
    expect(ports.drafts.drafts[0]?.attachments).toHaveLength(1)
    const listed = service.listDeliveries()
    expect(listed[0]?.outcome).toBe('failed')
    expect(listed.some((row) => row.outcome === 'draft')).toBe(true)
    expect(
      service.listDeliveries({ failedOnly: true }).every((row) => row.outcome === 'failed')
    ).toBe(true)
    const paused = await service.sendExport({
      projectId: 'proj-1',
      paused: true,
      to: ['ada@example.com'],
      accountId: null,
      subject: 'Export',
      text: 'Stored overview',
      filename: 'report.pdf',
      contentType: 'application/pdf',
      bytes: Uint8Array.of(9)
    })
    expect(paused).toEqual({ action: 'skipped', reason: 'paused' })
  })

  test('delivery ok agrees with outcome and a stored disagreement is corrected', async () => {
    const { service, ports } = emailHarness()
    const account = service.saveAccount(accountBody())
    await service.testAccount({ id: account.id })
    service.setMode({ mode: 'mail_app' })
    const draft = await service.sendExport({
      projectId: 'proj-1',
      paused: false,
      to: ['ada@example.com'],
      accountId: null,
      subject: 'Export',
      text: 'Stored overview',
      filename: 'report.pdf',
      contentType: 'application/pdf',
      bytes: Uint8Array.of(9)
    })
    expect(draft.action).toBe('recorded')
    if (draft.action === 'recorded') {
      expect(draft.delivery.outcome).toBe('draft')
      expect(draft.delivery.ok).toBe(false)
      expect(draft.delivery.occurrenceKey).toBeNull()
    }
    ports.transport.failure = new SmtpTransportError('nope', 'auth', 535)
    service.setMode({ mode: 'smtp' })
    await service.testAccount({ id: account.id })

    const listed = service.listDeliveries()
    expect(listed.map((row) => row.outcome).sort()).toEqual(['draft', 'failed', 'sent'])
    for (const row of listed) {
      expect(row.ok).toBe(row.outcome === 'sent')
    }
    const failed = listed.find((row) => row.outcome === 'failed')
    expect(failed).toBeDefined()
    if (failed !== undefined) {
      ports.deliveries.add({
        ...failed,
        id: 'disagree',
        ok: true,
        occurrenceKey: failed.occurrenceKey
      })
      const stored = ports.deliveries.list().find((row) => row.id === 'disagree')
      expect(stored?.outcome).toBe('failed')
      expect(stored?.ok).toBe(false)
      expect(stored?.occurrenceKey).toBe(failed.occurrenceKey)
    }
  })
})

function schedule(overrides: Partial<ReportSchedule>): ReportSchedule {
  return {
    id: 'report-1',
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
    status: DEFAULT_REPORT_SCHEDULE_STATUS,
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides
  }
}
