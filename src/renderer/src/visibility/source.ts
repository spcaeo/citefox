import type { PageResults, PageScoreList, ProjectScoreList, ResultsHistory } from '@shared/domain'
import type { GetResultsRequest, ProjectIdRequest, ResultsHistoryRequest } from '@shared/ipc'

/**
 * One method per existing channel. Request and result types are the shared
 * contract, with no chart shaping at this boundary.
 * Production always uses the preload allow-list (`window.citefox`).
 * Tests and the Vite harness pass another `VisibilitySource`.
 */
export interface VisibilitySource {
  'results:get'(request: GetResultsRequest): Promise<PageResults>
  'results:history'(request: ResultsHistoryRequest): Promise<ResultsHistory>
  'scores:listProjects'(): Promise<ProjectScoreList>
  'scores:listPages'(request: ProjectIdRequest): Promise<PageScoreList>
}

export function createVisibilitySource(): VisibilitySource {
  return {
    'results:get': (request) => requireApi()['results:get'](request),
    'results:history': (request) => requireApi()['results:history'](request),
    'scores:listProjects': () => requireApi()['scores:listProjects'](),
    'scores:listPages': (request) => requireApi()['scores:listPages'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
