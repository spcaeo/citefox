import type {
  CheckJob,
  CheckProgress,
  PromptIdRequest,
  PromptVersions,
  RewordPromptRequest,
  RewordPromptResult,
  StartCheckRequest,
  StatusCapsule
} from '@shared/ipc'

/**
 * The channels "Edit question" and "Re-check now" use on Prompt detail: save the
 * wording as a new version, read the prompt's earlier versions, start a check of
 * one prompt and follow its progress, and the searches left for the cost line.
 * Production uses the preload allow-list; tests pass another `PromptEditSource`.
 */
export interface PromptEditSource {
  'prompts:reword'(request: RewordPromptRequest): Promise<RewordPromptResult>
  'prompts:versions'(request: PromptIdRequest): Promise<PromptVersions>
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'checks:progress'(listener: (payload: CheckProgress) => void): () => void
  'status:getCapsule'(): Promise<StatusCapsule>
}

export function createPromptEditSource(): PromptEditSource {
  return {
    'prompts:reword': (request) => requireApi()['prompts:reword'](request),
    'prompts:versions': (request) => requireApi()['prompts:versions'](request),
    'checks:start': (request) => requireApi()['checks:start'](request),
    'checks:progress': (listener) => {
      // No bridge (a test without a fake): nothing to follow.
      if (typeof window === 'undefined' || !window.citefox) return () => undefined
      return window.citefox['checks:progress'](listener)
    },
    'status:getCapsule': () => requireApi()['status:getCapsule']()
  }
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
