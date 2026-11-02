import type { ClientMode } from './flags'
import type { OnboardingClient } from './client'
import type { MockOnboardingClient } from './mockClient'
import { createIpcSectionClient, type SetupSectionClient } from './sectionClient'
import { createIpcSetupServices, type SetupServices } from './setupServices'

export interface SetupClients {
  sections: SetupSectionClient
  services: SetupServices
}

/**
 * Onboarding v2's section client and step services: the preload bridge, or the
 * in-memory mocks when the mock was asked for and this build allows it. The guard is
 * `mocksAllowed()` written inline (see flags.ts), so a release build has no mock chunk.
 */
export async function loadSetupClients(
  mode: ClientMode,
  onboarding: OnboardingClient
): Promise<SetupClients> {
  if (mode === 'mock' && (import.meta.env.DEV || import.meta.env.VITE_CITEFOX_E2E_MOCKS === '1')) {
    const [{ createMockSetupServices }, { createMockSectionClient, mockClaudeAvailable }] =
      await Promise.all([import('./mockSetupServices'), import('./mockSections')])
    return {
      sections: createMockSectionClient(isMockOnboarding(onboarding) ? { onboarding } : {}),
      services: createMockSetupServices({ available: mockClaudeAvailable() })
    }
  }
  return { sections: createIpcSectionClient(), services: createIpcSetupServices() }
}

/** In mock mode the onboarding client is the mock one, which finishSetup reports back to. */
function isMockOnboarding(client: OnboardingClient): client is MockOnboardingClient {
  return 'completeSetup' in client && 'forgetKeychain' in client
}
