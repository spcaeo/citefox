/**
 * A topic's target page (project migration 047): the one page on the project's own
 * site its questions should be cited from. Main classifies a check with it and the
 * topic screen shows and edits it, so both read the same rules from here. Pure.
 *
 * A target is stored as a full `https://` URL on the own domain, with no query,
 * fragment or trailing slash. Two URLs are the same page when their host (without
 * `www.`) and path match, ignoring the scheme, case, a trailing slash, the query
 * and the fragment.
 */

import { bareDomain, isOwnHost } from './own-site'

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu
/** `example.com`, `help.example.co.uk`: a first part read as a host, not as a path. */
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.([a-z]{2,})$/u
/** `pricing.html`: a page name that looks like a host. */
const FILE_ENDINGS = new Set(['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'pdf', 'xml', 'txt'])

/**
 * Turns what the user typed (a full URL, `example.com/pricing`, `/pricing` or
 * `pricing`) into the stored URL. A path is put on the own domain. Null when the
 * value is empty, not a web address, or on another site (a subdomain counts as the
 * own site only when `includeSubdomains`).
 */
export function resolveTargetPage(
  value: string,
  ownDomain: string,
  includeSubdomains = true
): string | null {
  const trimmed = value.trim()
  const domain = bareDomain(ownDomain)
  if (trimmed.length === 0 || domain.length === 0) return null
  const firstPart = (trimmed.split(/[/?#]/u)[0] ?? '').toLowerCase()
  const ending = HOST.exec(firstPart)?.[1]
  const looksLikeHost =
    SCHEME.test(trimmed) ||
    (!trimmed.startsWith('/') && ending !== undefined && !FILE_ENDINGS.has(ending))
  const raw = looksLikeHost
    ? SCHEME.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    : `https://${domain}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (!isOwnHost(host.replace(/^www\./u, ''), domain, includeSubdomains)) return null
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/u, '') || '/' : '/'
  return `https://${host}${path}`
}

/** `example.com/pricing`: the host without `www.` and the path, lowercase. Null when not a URL. */
export function targetPageKey(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(SCHEME.test(url) ? url : `https://${url}`)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./u, '')
  if (host.length === 0) return null
  const path = parsed.pathname.replace(/\/+$/u, '')
  return `${host}${path}`.toLowerCase()
}

/** True when both are set and are the same page (see the module note). */
export function sameTargetPage(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return false
  const key = targetPageKey(left)
  return key !== null && key === targetPageKey(right)
}

/** `/pricing` for display; the value itself when it is not a URL. */
export function targetPagePath(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}
