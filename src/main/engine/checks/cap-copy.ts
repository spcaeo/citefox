import type { CapRule } from '@shared/domain'

/** `Nov 1` for a `YYYY-MM` month: the day the cap resets. */
export function capResetLabel(month: string): string {
  const [yearText, monthText] = month.split('-')
  const index = Number(monthText)
  const next = new Date(Date.UTC(Number(yearText), index === 12 ? 12 : index, 1))
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(next)
}

/**
 * FR-11.4 next step when a check stops at the project's cap, by the project's rule.
 * `pause` waits for the reset, `notify` waits for the user, `allow_10` already used the
 * extra 10%. Every rule keeps the searches already made.
 */
export function capNextStep(rule: CapRule, month: string): string {
  const reset = capResetLabel(month)
  if (rule === 'notify') {
    return `CiteFox is waiting for you. Raise the cap in Project settings, or wait until it resets on ${reset}.`
  }
  if (rule === 'allow_10') {
    return `This includes the 10% extra. Raise the cap in Project settings, or wait until it resets on ${reset}.`
  }
  return `Checks for this project pause until the cap resets on ${reset}. Raise the cap in Project settings to check now.`
}
