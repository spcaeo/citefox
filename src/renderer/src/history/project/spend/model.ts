/** "October" for `2026-10`. */
export function monthName(month: string): string {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, index - 1, 15)).toLocaleDateString('en-US', {
    month: 'long',
    timeZone: 'UTC'
  })
}

/** "Oct 31" in this computer's time zone. */
export function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
