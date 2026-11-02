import type { DeliveryTrigger, ReportFormat } from '@shared/domain'
import { redactString } from '../../logging/redact'
import { localDateKey } from '../../scheduler/local-time'
import { applicableChangeEvents, changeEventLines, renderSubject } from '../compose'
import { dueOccurrences, isFirstOfMonth } from '../due'
import { EmailError } from '../errors'
import type { EmailAttachment } from '../transport'
import {
  defaultAlertSettings,
  type NotifyResult,
  type ReportPayload,
  type ReportSchedule,
  type SummaryStyle
} from '../types'
import { baseRecord, recordFailure } from './deliveries'
import { performSend } from './send'
import { asNotify, bag, logEmail, readEmailSafeId, requireReport } from './support'
import type {
  AfterCheckInput,
  ChangeReportInput,
  MonthlyPdfInput,
  ReadyDeps,
  ReleaseInput
} from './types'

export async function sendAfter(deps: ReadyDeps, input: AfterCheckInput): Promise<NotifyResult[]> {
  const results: NotifyResult[] = []
  for (const schedule of deps.reports.list()) {
    if (schedule.timing.kind !== 'after_check') continue
    if (schedule.projectId !== null && schedule.projectId !== input.projectId) continue
    if (input.paused || schedule.status === 'paused') {
      results.push({ action: 'skipped', reason: 'paused' })
      continue
    }
    const payload = input.factsFor(schedule)
    if (payload === null) {
      results.push({ action: 'skipped', reason: 'no_facts' })
      continue
    }
    results.push(
      await dispatchReport(deps, {
        schedule,
        trigger: 'after_check',
        occurrenceKey: `after:${schedule.id}:${input.checkId}`,
        to: schedule.recipients,
        payload,
        text: payload.facts.lines.join('\n')
      })
    )
  }
  return results
}

export async function sendChanges(
  deps: ReadyDeps,
  input: ChangeReportInput
): Promise<NotifyResult> {
  const schedule = requireReport(deps, input.scheduleId)
  if (schedule.timing.kind !== 'on_change') return { action: 'skipped', reason: 'disabled' }
  if (input.paused || schedule.status === 'paused') return { action: 'skipped', reason: 'paused' }
  const events = applicableChangeEvents(
    input.events,
    schedule.timing.scoreDropPoints,
    schedule.timing.events
  )
  if (events.length === 0) return { action: 'skipped', reason: 'empty' }
  return dispatchReport(deps, {
    schedule,
    trigger: 'on_change',
    occurrenceKey: `change:${schedule.id}:${input.checkId}`,
    to: schedule.recipients,
    payload: input.payload,
    text: changeEventLines(events)
  })
}

export async function releaseDueWork(
  deps: ReadyDeps,
  input: ReleaseInput
): Promise<NotifyResult[]> {
  const nowMs = deps.clock.now().getTime()
  const results: NotifyResult[] = []
  for (const schedule of deps.reports.list()) {
    if (schedule.timing.kind !== 'weekly' && schedule.timing.kind !== 'monthly') continue
    if (input.isPaused(schedule.projectId) || schedule.status === 'paused') {
      results.push({ action: 'skipped', reason: 'paused' })
      continue
    }
    for (const occurrence of dueOccurrences(schedule, nowMs)) {
      const key = `report:${schedule.id}:${occurrence.key}`
      if (deps.deliveries.hasThrottle(key)) continue
      const payload = input.factsFor(schedule)
      if (payload === null) {
        results.push({ action: 'skipped', reason: 'no_facts' })
        continue
      }
      results.push(
        await dispatchReport(deps, {
          schedule,
          trigger: occurrence.trigger,
          occurrenceKey: key,
          to: schedule.recipients,
          payload,
          text: payload.facts.lines.join('\n')
        })
      )
    }
  }
  const today = localDateKey(nowMs, deps.clock.timeZone)
  for (const pdf of deps.pdfs.list()) {
    if (pdf.dueDate > today) continue
    if (input.isPaused(pdf.projectId)) {
      results.push({ action: 'skipped', reason: 'paused' })
      continue
    }
    const key = `pdf:${pdf.projectId}:${pdf.dueDate}`
    if (deps.deliveries.hasThrottle(key)) continue
    const alerts = deps.alerts.get(pdf.projectId) ?? defaultAlertSettings(pdf.projectId)
    const delivery = await performSend(deps, {
      trigger: 'monthly_pdf',
      scheduleId: null,
      projectId: pdf.projectId,
      accountId: alerts.emailAccountId,
      to: alerts.emailTo,
      subject: pdf.projectName,
      text: pdf.projectName,
      attachment: {
        filename: pdf.filename,
        contentType: 'application/pdf',
        bytes: pdf.bytes
      },
      occurrenceKey: key
    })
    if (delivery === 'already_sent') {
      results.push({ action: 'skipped', reason: 'already_sent' })
      continue
    }
    if (delivery.outcome === 'sent' || delivery.outcome === 'draft') deps.pdfs.remove(pdf.id)
    results.push({ action: 'recorded', delivery })
  }
  return results
}

