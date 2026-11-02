/** Date and number wording shared by the report builders. */

/** `19 October 2026` in the report's time zone. The input when it does not parse. */
export function formatLongDate(iso: string, timeZone: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(parsed)
}

/** `19 Oct 2026` in the report's time zone. */
export function formatShortDate(iso: string, timeZone: string): string {
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(parsed)
}

/** `1 prompt`, `3 prompts`. */
export function countNoun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Mean of the values, or null for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** One decimal place, `2.5`. */
export function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
