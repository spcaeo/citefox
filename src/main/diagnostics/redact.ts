import { REDACTED, redactString } from '../logging/redact'

/**
 * The strict pass over a whole problem report, after the log's own redaction. It is
 * deliberately greedy: a report that hides a harmless string is fine, a report that
 * shows a key is not. It removes
 *   - the exact keys CiteFox holds, and anything shaped like an API key or token,
 *   - email addresses,
 *   - the home folder (the user's name inside a path becomes `~`),
 *   - IP addresses (IPv4 and IPv6).
 */

export interface StrictRedactOptions {
  /** Exact secret values to remove (every key CiteFox holds). */
  secrets?: readonly string[]
  /** This computer's home folder. Replaced by `~` wherever it appears. */
  home?: string | null
}

export const EMAIL_MARK = '[email]'
export const IP_MARK = '[ip]'

const KEY_SHAPES: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /pk_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
]

/** `api_key: abc`, `token=abc`, `Authorization: abc`: keep the name, hide the value. */
const NAMED_SECRET =
  /\b(api[-_ ]?key|apikey|access[-_ ]?token|auth[-_ ]?token|secret|token|passwd|password|authorization)(["']?\s*[:=]\s*["']?)([^\s"',;&]{4,})/gi

const LOCAL_CHAR = /[A-Za-z0-9._%+'-]/
const DOMAIN_CHAR = /[A-Za-z0-9.-]/

/**
 * Email addresses, found from each `@` outwards. A pattern like `[a-z]+@` would rescan
 * a long run of letters from every position, which is slow on hostile input.
 */
function redactEmails(text: string): string {
  let out = ''
  let copied = 0
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    let start = at
    while (start > copied && LOCAL_CHAR.test(text.charAt(start - 1))) start -= 1
    let end = at + 1
    while (end < text.length && DOMAIN_CHAR.test(text.charAt(end))) end += 1
    while (end > at + 1 && /[.-]/.test(text.charAt(end - 1))) end -= 1
    const domain = text.slice(at + 1, end)
    if (start === at || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(domain)) continue
    out += text.slice(copied, start) + EMAIL_MARK
    copied = end
  }
  return out + text.slice(copied)
}

const HEX_SECRET = /\b[a-fA-F0-9]{32,}\b/g
const LONG_TOKEN = /[A-Za-z0-9+/_-]{32,}={0,2}/g

const IPV4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.]*\w)/g
const IPV6 = /(?<![\w:])[0-9A-Fa-f:]{3,}(?![\w:])/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `/Users/ann/x`, `/home/ann/x`, `C:\Users\ann\x` become `~/x`: any user's home, not only ours. */
const GENERIC_HOME =
  /(?:file:\/\/)?(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s"'<>:]+(?=[\\/\s"'<>:]|$)/g

/** The home folder as a path ends and separators vary: one regex per spelling. */
function homePatterns(home: string): RegExp[] {
  const trimmed = home.replace(/[\\/]+$/, '')
  if (trimmed.length < 3 || !/[\\/]/.test(trimmed)) return []
  const forward = trimmed.replace(/\\/g, '/')
  const back = trimmed.replace(/\//g, '\\')
  const variants = new Set([trimmed, forward, back, encodeURI(forward)])
  return [...variants].map((variant) => new RegExp(escapeRegExp(variant), 'gi'))
}

function hasMixedCase(token: string): boolean {
  return /[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token)
}

/** A long mixed-case token with digits. A path with a '/' needs one long mixed segment. */
function looksLikeSecret(token: string): boolean {
  if (!hasMixedCase(token)) return false
  if (!token.includes('/')) return true
  return token.split('/').some((segment) => segment.length >= 20 && hasMixedCase(segment))
}

function isIpv4(candidate: string): boolean {
  const parts = candidate.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** A colon-separated hex run that is an IPv6 address (or a MAC), not a clock time or `a::b`. */
function isIpv6(candidate: string): boolean {
  const colons = (candidate.match(/:/g) ?? []).length
  if (colons < 2) return false
  if (!/^[0-9A-Fa-f:]+$/.test(candidate)) return false
  if (candidate.includes('::')) return /[0-9A-Fa-f]/.test(candidate.replace(/:/g, ''))
  return colons >= 5
}

/** Removes secrets, emails, the home folder and IP addresses from `input`. */
export function redactReport(input: string, options: StrictRedactOptions = {}): string {
  let text = input
  // The exact keys first, so a key that is also shaped like a path is still caught whole.
  text = redactString(text, { secrets: options.secrets ?? [] })
  for (const pattern of KEY_SHAPES) text = text.replace(pattern, REDACTED)
  text = text.replace(NAMED_SECRET, (_all, name: string, glue: string, value: string) =>
    value === REDACTED || value.startsWith('[REDACTED')
      ? `${name}${glue}${value}`
      : `${name}${glue}${REDACTED}`
  )
  // Paths next, so their names are not read as tokens below.
  if (options.home)
    for (const pattern of homePatterns(options.home)) text = text.replace(pattern, '~')
  text = text.replace(GENERIC_HOME, '~')
  text = redactEmails(text)
  text = text.replace(HEX_SECRET, REDACTED)
  text = text.replace(LONG_TOKEN, (token) => (looksLikeSecret(token) ? REDACTED : token))
  text = text.replace(IPV4, (found) => (isIpv4(found) ? IP_MARK : found))
  text = text.replace(IPV6, (found) => (isIpv6(found) ? IP_MARK : found))
  return text
}

/** A path with the home folder cut to `~` and nothing else of it kept but the file name. */
export function fileNameOnly(path: string | null | undefined): string | null {
  if (!path) return null
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
  const last = parts[parts.length - 1]
  return last ?? null
}
