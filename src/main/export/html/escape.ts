/**
 * Escaping for the HTML report. Every string from the model reaches the page through
 * {@link esc}, and every link through {@link link}, so stored text can never become
 * markup or a script.
 */

/** Escapes text for element content and quoted attribute values. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The URL when it is http or https, otherwise null. Other schemes never become links. */
export function safeUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.length === 0) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** A link that opens in a new tab without a referrer, or escaped text when the URL is not http(s). */
export function link(url: string | null | undefined, text?: string, className?: string): string {
  const label = text ?? url ?? ''
  const href = safeUrl(url)
  if (href === null) return esc(label)
  const cls = className === undefined ? '' : ` class="${esc(className)}"`
  return `<a${cls} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
}

const SCRIPT_UNSAFE: Readonly<Record<string, string>> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
}

/**
 * JSON for a `<script type="application/json">` element. `<`, `>`, `&`, U+2028 and
 * U+2029 become `\u` escapes, so the text can never close the element or start a comment.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => SCRIPT_UNSAFE[char] ?? '')
}

/** A CSS colour from settings, or the fallback when it is not a plain hex colour. */
export function safeColor(value: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback
}

/** An id-safe slug for element ids and table ids. */
export function slugId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'x'
}
