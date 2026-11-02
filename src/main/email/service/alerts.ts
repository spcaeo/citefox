import type { AlertSettings } from '@shared/domain'
import type { TestSlackResult } from '@shared/ipc'
import { redactString } from '../../logging/redact'
import type { CapAlert } from '../../queue/types'
import { checkSummaryLines, desktopNoticeFor } from '../compose'
import { parseAlertUpdate, parseSlackTest } from '../parse'
import {
  defaultAlertSettings,
  type CheckAlertResult,
  type NotifyResult,
  type StoredAlertSettings
} from '../types'
import { postWithRetry, WebhookDeliveryError } from '../webhook'
import { baseRecord, recordFailure, recordOutcome } from './deliveries'
import { performSend } from './send'
import { asNotify, bag, logEmail, mutateSecret, newRef, readSecret } from './support'
import type { CheckFinishedInput, ReadyDeps } from './types'

export function updateAlertSettings(deps: ReadyDeps, request: unknown): AlertSettings {
  const parsed = parseAlertUpdate(request)
  const current = deps.alerts.get(parsed.projectId) ?? defaultAlertSettings(parsed.projectId)
  let slackKeychainRef = current.slackKeychainRef
  if (parsed.slackWebhook !== undefined && parsed.slackWebhook !== null) {
    if (parsed.slackWebhook === '') {
      if (slackKeychainRef !== null) {
        const ref = slackKeychainRef
        mutateSecret(() => deps.secrets.delete(ref), bag(deps))
      }
      slackKeychainRef = null
    } else {
      const webhook = parsed.slackWebhook
      const ref = slackKeychainRef ?? newRef('slack', deps.createId)
      mutateSecret(() => deps.secrets.set(ref, webhook), bag(deps, [webhook]))
      slackKeychainRef = ref
    }
  }
  const next: StoredAlertSettings = {
    projectId: parsed.projectId,
    desktop: parsed.desktop ?? current.desktop,
    emailAfterCheck: parsed.emailAfterCheck ?? current.emailAfterCheck,
    emailAccountId:
      parsed.emailAccountId === undefined ? current.emailAccountId : parsed.emailAccountId,
    emailTo: parsed.emailTo === undefined ? [...current.emailTo] : [...parsed.emailTo],
    slackEnabled: parsed.slackEnabled ?? current.slackEnabled,
    slackKeychainRef,
    monthlyClientPdf: parsed.monthlyClientPdf ?? current.monthlyClientPdf,
    monthlyPdfTo: parsed.monthlyPdfTo === undefined ? current.monthlyPdfTo : parsed.monthlyPdfTo
  }
  deps.alerts.save(next)
  return toPublic(deps, next)
}

export function toPublic(deps: ReadyDeps, stored: StoredAlertSettings): AlertSettings {
  let slackWebhookStored = false
  if (stored.slackKeychainRef !== null) {
    const url = readSecret(deps, stored.slackKeychainRef, bag(deps))
    slackWebhookStored = url !== null && url.length > 0
  }
  return {
    projectId: stored.projectId,
    desktop: stored.desktop,
    emailAfterCheck: stored.emailAfterCheck,
    emailAccountId: stored.emailAccountId,
    emailTo: [...stored.emailTo],
    slackEnabled: stored.slackEnabled,
    slackWebhookStored,
    monthlyClientPdf: stored.monthlyClientPdf,
    monthlyPdfTo: stored.monthlyPdfTo
  }
}

export async function notifyFinished(
  deps: ReadyDeps,
  input: CheckFinishedInput
): Promise<CheckAlertResult> {
  if (input.paused) {
    return {
      skipped: 'paused',
      notices: [],
      email: { action: 'skipped', reason: 'paused' },
      slack: { action: 'skipped', reason: 'paused' }
    }
  }
  const alerts = deps.alerts.get(input.projectId) ?? defaultAlertSettings(input.projectId)
  const notices = desktopNotices(deps, alerts, input)
  const email = await summaryEmail(deps, alerts, input)
  const slack = await slackPost(deps, alerts, input)
  return { skipped: null, notices, email, slack }
}

export function desktopNotices(
  deps: ReadyDeps,
  alerts: StoredAlertSettings,
  input: CheckFinishedInput
): CheckAlertResult['notices'] {
  if (!alerts.desktop) return []
  const notices = []
  for (const page of input.pages) {
    if (page.cancelled === true) continue
    const key = `desktop:${input.projectId}:${page.notice.pageId}:${input.checkId}`
    if (deps.deliveries.hasThrottle(key)) continue
    deps.deliveries.markThrottle(key)
    notices.push(desktopNoticeFor(page.notice))
  }
  return notices
}

export async function summaryEmail(
  deps: ReadyDeps,
  alerts: StoredAlertSettings,
  input: CheckFinishedInput
): Promise<NotifyResult> {
  if (!alerts.emailAfterCheck) return { action: 'skipped', reason: 'disabled' }
  const pages = input.pages.filter((page) => page.cancelled !== true)
  if (pages.length === 0) return { action: 'skipped', reason: 'empty' }
  const key = `summary:${input.projectId}:${input.checkId}`
  if (deps.deliveries.hasThrottle(key)) return { action: 'skipped', reason: 'already_sent' }
  return asNotify(
    await performSend(deps, {
      trigger: 'check_summary',
      scheduleId: null,
      projectId: input.projectId,
      accountId: alerts.emailAccountId,
      to: alerts.emailTo,
      subject: input.projectName,
      text: checkSummaryLines(input.projectName, pages),
      attachment: null,
      occurrenceKey: key
    })
  )
}

