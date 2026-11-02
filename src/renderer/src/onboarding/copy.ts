import { planLabel } from '@shared/plan-label'
import { errorText, GENERIC_ERROR } from '../components/errorText'

/** Join the ids that should be named in aria-describedby. */
export function describedBy(ids: readonly (string | false | undefined)[]): string | undefined {
  const value = ids.filter((id): id is string => Boolean(id)).join(' ')
  return value.length > 0 ? value : undefined
}

/** Drop an engine message that somehow contains the secret the user just sent. */
export function safeClientMessage(error: unknown, secret = ''): string {
  return errorText(error, GENERIC_ERROR, { secret })
}

/**
 * The sentence after "Claude Code is ready." on a passed checkup, or null.
 * The engine message already names the plan, so this is only added when the
 * message does not (an older engine, or a mock).
 */
export function claudeReadyExtra(message: string, plan: string | null): string | null {
  if (!plan) return null
  const sentence = `CiteFox will run its analysis on your ${planLabel(plan)}.`
  const mentionsPlan = message.toLowerCase().includes(plan.trim().toLowerCase())
  return mentionsPlan || message.includes(sentence) ? null : sentence
}
