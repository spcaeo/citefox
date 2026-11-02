/** Site icons (`favicons:get`). */

import { join } from 'node:path'
import type { faviconsChannels, FaviconRequest, IpcHandlersFor } from '@shared/ipc'
import { openFaviconCache } from '../favicons/cache'
import { fetchFavicon } from '../favicons/fetch'
import { createFaviconService, type FaviconService } from '../favicons/service'
import { IpcRequestError } from '../ipc-request'
import { resolvePublicAddresses, systemAddressLookup } from '../pipeline/fetch-guard'
import { guard, type EngineContext } from './context'

export interface FaviconHandlerDeps {
  /** Test seam: a service with a fake fetch and an in-memory cache. */
  favicons?: FaviconService
  /** Unpackaged test runs (`CITEFOX_FAVICONS=off`): no icon is fetched. */
  faviconsOff?: boolean
}

export function faviconsHandlers(
  ctx: EngineContext,
  deps: FaviconHandlerDeps = {}
): IpcHandlersFor<typeof faviconsChannels> {
  const service =
    deps.favicons ??
    createFaviconService({
      cache: () => openFaviconCache(join(ctx.storage.paths.root, 'favicons.sqlite')),
      fetch: (domain) =>
        fetchFavicon(domain, {
          http: ctx.http,
          resolveHost: (hostname) =>
            resolvePublicAddresses(hostname, ctx.pageDns ?? systemAddressLookup())
        }),
      now: () => ctx.now().getTime(),
      enabled: () => deps.faviconsOff !== true
    })
  return {
    'favicons:get': (request) =>
      guard('favicons:get', ctx, () => service.get(parseFaviconRequest(request).domains))
  }
}

function parseFaviconRequest(request: unknown): FaviconRequest {
  const domains =
    typeof request === 'object' && request !== null
      ? (request as { domains?: unknown }).domains
      : undefined
  if (!Array.isArray(domains) || domains.some((domain) => typeof domain !== 'string')) {
    throw new IpcRequestError('favicons:get', 'domains must be a list of strings')
  }
  return { domains: domains as string[] }
}
