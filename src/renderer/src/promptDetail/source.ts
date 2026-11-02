import type { SiteTypeSettings } from '@shared/site-overrides'
import type { PageResults, PromptCheckDetail, ResultsHistory, TopicSummary } from '@shared/domain'
import type {
  CompetitorChangeResult,
  CompetitorsList,
  CompetitorsProjectRequest,
  GetPromptCheckRequest,
  QuestionEnginesRequest,
  QuestionEnginesView,
  GetResultsRequest,
  PageDetail,
  PageIdRequest,
  ResultsHistoryRequest,
  RemoveCompetitorsRequest,
  RestoreCompetitorsRequest,
  SaveCompetitorRequest,
  SetSiteTypeRequest,
  SetSiteTypeResult,
  TopicResults,
  TopicResultsRequest,
  UpdateTopicRequest
} from '@shared/ipc'

/**
 * The existing channels Prompt detail reads (FR-13). Request and result types
 * are the shared contract. Production uses the preload allow-list
 * (`window.citefox`); tests pass another `PromptDetailSource`.
 */
export interface PromptDetailSource {
  'pages:get'(request: PageIdRequest): Promise<PageDetail>
  'results:get'(request: GetResultsRequest): Promise<PageResults>
  'results:history'(request: ResultsHistoryRequest): Promise<ResultsHistory>
  'checks:getPrompt'(request: GetPromptCheckRequest): Promise<PromptCheckDetail>
  /** The question's answer on each engine, for the engine tabs. Absent: Google only. */
  'engines:question'?: (request: QuestionEnginesRequest) => Promise<QuestionEnginesView>
  /**
   * The sources' quick actions: saved competitors to match, Mark as competitor (with
   * Undo), and a topic's target page. Absent: the sources show no such actions.
   */
  'competitors:list'?: (request: CompetitorsProjectRequest) => Promise<CompetitorsList>
  'competitors:save'?: (request: SaveCompetitorRequest) => Promise<CompetitorChangeResult>
  'competitors:remove'?: (request: RemoveCompetitorsRequest) => Promise<CompetitorChangeResult>
  'competitors:restore'?: (request: RestoreCompetitorsRequest) => Promise<CompetitorsList>
  /**
   * The user's type of site and role per domain (the Type and Who it is menus). Absent:
   * the cells are read-only.
   */
  'competitors:siteTypes'?: (request: CompetitorsProjectRequest) => Promise<SiteTypeSettings>
  'competitors:setSiteType'?: (request: SetSiteTypeRequest) => Promise<SetSiteTypeResult>
  'topics:results'?: (request: TopicResultsRequest) => Promise<TopicResults>
  'topics:update'?: (request: UpdateTopicRequest) => Promise<TopicSummary>
}

export function createPromptDetailSource(): PromptDetailSource {
  return {
    'pages:get': (request) => requireApi()['pages:get'](request),
    'results:get': (request) => requireApi()['results:get'](request),
    'results:history': (request) => requireApi()['results:history'](request),
    'checks:getPrompt': (request) => requireApi()['checks:getPrompt'](request),
    'engines:question': (request) => requireApi()['engines:question'](request),
    'competitors:list': async (request) => requireApi()['competitors:list'](request),
    'competitors:save': async (request) => requireApi()['competitors:save'](request),
    'competitors:remove': async (request) => requireApi()['competitors:remove'](request),
    'competitors:restore': async (request) => requireApi()['competitors:restore'](request),
    'competitors:siteTypes': async (request) => requireApi()['competitors:siteTypes'](request),
    'competitors:setSiteType': async (request) => requireApi()['competitors:setSiteType'](request),
    'topics:results': async (request) => requireApi()['topics:results'](request),
    'topics:update': async (request) => requireApi()['topics:update'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
