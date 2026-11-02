import {
  SEND_NOW_OCCURRENCE_PREFIX,
  type DeliveryTrigger,
  type EmailAccount,
  type EmailTestResult
} from '@shared/domain'
import { renderSubject } from '../compose'
import { EmailError } from '../errors'
import { sortDeliveries } from '../store'
import type { EmailService } from '../service'
import type {
  DeliveryRecord,
  DeliveryStore,
  ReportFacts,
  ReportPayload,
  ReportSchedule,
  ReportScheduleStore
} from '../types'
import { parseListDeliveries, parseResend, parseSendNow, parseSendTest } from './parse'

const EMPTY_FACTS: ReportFacts = {
  project: null,
  dateRange: null,
  market: null,
  score: null,
  lines: []
}

export interface DeliveryDeps {
  service: EmailService
  reports: ReportScheduleStore
  deliveries: DeliveryStore
  now(): Date
  /**
   * The summary and report file a schedule sends (the scheduled-send builder). Unset,
   * a resend is text only.
   */
  payloadFor?: (schedule: ReportSchedule) => Promise<ReportPayload>
}

/** Triggers whose send carries the schedule's report file. */
const REPORT_TRIGGERS: readonly DeliveryTrigger[] = [
  'after_check',
  'weekly',
  'monthly',
  'on_change'
]

/**
 * FR-23.9. One SMTP test to the sending account's own address, not the schedule
 * recipients. `accountId` null uses the default account (FR-23.5). The schedule's
 * account is not used for this call. No file is attached.
 */
export async function sendScheduleTest(
  deps: DeliveryDeps,
  request: unknown
): Promise<EmailTestResult> {
  const parsed = parseSendTest(request)
  const schedule = deps.reports.get(parsed.scheduleId)
  if (schedule === null) throw new EmailError('Unknown report', 'not_found')
  const account = resolveAccount(deps.service, parsed.accountId)
  const result = await deps.service.sendRecorded({
    trigger: 'report_test',
    scheduleId: schedule.id,
    projectId: schedule.projectId,
    accountId: account.id,
    to: [account.fromAddress],
    subject: `Test: ${schedule.name}`,
    text: `This is a test of ${schedule.name}.`,
    forceSmtp: true
  })
  return toTestResult(account.host, result, deps.now().toISOString())
}

/** FR-23.11. Failures sort first. Omit `scheduleId` for every delivery. */
export function listDeliveryHistory(deps: DeliveryDeps, request: unknown): DeliveryRecord[] {
  const { scheduleId } = parseListDeliveries(request)
  const rows = deps.deliveries.list().filter((row) => {
    if (scheduleId === undefined) return true
    return row.scheduleId === scheduleId
  })
  return sortDeliveries(rows, false)
}

/**
 * Sends the same recipients again and records a new delivery.
 * The original row is not rewritten. A scheduled report is rebuilt the way the
 * scheduled send builds it: the same summary, subject and attached file (PDF,
 * HTML zip, XLSX or CSV per the schedule format). Other deliveries, and a schedule
 * that is gone, resend as text: the schedule's subject and account when stored,
 * else the default account and a fixed subject.
 */
export async function resendDelivery(
  deps: DeliveryDeps,
  request: unknown
): Promise<DeliveryRecord> {
  const { id } = parseResend(request)
  const existing = deps.deliveries.list().find((row) => row.id === id)
  if (existing === undefined) throw new EmailError('Unknown delivery', 'not_found')
  const schedule = existing.scheduleId === null ? null : deps.reports.get(existing.scheduleId)
  if (
    schedule !== null &&
    deps.payloadFor !== undefined &&
    REPORT_TRIGGERS.includes(existing.trigger)
  ) {
    const result = await deps.service.resendReport({
      schedule,
      trigger: existing.trigger,
      to: [...existing.recipients],
      payload: await reportPayload(deps.payloadFor, schedule)
    })
    if (result.action !== 'recorded')
      throw new EmailError('The delivery was not resent.', 'invalid')
    return result.delivery
  }
  const result = await deps.service.sendRecorded({
    trigger: existing.trigger,
    scheduleId: existing.scheduleId,
    projectId: existing.projectId,
    accountId: schedule === null ? null : schedule.accountId,
    to: [...existing.recipients],
    subject: schedule === null ? 'Report' : renderSubject(schedule.subject, EMPTY_FACTS),
    text: schedule === null ? 'Resent delivery.' : `Resent ${schedule.name}.`
  })
  if (result.action !== 'recorded') throw new EmailError('The delivery was not resent.', 'invalid')
  return result.delivery
}

/**
 * Reports' Send now: builds the schedule's report now, the way the scheduled send
 * does (summary, subject and attached file), and emails the schedule's recipients
 * from the schedule's account. The delivery keeps the schedule's own trigger and an
 * occurrence key `now:<id>`, so it never takes the next scheduled send's slot. A
 * paused schedule still sends: the user asked for this one. Without a report
 * builder (tests) there is no file, so only a summary-format schedule sends; a
 * file format records a failed delivery ("The report file is missing.").
 */
export async function sendScheduleNow(
  deps: DeliveryDeps,
  request: unknown
): Promise<DeliveryRecord> {
  const { scheduleId } = parseSendNow(request)
  const schedule = deps.reports.get(scheduleId)
  if (schedule === null) throw new EmailError('Unknown report', 'not_found')
  const payload: ReportPayload =
    deps.payloadFor === undefined
      ? {
          facts: { ...EMPTY_FACTS, lines: [`${schedule.name}, sent now.`] },
          attachment: null
        }
      : await reportPayload(deps.payloadFor, schedule)
  const result = await deps.service.resendReport({
    schedule,
    trigger: schedule.timing.kind,
    to: [...schedule.recipients],
    payload,
    occurrencePrefix: SEND_NOW_OCCURRENCE_PREFIX
  })
  if (result.action !== 'recorded') throw new EmailError('The report was not sent.', 'invalid')
  return result.delivery
}

/** A file that cannot be built is recorded as a failed send ("The report file is missing."). */
async function reportPayload(
  build: (schedule: ReportSchedule) => Promise<ReportPayload>,
  schedule: ReportSchedule
): Promise<ReportPayload> {
  try {
    return await build(schedule)
  } catch {
    return { facts: { ...EMPTY_FACTS, lines: [`Resent ${schedule.name}.`] }, attachment: null }
  }
}

function resolveAccount(service: EmailService, accountId: string | null): EmailAccount {
  const accounts = service.getSettings().accounts
  if (accountId === null) {
    const found = accounts.find((account) => account.isDefault)
    if (found === undefined) throw new EmailError('No sending account.', 'invalid')
    return found
  }
  const found = accounts.find((account) => account.id === accountId)
  if (found === undefined) throw new EmailError('Unknown email account', 'not_found')
  return found
}

function toTestResult(
  host: string,
  result: Awaited<ReturnType<EmailService['sendRecorded']>>,
  now: string
): EmailTestResult {
  if (result.action !== 'recorded') {
    return {
      ok: false,
      host,
      testedAt: now,
      message: 'The test was not sent.',
      nextStep: null
    }
  }
  const ok = result.delivery.outcome === 'sent'
  return {
    ok,
    host,
    testedAt: result.delivery.at,
    message: ok
      ? `Test sent through ${host} at ${result.delivery.at}.`
      : (result.delivery.reason ?? 'The SMTP send failed.'),
    nextStep: ok ? null : result.delivery.nextStep
  }
}