export function queuePdf(deps: ReadyDeps, input: MonthlyPdfInput): void {
  readEmailSafeId(input.projectId)
  const alerts = deps.alerts.get(input.projectId) ?? defaultAlertSettings(input.projectId)
  if (!alerts.monthlyClientPdf) return
  if (!isFirstOfMonth(input.dueDate)) throw new EmailError('Invalid request', 'invalid')
  if (input.filename.length === 0 || /[\r\n]/.test(input.filename)) {
    throw new EmailError('Invalid request', 'invalid')
  }
  if (input.projectName.length === 0 || /[\r\n]/.test(input.projectName)) {
    throw new EmailError('Invalid request', 'invalid')
  }
  if (input.bytes.byteLength === 0) throw new EmailError('Invalid request', 'invalid')
  deps.pdfs.add({
    id: deps.createId(),
    projectId: input.projectId,
    projectName: input.projectName,
    dueDate: input.dueDate,
    filename: input.filename,
    bytes: input.bytes
  })
}

export interface DispatchInput {
  schedule: ReportSchedule
  trigger: DeliveryTrigger
  occurrenceKey: string | null
  to: readonly string[]
  payload: ReportPayload
  text: string
}

export async function dispatchReport(deps: ReadyDeps, input: DispatchInput): Promise<NotifyResult> {
  const key = input.occurrenceKey
  if (key !== null && deps.deliveries.hasThrottle(key)) {
    return { action: 'skipped', reason: 'already_sent' }
  }
  const secrets = bag(deps)
  const written = await writtenBody(deps, input.schedule.summaryStyle, input.text, secrets)
  const shell = baseRecord(deps, {
    trigger: input.trigger,
    scheduleId: input.schedule.id,
    projectId: input.schedule.projectId,
    recipients: input.to,
    occurrenceKey: key
  })
  if (typeof written !== 'string') return recordFailure(deps, shell, written.failed)
  const attachment = fileFor(input.schedule.format, input.payload.attachment)
  if (attachment === 'missing') return recordFailure(deps, shell, 'The report file is missing.')
  return asNotify(
    await performSend(deps, {
      trigger: input.trigger,
      scheduleId: input.schedule.id,
      projectId: input.schedule.projectId,
      accountId: input.schedule.accountId,
      to: input.to,
      subject: renderSubject(input.schedule.subject, input.payload.facts),
      text: written,
      attachment,
      occurrenceKey: key
    })
  )
}

export async function writtenBody(
  deps: ReadyDeps,
  style: SummaryStyle | null,
  facts: string,
  secrets: readonly string[]
): Promise<string | { failed: string }> {
  if (style === null) return facts
  if (deps.summaryWriter === undefined) return { failed: 'The email summary was not rewritten.' }
  try {
    const written = await deps.summaryWriter.write({ style, facts })
    return redactString(written, { secrets, hexKeys: false })
  } catch (error: unknown) {
    logEmail(deps, 'error', 'Email summary was not rewritten', error, secrets)
    return { failed: 'The email summary was not rewritten.' }
  }
}

export function fileFor(
  format: ReportFormat,
  attachment: ReportPayload['attachment']
): EmailAttachment | null | 'missing' {
  if (format === 'summary') return null
  if (attachment === null) return 'missing'
  return {
    filename: attachment.filename,
    contentType: attachment.contentType,
    bytes: attachment.bytes
  }
}
