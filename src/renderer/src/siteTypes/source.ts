import type {
  CompetitorsProjectRequest,
  RemoveSiteTypeDefRequest,
  RemoveSiteTypeDefResult,
  SaveSiteTypeDefRequest,
  SetSiteTypeRequest,
  SetSiteTypeResult
} from '@shared/ipc'
import type { CustomSiteType, SiteTypeSettings } from '@shared/site-overrides'

/**
 * The channels of the project's types of site (migration 048): the user's type and
 * role per domain, and the project's own types. Production uses the preload
 * allow-list (`window.citefox`); tests pass a fake.
 */
export interface SiteTypesSource {
  'competitors:siteTypes'(request: CompetitorsProjectRequest): Promise<SiteTypeSettings>
  'competitors:setSiteType'(request: SetSiteTypeRequest): Promise<SetSiteTypeResult>
  'competitors:saveSiteTypeDef'(request: SaveSiteTypeDefRequest): Promise<CustomSiteType>
  'competitors:removeSiteTypeDef'(
    request: RemoveSiteTypeDefRequest
  ): Promise<RemoveSiteTypeDefResult>
}

export function createSiteTypesSource(): SiteTypesSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'competitors:siteTypes': async (request) => requireApi()['competitors:siteTypes'](request),
    'competitors:setSiteType': async (request) => requireApi()['competitors:setSiteType'](request),
    'competitors:saveSiteTypeDef': async (request) =>
      requireApi()['competitors:saveSiteTypeDef'](request),
    'competitors:removeSiteTypeDef': async (request) =>
      requireApi()['competitors:removeSiteTypeDef'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
