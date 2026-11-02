import type { Logger } from '../logging/logger'
import { redactString } from '../logging/redact'
import {
  assertPublicPageUrl,
  MAX_DIRECT_REDIRECTS,
  resolvePublicAddresses,
  systemAddressLookup,
  type AddressLookup
} from '../pipeline/fetch-guard'
import { CITEFOX_USER_AGENT, requestWithRetry, type HttpTransport } from '../providers/http'
import { SITEMAP_LIMITS, SitemapParseError, decodeSitemapBody } from './sitemap-parse'

/** robots.txt is small. Anything bigger is cut off by the transport. */
export const MAX_ROBOTS_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 20_000

/** The guarded transport sitemap reads use. Tests pass a fake http and DNS. */
export interface SitemapFetchDeps {
  http: HttpTransport
  dns?: AddressLookup
  logger: Logger
  secrets: () => readonly string[]
  sleep?: (ms: number) => Promise<void>
}

export type FetchTextResult =
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; status: number | null; message: string }

/**
 * GET a robots.txt or sitemap through the same SSRF guard as page reads:
 * every hop's host must resolve only to public addresses, and the transport
 * connects to exactly those addresses. Redirects are followed by hand, at most
 * {@link MAX_DIRECT_REDIRECTS}. Never throws for a network or HTTP failure.
 */
export async function fetchSitemapText(
  deps: SitemapFetchDeps,
  url: string,
  kind: 'robots' | 'sitemap'
): Promise<FetchTextResult> {
  const resolve = deps.dns ?? systemAddressLookup()
  const maxBytes = kind === 'robots' ? MAX_ROBOTS_BYTES : SITEMAP_LIMITS.maxBytes
  const secrets = deps.secrets()
  let current = url
  for (let hop = 0; ; hop += 1) {
    try {
      await assertPublicPageUrl(current, resolve)
    } catch {
      return {
        ok: false,
        status: null,
        message: 'CiteFox will not read a private or local address.'
      }
    }
    let response
    try {
      response = await requestWithRetry(
        deps.http,
        {
          method: 'GET',
          url: current,
          headers: {
            accept:
              kind === 'robots'
                ? 'text/plain,*/*;q=0.5'
                : 'application/xml,text/xml;q=0.9,application/x-gzip;q=0.8,*/*;q=0.5',
            'user-agent': CITEFOX_USER_AGENT
          },
          resolveHost: (hostname) => resolvePublicAddresses(hostname, resolve),
          maxBodyBytes: maxBytes
        },
        {
          timeoutMs: FETCH_TIMEOUT_MS,
          label: kind === 'robots' ? 'robots.txt' : 'Sitemap',
          secrets,
          ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {})
        }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network request failed'
      deps.logger.warn('sitemap fetch failed', {
        kind,
        message: redactString(message, { secrets })
      })
      return {
        ok: false,
        status: null,
        message: 'Could not reach the server. Check the network and try again.'
      }
    }
    if (isRedirect(response.status)) {
      const location = header(response.headers, 'location')
      if (hop >= MAX_DIRECT_REDIRECTS || location === null) {
        return {
          ok: false,
          status: response.status,
          message: 'The address redirected too many times.'
        }
      }
      try {
        current = new URL(location, current).href
      } catch {
        return {
          ok: false,
          status: response.status,
          message: 'The redirect had no valid destination.'
        }
      }
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        status: response.status,
        message:
          response.status === 404 ? 'Not found (404).' : `The server answered ${response.status}.`
      }
    }
    try {
      const text =
        kind === 'robots'
          ? response.body.slice(0, MAX_ROBOTS_BYTES)
          : decodeSitemapBody(
              {
                body: response.body,
                ...(response.bytes !== undefined ? { bytes: response.bytes } : {})
              },
              maxBytes
            )
      return { ok: true, text, finalUrl: current }
    } catch (error) {
      const message =
        error instanceof SitemapParseError ? error.message : 'The file could not be read.'
      return { ok: false, status: response.status, message }
    }
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function header(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | null {
  if (headers === undefined) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && value.trim().length > 0) return value
  }
  return null
}
