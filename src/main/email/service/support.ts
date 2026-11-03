import { redactString, redactValue } from '../../logging/redact'
import { assertKeychainRef } from '../../secrets/secret-store'
import { EmailError } from '../errors'
import type { DeliveryRecord, NotifyResult, ReportSchedule } from '../types'
import type { ReadyDeps } from './types'

export function asNotify(result: DeliveryRecord | 'already_sent'): NotifyResult {
  if (result === 'already_sent') return { action: 'skipped', reason: 'already_sent' }
  return { action: 'recorded', delivery: result }
}

export function requireDelivery(result: DeliveryRecord | 'already_sent'): DeliveryRecord {
  if (result === 'already_sent') throw new EmailError('Already sent', 'invalid')
  return result
}

export function requireReport(deps: ReadyDeps, scheduleId: string): ReportSchedule {
  const schedule = deps.reports.get(scheduleId)
  if (schedule === null) throw new EmailError('Unknown report', 'not_found')
  return schedule
}

export function readEmailSafeId(projectId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(projectId)) {
    throw new EmailError('Invalid request', 'invalid')
  }
}

export function newRef(kind: 'smtp' | 'slack', createId: () => string): string {
  const ref = `citefox.${kind}.${createId()}`
  try {
    assertKeychainRef(ref)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid keychain ref'
    throw new EmailError(message, 'invalid')
  }
  return ref
}

export function mutateSecret(run: () => void, secrets: readonly string[]): void {
  try {
    run()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Keychain failed'
    throw new EmailError(message, 'invalid', secrets)
  }
}

export function readSecret(
  deps: ReadyDeps,
  ref: string,
  secrets: readonly string[]
): string | null {
  try {
    return deps.secrets.get(ref)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Keychain failed'
    throw new EmailError(message, 'invalid', secrets)
  }
}

export function bag(deps: ReadyDeps, extra: readonly string[] = []): string[] {
  const known = deps.knownSecrets?.() ?? []
  return [...known, ...extra].filter((secret) => secret.length > 0)
}

export function logEmail(
  deps: ReadyDeps,
  level: 'info' | 'error',
  message: string,
  extra: unknown,
  secrets: readonly string[]
): void {
  const safeMessage = redactString(message, { secrets })
  deps.logger[level](safeMessage, maskEmailAddresses(redactValue(extra, { secrets })))
}

const EMAIL_ADDRESS = /[^\s<>"'(),;:@\\]+@[^\s<>"'(),;:@\\]+\.[^\s<>"'(),;:@\\]+/gu

/**
 * A mail server's answer can quote the recipient or the sender ("550 <name@host> unknown").
 * Logs hold no email address, so every one in a logged value is replaced.
 */
export function maskEmailAddresses<T>(value: T): T {
  const encoded = JSON.stringify(value)
  if (encoded === undefined || !encoded.includes('@')) return value
  return JSON.parse(encoded.replace(EMAIL_ADDRESS, '[email]')) as T
}
