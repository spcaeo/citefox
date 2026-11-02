import type { PageResults } from '@shared/domain'
import type {
  CheckJob,
  GetResultsRequest,
  PageDetail,
  StartCheckRequest,
  StatusCapsule,
  UpdatePageRequest
} from '@shared/ipc'

/**
 * The existing channels the Markets tab uses (FR-9). `results:get` per market
 * is the same payload the Results screen draws, so every number matches it.
 * Production uses the preload allow-list; tests pass another `MarketsSource`.
 */
export interface MarketsSource {
  'results:get'(request: GetResultsRequest): Promise<PageResults>
  'pages:update'(request: UpdatePageRequest): Promise<PageDetail>
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'status:getCapsule'(): Promise<StatusCapsule>
}

export function createMarketsSource(): MarketsSource {
  return {
    'results:get': (request) => requireApi()['results:get'](request),
    'pages:update': (request) => requireApi()['pages:update'](request),
    'checks:start': (request) => requireApi()['checks:start'](request),
    'status:getCapsule': () => requireApi()['status:getCapsule']()
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
