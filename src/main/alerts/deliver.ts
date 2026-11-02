import type { AlertEvent, AlertRule } from '@shared/ipc'
import { projectRouteHash } from '@shared/project-route'
import type { Logger } from '../logging/logger'

/**
 * Where a fired rule goes. Production sends through the tray (desktop) and the email
 * service (SMTP and the project's Slack webhook), so alerts land in the same delivery
 * history as every other send. Tests pass fakes: nothing real is posted or mailed.
 */
export interface AlertSenders {
  desktop(notice: AlertDesktopNotice): void
  /** True when the message was sent (or put in the mail app as a draft). */
  email(input: AlertEmail): Promise<boolean>
  /** True when Slack accepted the post. */
  slack(input: AlertSlack): Promise<boolean>
}

export interface AlertDesktopNotice {
  projectId: string
  title: string
  body: string
  /** Opens the project's Alert log. */
  hash: string
}

export interface AlertEmail {
  projectId: string
  to: readonly string[]
  subject: string
  text: string
}

export interface AlertSlack {
  projectId: string
  text: string
  occurrenceKey: string
}

/** Events of one rule, about to be sent together. */
export interface AlertBatch {
  rule: AlertRule
  projectName: string
  events: readonly AlertEvent[]
  marketLabel: (marketId: string) => string
  /** The daily digest says so in the subject. */
  digest: boolean
  /** Keeps a re-send of the same batch from posting twice (Slack delivery history). */
  key: string
}

/** One line per event, then its details indented. Plain text for email and Slack. */
export function batchText(batch: AlertBatch): string {
  const lines = [
    batch.digest
      ? `${batch.projectName}: daily digest for “${batch.rule.name}”`
      : `${batch.projectName}: “${batch.rule.name}” fired`,
    ''
  ]
  for (const event of batch.events) {
    const where = event.pageUrl ?? event.pageLabel
    lines.push(`• ${event.pageLabel} (${batch.marketLabel(event.marketId)}): ${event.summary}`)
    if (where !== event.pageLabel) lines.push(`  ${where}`)
    for (const detail of event.details) lines.push(`  – ${detail}`)
  }
  lines.push('', 'Open CiteFox › Alerts & schedules › Alert log for every alert.')
  return lines.join('\n')
}

export function batchSubject(batch: AlertBatch): string {
  const count = batch.events.length
  const pages = count === 1 ? '1 page' : `${count} pages`
  return batch.digest
    ? `CiteFox daily digest: ${batch.rule.name} (${pages})`
    : `CiteFox alert: ${batch.rule.name} (${pages})`
}

/**
 * Sends one rule's batch to every channel the rule names. Returns what to show in the
 * Alert log's "Delivered to" column. A failed channel is named as failed; it never
 * stops the others.
 */
export async function sendBatch(
  senders: AlertSenders,
  batch: AlertBatch,
  logger: Logger
): Promise<string[]> {
  const delivered: string[] = []
  const { rule } = batch
  const prefix = batch.digest ? 'Daily digest: ' : ''
  if (rule.desktop) {
    try {
      const first = batch.events[0]
      const more = batch.events.length - 1
      senders.desktop({
        projectId: rule.projectId,
        title: rule.name,
        body:
          first === undefined
            ? rule.name
            : `${first.pageLabel}: ${first.summary}${more > 0 ? ` and ${more} more` : ''}`,
        hash: projectRouteHash(rule.projectId, '#/alerts/log')
      })
      delivered.push(`${prefix}Desktop`)
    } catch (error: unknown) {
      logger.warn('An alert could not show on the desktop', errorFields(error))
      delivered.push(`${prefix}Desktop failed`)
    }
  }
  const text = batchText(batch)
  if (rule.emailTo.length > 0) {
    const count = rule.emailTo.length
    const label = count === 1 ? '1 email' : `${count} emails`
    try {
      const ok = await senders.email({
        projectId: rule.projectId,
        to: rule.emailTo,
        subject: batchSubject(batch),
        text
      })
      delivered.push(ok ? `${prefix}${label}` : `${prefix}Email failed`)
    } catch (error: unknown) {
      logger.warn('An alert email failed', errorFields(error))
      delivered.push(`${prefix}Email failed`)
    }
  }
  if (rule.slack) {
    try {
      const ok = await senders.slack({ projectId: rule.projectId, text, occurrenceKey: batch.key })
      delivered.push(ok ? `${prefix}Slack` : `${prefix}Slack failed`)
    } catch (error: unknown) {
      logger.warn('An alert Slack post failed', errorFields(error))
      delivered.push(`${prefix}Slack failed`)
    }
  }
  return delivered
}

function errorFields(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : 'failed' }
}
