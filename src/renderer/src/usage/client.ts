import type { CiteFoxApi, LlmUsage, LlmUsageRequest } from '@shared/ipc'
import { type ClientMode } from '../onboarding/flags'

/**
 * The Claude call log summary (FR-25.6), read through `llm:usage`.
 * The mock is for dev and e2e builds only.
 */
export interface UsageClient {
  usage(request: LlmUsageRequest): Promise<LlmUsage>
}

export function createUsageClient(mode: ClientMode): UsageClient {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return createMockUsageClient()
  }
  return createIpcUsageClient()
}

/** The mock module loads on first use, so it stays out of the main bundle. */
export function createMockUsageClient(): UsageClient {
  const mock = async (): Promise<typeof import('./mock')> => import('./mock')
  return {
    usage: async (request) => (await mock()).mockLlmUsage(request)
  }
}

function createIpcUsageClient(): UsageClient {
  return {
    // Async, so a missing bridge rejects instead of throwing inside a render effect.
    usage: async (request) => requireApi()['llm:usage'](request)
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
