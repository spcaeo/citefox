import type {
  CiteFoxApi,
  ClaudeCheckupProgress,
  PermissionRequest,
  PermissionRequestResult,
  PermissionsSnapshot
} from '@shared/ipc'
import type { OnboardingClient } from '../onboarding/client'
import type { ClientMode } from '../onboarding/flags'

/** `permissions:list` and `permissions:request`, plus the checkup progress push. */
export interface PermissionsClient {
  list(): Promise<PermissionsSnapshot>
  request(request: PermissionRequest): Promise<PermissionRequestResult>
  onCheckupProgress(listener: (payload: ClaudeCheckupProgress) => void): () => void
}

/**
 * The live client, or in a dev or e2e build with the mock flag, a mock built
 * on the window's onboarding mock so both agree on keys and the checkup.
 */
export async function loadPermissionsClient(
  mode: ClientMode,
  onboarding: OnboardingClient
): Promise<PermissionsClient> {
  // The guard is written inline (see `mocksAllowed`) so a release build drops the mock chunk.
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    const mock = await import('./mock')
    return mock.createMockPermissionsClient(onboarding)
  }
  return createIpcPermissionsClient()
}

export function createIpcPermissionsClient(): PermissionsClient {
  return {
    list: async () => requireApi()['permissions:list'](),
    request: async (request) => requireApi()['permissions:request'](request),
    onCheckupProgress: (listener) => {
      const subscribe =
        typeof window === 'undefined' ? undefined : window.citefox?.['claudeCode:checkupProgress']
      // A partial bridge (some tests) has no push channel: there is simply no progress.
      if (typeof subscribe !== 'function') return () => undefined
      return subscribe(listener)
    }
  }
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
