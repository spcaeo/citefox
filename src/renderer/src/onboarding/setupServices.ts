import type { ProjectSchedule } from '@shared/domain'
import type {
  EngineEstimate,
  EngineEstimateRequest,
  EnginesProjectRequest,
  ProjectEnginesView,
  SetProjectEnginesRequest,
  UpdateProjectScheduleRequest
} from '@shared/ipc'
import type { SetupHelpSource } from '../fill/setupHelp'

/**
 * The other channels onboarding v2's steps call, beside `OnboardingClient` (keys,
 * Claude, the website read) and `SetupSectionClient` (the section cards):
 * - step 3's "Use my own ChatGPT": `helpfill:setupEstimate|setupPrompt|setupRead`;
 * - step 7: `engines:get|set|estimate` and the project's schedule.
 * Production uses the preload bridge; the mock build and tests pass their own.
 */
export interface SetupServices extends SetupHelpSource {
  'engines:get'(request: EnginesProjectRequest): Promise<ProjectEnginesView>
  'engines:set'(request: SetProjectEnginesRequest): Promise<ProjectEnginesView>
  'engines:estimate'(request: EngineEstimateRequest): Promise<EngineEstimate>
  'schedule:updateProject'(request: UpdateProjectScheduleRequest): Promise<ProjectSchedule>
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** Async so a missing bridge rejects the call instead of throwing during render. */
export function createIpcSetupServices(): SetupServices {
  return {
    'helpfill:setupEstimate': async () => requireApi()['helpfill:setupEstimate'](),
    'helpfill:setupPrompt': async (request) => requireApi()['helpfill:setupPrompt'](request),
    'helpfill:setupRead': async (request) => requireApi()['helpfill:setupRead'](request),
    'topics:createTopics': async (request) => requireApi()['topics:createTopics'](request),
    'engines:get': async (request) => requireApi()['engines:get'](request),
    'engines:set': async (request) => requireApi()['engines:set'](request),
    'engines:estimate': async (request) => requireApi()['engines:estimate'](request),
    'schedule:updateProject': async (request) => requireApi()['schedule:updateProject'](request)
  }
}
