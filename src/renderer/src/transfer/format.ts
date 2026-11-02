/** "20 Oct 2026, 09:00" in the reader's own format; the raw text when it is not a date. */
export function exportedOn(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
