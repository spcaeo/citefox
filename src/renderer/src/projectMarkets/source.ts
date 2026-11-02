import type {
  AddProjectMarketRequest,
  AddProjectMarketResult,
  PageDetail,
  ProjectIdRequest,
  ProjectMarketsView,
  RemoveProjectMarketRequest,
  RemoveProjectMarketResult,
  RestoreProjectMarketRequest,
  SetDefaultProjectMarketRequest,
  SetDefaultProjectMarketResult,
  UpdatePageRequest
} from '@shared/ipc'

/**
 * The channels Project settings › Markets and the Add market drawer use.
 * Production uses the preload allow-list; tests pass a fake.
 */
export interface ProjectMarketsSource {
  'projectSettings:markets'(request: ProjectIdRequest): Promise<ProjectMarketsView>
  'projectSettings:addMarket'(request: AddProjectMarketRequest): Promise<AddProjectMarketResult>
  'projectSettings:removeMarket'(
    request: RemoveProjectMarketRequest
  ): Promise<RemoveProjectMarketResult>
  'projectSettings:restoreMarket'(request: RestoreProjectMarketRequest): Promise<ProjectMarketsView>
  'projectSettings:setDefaultMarket'(
    request: SetDefaultProjectMarketRequest
  ): Promise<SetDefaultProjectMarketResult>
  'pages:update'(request: UpdatePageRequest): Promise<PageDetail>
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

export function createProjectMarketsSource(): ProjectMarketsSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'projectSettings:markets': async (request) => requireApi()['projectSettings:markets'](request),
    'projectSettings:addMarket': async (request) =>
      requireApi()['projectSettings:addMarket'](request),
    'projectSettings:removeMarket': async (request) =>
      requireApi()['projectSettings:removeMarket'](request),
    'projectSettings:restoreMarket': async (request) =>
      requireApi()['projectSettings:restoreMarket'](request),
    'projectSettings:setDefaultMarket': async (request) =>
      requireApi()['projectSettings:setDefaultMarket'](request),
    'pages:update': async (request) => requireApi()['pages:update'](request)
  }
}
