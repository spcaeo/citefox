import type { FixList, FixPlanPreview, LoggedFix, PromptSetView } from '@shared/domain'
import type {
  CreateFixRequest,
  FixIdRequest,
  FixPreviewRequest,
  PageIdRequest,
  ProjectFixList,
  ProjectIdRequest,
  QuestionTargets,
  RunFollowUpResult,
  UpdateFixRequest
} from '@shared/ipc'

/**
 * One method per channel the fix drawer uses. Production uses the preload allow-list
 * (`window.citefox`); tests pass a fake.
 */
export interface FixDrawerSource {
  'fixes:listProject'(request: ProjectIdRequest): Promise<ProjectFixList>
  'fixes:preview'(request: FixPreviewRequest): Promise<FixPlanPreview>
  'fixes:create'(request: CreateFixRequest): Promise<LoggedFix>
  'fixes:update'(request: UpdateFixRequest): Promise<LoggedFix>
  'fixes:delete'(request: FixIdRequest): Promise<FixList>
  'fixes:restore'(request: FixIdRequest): Promise<LoggedFix>
  'fixes:runFollowUp'(request: FixIdRequest): Promise<RunFollowUpResult>
  'prompts:addTargets'(request: ProjectIdRequest): Promise<QuestionTargets>
  'prompts:list'(request: PageIdRequest): Promise<PromptSetView>
}

export function createFixDrawerSource(): FixDrawerSource {
  return {
    // Async so a missing bridge rejects the promise instead of throwing during render.
    'fixes:listProject': async (request) => requireApi()['fixes:listProject'](request),
    'fixes:preview': async (request) => requireApi()['fixes:preview'](request),
    'fixes:create': async (request) => requireApi()['fixes:create'](request),
    'fixes:update': async (request) => requireApi()['fixes:update'](request),
    'fixes:delete': async (request) => requireApi()['fixes:delete'](request),
    'fixes:restore': async (request) => requireApi()['fixes:restore'](request),
    'fixes:runFollowUp': async (request) => requireApi()['fixes:runFollowUp'](request),
    'prompts:addTargets': async (request) => requireApi()['prompts:addTargets'](request),
    'prompts:list': async (request) => requireApi()['prompts:list'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
