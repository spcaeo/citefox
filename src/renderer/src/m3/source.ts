import type { PageResults, PromptSetView } from '@shared/domain'
import type {
  ActiveJobsRequest,
  CheckFinishedNotice,
  CheckJob,
  CheckJobIdRequest,
  CheckProgress,
  GetResultsRequest,
  PageIdRequest,
  StartCheckRequest
} from '@shared/ipc'
import { errorText } from '../components/errorText'

/**
 * One method per existing channel. Request and result types are the shared
 * contract. Production uses the preload allow-list (`window.citefox`).
 * Tests pass another `CheckSource`.
 */
export interface CheckSource {
  'checks:start'(request: StartCheckRequest): Promise<CheckJob>
  'checks:listActive'(request: ActiveJobsRequest): Promise<readonly CheckJob[]>
  'checks:get'(request: CheckJobIdRequest): Promise<CheckJob | null>
  'checks:cancel'(request: CheckJobIdRequest): Promise<CheckJob>
  'checks:progress'(listener: (payload: CheckProgress) => void): () => void
  'checks:finished'(listener: (payload: CheckFinishedNotice) => void): () => void
  'results:get'(request: GetResultsRequest): Promise<PageResults>
  /** Saved buyer prompts. The check job does not list prompts that have no step yet. */
  'prompts:list'(request: PageIdRequest): Promise<PromptSetView>
}

export function createCheckSource(): CheckSource {
  return {
    'checks:start': (request) => requireApi()['checks:start'](request),
    'checks:listActive': (request) => requireApi()['checks:listActive'](request),
    'checks:get': (request) => requireApi()['checks:get'](request),
    'checks:cancel': (request) => requireApi()['checks:cancel'](request),
    'checks:progress': (listener) => requireApi()['checks:progress'](listener),
    'checks:finished': (listener) => requireApi()['checks:finished'](listener),
    'results:get': (request) => requireApi()['results:get'](request),
    'prompts:list': (request) => requireApi()['prompts:list'](request)
  }
}

/**
 * First check for one page: every market, every enabled buyer prompt.
 * `pageIds` is the shared non-empty tuple. The engine picks baseline vs manual.
 */
export function startCheckRequest(projectId: string, pageId: string): StartCheckRequest {
  return {
    projectId,
    pageIds: [pageId],
    marketIds: null,
    promptIds: null
  }
}

/** The running job that includes this page. `checks:listActive` is already running-only. */
export function jobForPage(jobs: readonly CheckJob[], pageId: string): CheckJob | null {
  return jobs.find((job) => job.status === 'running' && job.pageIds.includes(pageId)) ?? null
}

/** Plain text for a rejected check call. Strips Electron's invoke wrapper. */
export function checkError(cause: unknown, fallback: string): string {
  return errorText(cause, fallback)
}

/**
 * `checks:start` returns a job even when it refuses to run (no prompts, no key,
 * cap reached). `message` is the error sentence. `nextStep` is the recovery.
 */
export function checkStartMessage(job: CheckJob): string {
  const message = job.message?.trim() ?? ''
  const nextStep = job.nextStep?.trim() ?? ''
  if (message.length > 0 && nextStep.length > 0) return `${message} ${nextStep}`
  if (message.length > 0) return message
  if (nextStep.length > 0) return nextStep
  if (job.status === 'cancelled') return 'The check was cancelled.'
  return 'Could not start the check.'
}

function requireApi(): Window['citefox'] {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}
