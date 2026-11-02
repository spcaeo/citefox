import type { FixList, FixPlanPreview, LoggedFix, PromptSetView } from '@shared/domain'
import type {
  CreateFixRequest,
  FixIdRequest,
  FixListRequest,
  FixPreviewRequest,
  PageIdRequest,
  RunFollowUpResult
} from '@shared/ipc'

/**
 * One method per channel the Fixes section uses. Production uses the preload
 * allow-list (`window.citefox`); tests and the harness pass a fake.
 */
export interface FixesSource {
  'fixes:list'(request: FixListRequest): Promise<FixList>
  'fixes:preview'(request: FixPreviewRequest): Promise<FixPlanPreview>
  'fixes:create'(request: CreateFixRequest): Promise<LoggedFix>
  'fixes:runFollowUp'(request: FixIdRequest): Promise<RunFollowUpResult>
  'fixes:delete'(request: FixIdRequest): Promise<FixList>
  'prompts:list'(request: PageIdRequest): Promise<PromptSetView>
}

export function createFixesSource(): FixesSource {
  return {
    'fixes:list': (request) => requireApi()['fixes:list'](request),
    'fixes:preview': (request) => requireApi()['fixes:preview'](request),
    'fixes:create': (request) => requireApi()['fixes:create'](request),
    'fixes:runFollowUp': (request) => requireApi()['fixes:runFollowUp'](request),
    'fixes:delete': (request) => requireApi()['fixes:delete'](request),
    'prompts:list': (request) => requireApi()['prompts:list'](request)
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** For harness pages with no preload bridge: no fixes, nothing saved. */
export function offlineFixesSource(): FixesSource {
  const unavailable = (): Promise<never> =>
    Promise.reject(new Error('Fixes need the CiteFox app window.'))
  return {
    'fixes:list': (request) =>
      Promise.resolve({ pageId: request.pageId, fixes: [], nextFixNumber: 1 }),
    'fixes:preview': unavailable,
    'fixes:create': unavailable,
    'fixes:runFollowUp': unavailable,
    'fixes:delete': unavailable,
    'prompts:list': unavailable
  }
}
