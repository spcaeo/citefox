import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressLookup } from '../pipeline/fetch-guard'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'

/**
 * Recorded sitemap responses for tests and unpackaged e2e builds. No network:
 * a URL that is not recorded answers 404. DNS answers one public documentation
 * address (TEST-NET-3 is blocked, so this uses a routable example address).
 */

export const FIXTURE_ADDRESS = '93.184.216.34'

export const fixtureDns: AddressLookup = {
  async lookup(): Promise<readonly string[]> {
    return [FIXTURE_ADDRESS]
  }
}

export interface RecordingTransport extends HttpTransport {
  requests: string[]
}

/** Serves bodies from `lookup(url)`; `status` overrides per URL. */
export function createLookupTransport(
  lookup: (url: string) => string | undefined,
  status: ReadonlyMap<string, number> = new Map()
): RecordingTransport {
  const requests: string[] = []
  return {
    requests,
    async request(request: HttpRequest): Promise<HttpResponse> {
      requests.push(request.url)
      const forced = status.get(request.url)
      if (forced !== undefined) return { status: forced, body: '' }
      const body = lookup(request.url)
      if (body === undefined) return { status: 404, body: 'Not found' }
      return { status: 200, body, headers: { 'content-type': contentType(request.url) } }
    }
  }
}

/** Serves a URL → body map. */
export function createMapTransport(
  files: ReadonlyMap<string, string>,
  status?: ReadonlyMap<string, number>
): RecordingTransport {
  return createLookupTransport((url) => files.get(url), status)
}

/**
 * Serves `<dir>/<encodeURIComponent(url)>` files, read on every request so a
 * test can swap a site's sitemaps between syncs. Used only when an unpackaged
 * build sets `CITEFOX_E2E_SITEMAP_DIR`.
 */
export function createDirectoryTransport(dir: string): RecordingTransport {
  return createLookupTransport((url) => {
    const file = join(dir, encodeURIComponent(url))
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined
  })
}

function contentType(url: string): string {
  return url.endsWith('.txt') ? 'text/plain' : 'application/xml'
}
