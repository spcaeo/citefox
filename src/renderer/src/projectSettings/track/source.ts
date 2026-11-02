import type {
  EngineEstimate,
  EngineEstimateRequest,
  EnginesProjectRequest,
  EngineSummaryRequest,
  EngineSummaryView,
  PageEnginesRequest,
  PageEnginesView,
  ProjectEnginesView,
  SetPageEnginesRequest,
  SetProjectEnginesRequest
} from '@shared/ipc'

/**
 * The engines channels "What to track" and a topic's own engines use. Production
 * uses the preload bridge; tests pass a fake.
 */
export interface EnginesSettingsSource {
  'engines:get'(request: EnginesProjectRequest): Promise<ProjectEnginesView>
  'engines:set'(request: SetProjectEnginesRequest): Promise<ProjectEnginesView>
  'engines:estimate'(request: EngineEstimateRequest): Promise<EngineEstimate>
  'engines:summary'(request: EngineSummaryRequest): Promise<EngineSummaryView>
}

/** A page's or topic's own engines (the topic settings drawer). */
export interface PageEnginesSource {
  'engines:page'(request: PageEnginesRequest): Promise<PageEnginesView>
  'engines:setPage'(request: SetPageEnginesRequest): Promise<PageEnginesView>
  'engines:get'(request: EnginesProjectRequest): Promise<ProjectEnginesView>
  'engines:estimate'(request: EngineEstimateRequest): Promise<EngineEstimate>
}

export function createEnginesSettingsSource(): EnginesSettingsSource & PageEnginesSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'engines:get': async (request) => requireApi()['engines:get'](request),
    'engines:set': async (request) => requireApi()['engines:set'](request),
    'engines:estimate': async (request) => requireApi()['engines:estimate'](request),
    'engines:summary': async (request) => requireApi()['engines:summary'](request),
    'engines:page': async (request) => requireApi()['engines:page'](request),
    'engines:setPage': async (request) => requireApi()['engines:setPage'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
