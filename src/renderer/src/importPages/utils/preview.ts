/**
 * "Sep 26, 2026" for a sitemap date or date-time. The raw text when it does not
 * parse. Search, sort and folder grouping of the preview run on the list grid.
 */
export function formatLastmod(lastmod: string | null): string {
  if (!lastmod) return '—'
  const at = Date.parse(lastmod)
  if (Number.isNaN(at)) return lastmod
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(lastmod)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {})
  }).format(new Date(at))
}
