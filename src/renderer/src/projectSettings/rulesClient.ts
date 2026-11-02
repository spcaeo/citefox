import type {
  ProjectIdRequest,
  ProjectRuleIdRequest,
  ProjectRuleList,
  SaveProjectRuleRequest
} from '@shared/ipc'

/** Project settings › Project rules channels. Production uses the preload bridge; tests pass a fake. */
export interface ProjectRulesSource {
  'projectRules:list'(request: ProjectIdRequest): Promise<ProjectRuleList>
  'projectRules:save'(request: SaveProjectRuleRequest): Promise<ProjectRuleList>
  'projectRules:delete'(request: ProjectRuleIdRequest): Promise<ProjectRuleList>
}

export function createProjectRulesSource(): ProjectRulesSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'projectRules:list': async (request) => requireApi()['projectRules:list'](request),
    'projectRules:save': async (request) => requireApi()['projectRules:save'](request),
    'projectRules:delete': async (request) => requireApi()['projectRules:delete'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
