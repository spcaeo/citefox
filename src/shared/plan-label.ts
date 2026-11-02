/**
 * A plan name followed by the word "plan", once.
 * SerpApi already names some plans "Volume Plan" or "Big Data Plan", so
 * "Developer" → "Developer plan" but "Volume Plan" stays "Volume Plan".
 */
export function planLabel(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return ''
  return /\bplan$/i.test(trimmed) ? trimmed : `${trimmed} plan`
}
