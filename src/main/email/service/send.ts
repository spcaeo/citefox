import type { EmailAccount } from '@shared/domain'
import { redactString } from '../../logging/redact'
import { translateSmtpFailure } from '../translate'
import { sendWithRetry, toSmtpError, type EmailAttachment } from '../transport'
import { PDF_LINK_INSTEAD_BYTES, type DeliveryRecord, type EmailAccountStore } from '../types'
import { baseRecord, failSend, recordOutcome, type DeliveryShell } from './deliveries'
import { bag, logEmail } from './support'
import type { Outgoing, ReadyDeps } from './types'

export const WAITING_FOR_A_CLICK = 'Waiting for a click.'

export async function performSend(
  deps: ReadyDeps,
  input: Outgoing
): Promise<DeliveryRecord | 'already_sent'> {
  const secrets = bag(deps)
  const shell = baseRecord(deps, {
    trigger: input.trigger,
    scheduleId: input.scheduleId,
    projectId: input.projectId,
    recipients: input.to,
    occurrenceKey: input.occurrenceKey
  })
  if (input.to.length === 0) return failSend(deps, shell, 'No recipients.', secrets)
  const subject = redactString(input.subject, { secrets, hexKeys: false })
  const text = redactString(input.text, { secrets, hexKeys: false })
  if (subject.length === 0 || subject.includes('\r') || subject.includes('\n')) {
    return failSend(deps, shell, 'The subject is not valid.', secrets)
  }
  if (
    input.attachment !== null &&
    isPdf(input.attachment) &&
    input.attachment.bytes.byteLength > PDF_LINK_INSTEAD_BYTES
  ) {
    return failSend(
      deps,
      shell,
      'Attach the HTML report (.zip) instead of a PDF over 10 MB.',
      secrets
    )
  }
  if (deps.accounts.getMode() === 'mail_app' && input.forceSmtp !== true) {
    return openDraft(deps, shell, input, subject, text, secrets)
  }
  const account = resolveAccount(deps.accounts, input.accountId)
  if (account === null) return failSend(deps, shell, 'No sending account.', secrets)
  let password: string | null
  try {
    password = deps.secrets.get(account.keychainRef)
  } catch (error: unknown) {
    logEmail(deps, 'error', 'SMTP password could not be read', error, secrets)
    return failSend(deps, shell, 'The SMTP password could not be read.', secrets)
  }
  if (password === null) {
    return failSend(deps, shell, 'The SMTP password is missing from the keychain.', secrets)
  }
  const withPassword = bag(deps, [password])
  try {
    await sendWithRetry(
      deps.transport,
      {
        auth: {
          host: account.host,
          port: account.port,
          security: account.security,
          username: account.username,
          password
        },
        message: {
          fromName: account.fromName,
          fromAddress: account.fromAddress,
          replyTo: account.replyTo,
          to: input.to,
          subject,
          text,
          attachment: input.attachment
        }
      },
      { sleep: deps.sleep, secrets: withPassword }
    )
    logEmail(
      deps,
      'info',
      'SMTP send finished',
      { host: account.host, recipients: input.to.length },
      withPassword
    )
    return recordOutcome(deps, { ...shell, recipients: input.to }, 'sent', null)
  } catch (error: unknown) {
    const smtp = toSmtpError(error, withPassword)
    const translated = translateSmtpFailure({
      kind: smtp.kind,
      smtpCode: smtp.smtpCode,
      provider: account.provider,
      host: account.host,
      port: account.port
    })
    const message = redactString(translated.message, { secrets: withPassword, hexKeys: false })
    logEmail(
      deps,
      'error',
      'SMTP send failed',
      { host: account.host, kind: smtp.kind, smtpCode: smtp.smtpCode, detail: smtp.message },
      withPassword
    )
    return failSend(deps, shell, message, withPassword, translated.nextStep)
  }
}

export async function openDraft(
  deps: ReadyDeps,
  shell: DeliveryShell,
  input: Outgoing,
  subject: string,
  text: string,
  secrets: readonly string[]
): Promise<DeliveryRecord | 'already_sent'> {
  try {
    await deps.drafts.openDraft({
      to: input.to,
      subject,
      body: text,
      attachments: input.attachment === null ? [] : [input.attachment]
    })
    logEmail(deps, 'info', 'Mail draft opened', { recipients: input.to.length }, secrets)
    return recordOutcome(deps, shell, 'draft', WAITING_FOR_A_CLICK)
  } catch (error: unknown) {
    logEmail(deps, 'error', 'Mail draft failed', error, secrets)
    return failSend(deps, shell, 'The mail draft could not be opened.', secrets)
  }
}

export function resolveAccount(
  store: EmailAccountStore,
  accountId: string | null
): EmailAccount | null {
  if (accountId !== null) return store.get(accountId)
  return store.list().find((account) => account.isDefault) ?? null
}

export function isPdf(attachment: EmailAttachment): boolean {
  return (
    attachment.contentType === 'application/pdf' ||
    attachment.filename.toLowerCase().endsWith('.pdf')
  )
}
