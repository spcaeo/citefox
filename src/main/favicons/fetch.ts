import type { HttpResponse, HttpTransport } from '../providers/http'
import { CITEFOX_USER_AGENT } from '../providers/http'
import { withTimeout } from '../providers/timeout'

/**
 * Fetches one site's icon for the lists that show domains (Overview "Who gets
 * cited", Competitors, citations). The renderer's CSP blocks remote images, so
 * main fetches the icon and hands the renderer a `data:` URI.
 *
 * Order: `https://<domain>/favicon.ico`, then the home page's `<link rel=icon>`
 * (and `apple-touch-icon`). Every request has a short timeout and a byte cap,
 * goes through the SSRF guard (`resolveHost`), follows at most a few https
 * redirects, and keeps only image content types. Anything else is "no icon".
 */

/** Largest icon kept, in bytes. */
export const FAVICON_MAX_BYTES = 64 * 1024
/** Largest home page read to find `<link rel=icon>`. */
export const FAVICON_PAGE_MAX_BYTES = 256 * 1024
/** Per request. */
export const FAVICON_TIMEOUT_MS = 3000
const MAX_REDIRECTS = 3
const MAX_LINK_CANDIDATES = 2

const IMAGE_TYPES = new Set([
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/ico',
  'image/icon',
  'image/png',
  'image/gif',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/svg+xml'
])

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u

export interface FaviconFetchDeps {
  http: HttpTransport
  /** The SSRF guard: every public address of `hostname`, or throws. */
  resolveHost: (hostname: string) => Promise<readonly string[]>
  timeoutMs?: number
  maxBytes?: number
}

/** `https://WWW.Example.com/x` → `example.com`; null when it is not a public hostname. */
export function faviconDomain(value: string): string | null {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .split(/[/?#]/u)[0]
    ?.replace(/:\d+$/u, '')
    .replace(/\.$/u, '')
    .replace(/^www\./u, '')
  return host !== undefined && host.length <= 253 && HOSTNAME.test(host) ? host : null
}

/** The icon as a data URI, or null when the site has none we can use. Never throws. */
export async function fetchFavicon(domain: string, deps: FaviconFetchDeps): Promise<string | null> {
  const host = faviconDomain(domain)
  if (host === null) return null
  const direct = await fetchIcon(`https://${host}/favicon.ico`, deps)
  if (direct !== null) return direct
  const page = await get(`https://${host}/`, deps, FAVICON_PAGE_MAX_BYTES)
  if (page === null || page.response.status !== 200) return null
  const type = contentType(page.response)
  if (type !== null && type !== 'text/html' && type !== 'application/xhtml+xml') return null
  for (const href of iconLinks(page.response.body).slice(0, MAX_LINK_CANDIDATES)) {
    const url = absoluteHttps(href, page.url)
    if (url === null) continue
    const icon = await fetchIcon(url, deps)
    if (icon !== null) return icon
  }
  return null
}

async function fetchIcon(url: string, deps: FaviconFetchDeps): Promise<string | null> {
  const maxBytes = deps.maxBytes ?? FAVICON_MAX_BYTES
  const got = await get(url, deps, maxBytes)
  if (got === null || got.response.status !== 200) return null
  return toDataUri(got.response, maxBytes)
}

/** A GET that follows up to {@link MAX_REDIRECTS} https redirects. Null on any failure. */
async function get(
  url: string,
  deps: FaviconFetchDeps,
  maxBodyBytes: number
): Promise<{ url: string; response: HttpResponse } | null> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: HttpResponse
    const timeoutMs = deps.timeoutMs ?? FAVICON_TIMEOUT_MS
    const target = current
    try {
      // The transport has its own timeout; the race also bounds a transport that ignores it.
      response = await withTimeout(
        (signal) =>
          deps.http.request({
            method: 'GET',
            url: target,
            headers: { 'user-agent': CITEFOX_USER_AGENT, accept: 'image/*,text/html;q=0.8' },
            timeoutMs,
            signal,
            maxBodyBytes,
            resolveHost: deps.resolveHost
          }),
        timeoutMs,
        'Site icon'
      )
    } catch {
      return null
    }
    if (response.status >= 300 && response.status < 400) {
      const next = absoluteHttps(header(response, 'location') ?? '', current)
      if (next === null) return null
      current = next
      continue
    }
    return { url: current, response }
  }
  return null
}

/** The response as a data URI when it is a small image of an allowed type. */
export function toDataUri(response: HttpResponse, maxBytes = FAVICON_MAX_BYTES): string | null {
  const type = contentType(response)
  if (type === null || !IMAGE_TYPES.has(type)) return null
  const bytes =
    response.bytes ?? (type === 'image/svg+xml' ? new TextEncoder().encode(response.body) : null)
  if (bytes === null || bytes.length === 0 || bytes.length > maxBytes) return null
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).trimStart()
  if (type === 'image/svg+xml') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (!/<svg[\s>]/iu.test(text) || /<script|\son\w+\s*=|javascript:/iu.test(text)) return null
  } else if (head.startsWith('<')) {
    // An HTML error page served as an image.
    return null
  }
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}

function header(response: HttpResponse, name: string): string | null {
  const headers = response.headers ?? {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}

function contentType(response: HttpResponse): string | null {
  const value = header(response, 'content-type')
  if (value === null) return null
  return value.split(';')[0]?.trim().toLowerCase() || null
}

/** `href` resolved against `base`; https only. */
function absoluteHttps(href: string, base: string): string | null {
  if (href.trim().length === 0) return null
  try {
    const url = new URL(href.trim(), base)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * The `href`s of `<link rel="icon">`, `rel="shortcut icon"` and then
 * `rel="apple-touch-icon"` in the page, in that order of preference.
 */
export function iconLinks(html: string): string[] {
  const icons: string[] = []
  const touch: string[] = []
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const tag = match[0]
    const rel = attribute(tag, 'rel')?.toLowerCase().split(/\s+/u) ?? []
    const href = attribute(tag, 'href')
    if (!href || href.startsWith('data:')) continue
    if (rel.includes('icon')) icons.push(decodeEntities(href))
    else if (rel.includes('apple-touch-icon')) touch.push(decodeEntities(href))
  }
  return [...icons, ...touch]
}

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu')
  const match = pattern.exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&#x2f;/giu, '/')
    .replace(/&#47;/gu, '/')
}
