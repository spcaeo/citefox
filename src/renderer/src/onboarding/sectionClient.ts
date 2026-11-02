import type {
  CiteFoxApi,
  FinishSetupRequest,
  FinishSetupResult,
  HelpFillEstimate,
  SetupSectionEstimateRequest,
  SetupSectionPrompt,
  SetupSectionReadRequest,
  SetupSectionRequest,
  SetupSectionResult,
  SetupSectionRunRequest
} from '@shared/ipc'

/**
 * Onboarding v2: the section cards' channels (✦ Find more, ✦ Redo, Edit the prompt,
 * your own ChatGPT) and step 8's finish. Kept apart from `OnboardingClient`, which
 * Settings and Connections also implement.
 */
export interface SetupSectionClient {
  sectionEstimate(request: SetupSectionEstimateRequest): Promise<HelpFillEstimate>
  sectionPrompt(request: SetupSectionRequest): Promise<SetupSectionPrompt>
  sectionRun(request: SetupSectionRunRequest): Promise<SetupSectionResult>
  sectionRead(request: SetupSectionReadRequest): Promise<SetupSectionResult>
  finishSetup(request: FinishSetupRequest): Promise<FinishSetupResult>
}

function requireApi(): CiteFoxApi {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createIpcSectionClient(): SetupSectionClient {
  return {
    sectionEstimate: (request) => requireApi()['onboarding:sectionEstimate'](request),
    sectionPrompt: (request) => requireApi()['onboarding:sectionPrompt'](request),
    sectionRun: (request) => requireApi()['onboarding:sectionRun'](request),
    sectionRead: (request) => requireApi()['onboarding:sectionRead'](request),
    finishSetup: (request) => requireApi()['onboarding:finishSetup'](request)
  }
}