export async function slackPost(
  deps: ReadyDeps,
  alerts: StoredAlertSettings,
  input: CheckFinishedInput
): Promise<NotifyResult> {
  if (!alerts.slackEnabled) return { action: 'skipped', reason: 'disabled' }
  const pages = input.pages.filter((page) => page.cancelled !== true)
  if (pages.length === 0) return { action: 'skipped', reason: 'empty' }
  const key = `slack:${input.projectId}:${input.checkId}`
  if (deps.deliveries.hasThrottle(key)) return { action: 'skipped', reason: 'already_sent' }
  return deliverSlackText(
    deps,
    alerts,
    input.projectId,
    checkSummaryLines(input.projectName, pages),
    key
  )
}

/**
 * One Slack post through the project's saved webhook, recorded in delivery history.
 * Alert rules use it too, so every Slack message goes through the same path.
 */
export async function deliverSlackText(
  deps: ReadyDeps,
  alerts: StoredAlertSettings,
  projectId: string,
  text: string,
  occurrenceKey: string | null
): Promise<NotifyResult> {
  const record = (): ReturnType<typeof baseRecord> =>
    baseRecord(deps, {
      trigger: 'slack',
      scheduleId: null,
      projectId,
      recipients: [],
      occurrenceKey
    })
  if (alerts.slackKeychainRef === null) {
    return recordFailure(deps, record(), 'The Slack webhook is missing.')
  }
  const url = readSecret(deps, alerts.slackKeychainRef, bag(deps))
  if (url === null || url.length === 0) {
    return recordFailure(deps, record(), 'The Slack webhook is missing.')
  }
  const secrets = bag(deps, [url])
  const body = JSON.stringify({ text: redactString(text, { secrets, hexKeys: false }) })
  try {
    await postWithRetry(deps.webhooks, url, body, { sleep: deps.sleep, secrets })
    logEmail(deps, 'info', 'Slack webhook delivered', { projectId }, secrets)
    return asNotify(recordOutcome(deps, record(), 'sent', null))
  } catch (error: unknown) {
    logEmail(deps, 'error', 'Slack webhook failed', error, secrets)
    return recordFailure(deps, record(), 'The Slack webhook was rejected.')
  }
}

/** Alert rules: posts `text` to the project's Slack webhook (whatever the Slack switch says). */
export function postSlackText(
  deps: ReadyDeps,
  input: { projectId: string; text: string; occurrenceKey: string | null }
): Promise<NotifyResult> {
  const alerts = deps.alerts.get(input.projectId) ?? defaultAlertSettings(input.projectId)
  return deliverSlackText(deps, alerts, input.projectId, input.text, input.occurrenceKey)
}

/**
 * `alerts:testSlack`: one post, no retry, so the answer is quick and says what Slack
 * said. A URL typed in the box is tried without saving it; otherwise the saved one.
 * The message never contains the URL, and neither does the result.
 */
export async function testSlackWebhook(
  deps: ReadyDeps,
  request: unknown
): Promise<TestSlackResult> {
  const parsed = parseSlackTest(request)
  const testedAt = deps.clock.now().toISOString()
  let url = parsed.webhook
  if (url === null) {
    const alerts = deps.alerts.get(parsed.projectId) ?? defaultAlertSettings(parsed.projectId)
    url =
      alerts.slackKeychainRef === null ? null : readSecret(deps, alerts.slackKeychainRef, bag(deps))
  }
  if (url === null || url.length === 0) {
    return { ok: false, testedAt, message: 'Save a Slack webhook URL first.' }
  }
  const secrets = bag(deps, [url])
  const body = JSON.stringify({
    text: 'CiteFox test message: alerts for this project will post in this channel.'
  })
  try {
    await deps.webhooks.post(url, body)
    logEmail(deps, 'info', 'Slack test delivered', { projectId: parsed.projectId }, secrets)
    return { ok: true, testedAt, message: 'Posted to Slack. Look for the message in the channel.' }
  } catch (error: unknown) {
    logEmail(deps, 'error', 'Slack test failed', error, secrets)
    const reason =
      error instanceof WebhookDeliveryError
        ? redactString(error.message, { secrets, hexKeys: false })
        : 'The Slack webhook could not be reached.'
    return { ok: false, testedAt, message: reason }
  }
}

export async function notifyCapAlert(
  deps: ReadyDeps,
  alert: CapAlert,
  paused: boolean
): Promise<NotifyResult> {
  if (paused) return { action: 'skipped', reason: 'paused' }
  const key = `cap:${alert.projectId}:${alert.month}`
  if (deps.deliveries.hasThrottle(key)) return { action: 'skipped', reason: 'already_sent' }
  const alerts = deps.alerts.get(alert.projectId) ?? defaultAlertSettings(alert.projectId)
  return asNotify(
    await performSend(deps, {
      trigger: 'cap',
      scheduleId: null,
      projectId: alert.projectId,
      accountId: alerts.emailAccountId,
      to: alerts.emailTo,
      subject: alert.name,
      text: `Searches used: ${alert.used}\nCap: ${alert.cap}\nMonth: ${alert.month}`,
      attachment: null,
      occurrenceKey: key
    })
  )
}
