import type {
  AddQuestionsRequest,
  AddQuestionsResult,
  CompetitorChangeResult,
  CompetitorsList,
  CompetitorsOverview,
  CompetitorsOverviewRequest,
  CompetitorsSortSitesRequest,
  CompetitorsProjectRequest,
  CompetitorsSortSitesResult,
  MergeCompetitorsRequest,
  ProjectIdRequest,
  QuestionTargets,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest,
  SetSiteKindRequest,
  SetSiteKindResult,
  SetSiteTypeRequest,
  SetSiteTypeResult
} from '@shared/ipc'
import type { ProjectSearches } from '@shared/page-fixes'
import type { SiteTypeSettings } from '@shared/site-overrides'

/**
 * One method per channel the Competitors screen uses. Production uses the preload
 * allow-list (`window.citefox`); tests pass a fake. Competitors are added, edited,
 * merged and removed through the `competitors:*` channels, each change with an undo
 * token; the gap drawer adds its questions to a topic (`prompts:addQuestions`). A site's
 * type is the user's choice per domain (`competitors:siteTypes` / `setSiteType`), shared
 * with every sources list.
 */
export interface CompetitorsSource {
  'competitors:overview'(request: CompetitorsOverviewRequest): Promise<CompetitorsOverview>
  'competitors:sortSites'(request: CompetitorsSortSitesRequest): Promise<CompetitorsSortSitesResult>
  'competitors:list'(request: CompetitorsProjectRequest): Promise<CompetitorsList>
  'competitors:save'(request: SaveCompetitorRequest): Promise<CompetitorChangeResult>
  'competitors:remove'(request: RemoveCompetitorsRequest): Promise<CompetitorChangeResult>
  'competitors:merge'(request: MergeCompetitorsRequest): Promise<CompetitorChangeResult>
  'competitors:restore'(request: RestoreCompetitorsRequest): Promise<CompetitorsList>
  'competitors:setSiteKind'(request: SetSiteKindRequest): Promise<SetSiteKindResult>
  'competitors:siteTypes'(request: CompetitorsProjectRequest): Promise<SiteTypeSettings>
  'competitors:setSiteType'(request: SetSiteTypeRequest): Promise<SetSiteTypeResult>
  'prompts:addTargets'(request: ProjectIdRequest): Promise<QuestionTargets>
  'prompts:addQuestions'(request: AddQuestionsRequest): Promise<AddQuestionsResult>
  /** What to fix's searches: your result and win odds in a site's drawer. Saved checks only. */
  'fixes:searches'(request: ProjectIdRequest): Promise<ProjectSearches>
}

export function createCompetitorsSource(): CompetitorsSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'competitors:overview': async (request) => requireApi()['competitors:overview'](request),
    'competitors:sortSites': async (request) => requireApi()['competitors:sortSites'](request),
    'competitors:list': async (request) => requireApi()['competitors:list'](request),
    'competitors:save': async (request) => requireApi()['competitors:save'](request),
    'competitors:remove': async (request) => requireApi()['competitors:remove'](request),
    'competitors:merge': async (request) => requireApi()['competitors:merge'](request),
    'competitors:restore': async (request) => requireApi()['competitors:restore'](request),
    'competitors:setSiteKind': async (request) => requireApi()['competitors:setSiteKind'](request),
    'competitors:siteTypes': async (request) => requireApi()['competitors:siteTypes'](request),
    'competitors:setSiteType': async (request) => requireApi()['competitors:setSiteType'](request),
    'prompts:addTargets': async (request) => requireApi()['prompts:addTargets'](request),
    'prompts:addQuestions': async (request) => requireApi()['prompts:addQuestions'](request),
    'fixes:searches': async (request) => requireApi()['fixes:searches'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
