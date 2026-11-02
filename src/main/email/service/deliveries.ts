import { isSendNowDelivery, type DeliveryTrigger } from '@shared/domain'
import { redactString } from '../../logging/redact'
import { FIX_IN_EMAIL_SETUP } from '../errors'
import type { DeliveryRecord, NotifyResult } from '../types'
import { asNotify, bag } from './support'
import type { ReadyDeps } from './types'

export interface DeliveryShell {
  id: string
  scheduleId: string | null
  at: string
  trigger: DeliveryTrigger
  projectId: string | null
  recipients: readonly string[]
  occurrenceKey: string | null
}

export function baseRecord(
  deps: ReadyDeps,
  input: {
    trigger: DeliveryTrigger
    scheduleId: string | null
    projectId: string | null
    recipients: readonly string[]
    occurrenceKey: string | null
  }
): DeliveryShell {
  return {
    id: deps.createId(),
    scheduleId: input.scheduleId,
    at: deps.clock.now().toISOString(),
    trigger: input.trigger,
    projectId: input.projectId,
    recipients: input.recipients,
    occurrenceKey: input.occurrenceKey
  }
}

export function failSend(
  deps: ReadyDeps,
  shell: DeliveryShell,
  reason: string,
  secrets: readonly string[],
  nextStep: string = FIX_IN_EMAIL_SETUP
): DeliveryRecord | 'already_sent' {
  const message = redactString(reason, { secrets, hexKeys: false })
  return recordOutcome(deps, shell, 'failed', message, nextStep)
}

export function recordFailure(deps: ReadyDeps, shell: DeliveryShell, reason: string): NotifyResult {
  return asNotify(failSend(deps, shell, reason, bag(deps)))
}

export function recordOutcome(
  deps: ReadyDeps,
  shell: DeliveryShell,
  outcome: DeliveryRecord['outcome'],
  reason: string | null,
  nextStep: string | null = null
): DeliveryRecord | 'already_sent' {
  const delivery: DeliveryRecord = {
    ...shell,
    // A failed send frees its slot for a retry, except Send now: its key is
    // unique (`now:<id>`) and is how history tells it apart from the schedule's sends.
    occurrenceKey: outcome === 'failed' && !isSendNowDelivery(shell) ? null : shell.occurrenceKey,
    outcome,
    ok: outcome === 'sent',
    reason: outcome === 'sent' ? null : reason,
    nextStep: outcome === 'failed' ? nextStep : null
  }
  if (deps.deliveries.add(delivery) === 'already_sent') return 'already_sent'
  return delivery
}
