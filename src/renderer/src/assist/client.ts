import type {
  AssistDescribeRequest,
  AssistDescription,
  AssistResult,
  AssistRunRequest,
  CiteFoxApi
} from '@shared/ipc'
import { type ClientMode } from '../onboarding/flags'

/**
 * The assist channels (FR-25). One pair serves every assist button.
 * Argument and result types are the IPC contract. The mock is for dev and e2e builds only.
 */
export interface AssistClient {
  describe(request: AssistDescribeRequest): Promise<AssistDescription>
  run(request: AssistRunRequest): Promise<AssistResult>
}

export function createAssistClient(mode: ClientMode): AssistClient {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    return createMockAssistClient()
  }
  return createIpcAssistClient()
}

/** The mock module loads on first use, so it stays out of the main bundle. */
export function createMockAssistClient(): AssistClient {
  const mock = async (): Promise<typeof import('./mock')> => import('./mock')
  return {
    describe: async (request) => (await mock()).describeMockAssist(request),
    run: async (request) => (await mock()).runMockAssist(request)
  }
}

function createIpcAssistClient(): AssistClient {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    describe: async (request) => requireApi()['assist:describe'](request),
    run: async (request) => requireApi()['assist:run'](request)
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
