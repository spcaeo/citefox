import type {
  NoticeList,
  PageList,
  ProjectIdRequest,
  ProjectList,
  ResolveNoticeRequest,
  ResolveNoticeResult,
  SetupPauseRequest,
  SetupProgress,
  SetupRateRequest,
  SetupRetryRequest,
  SetupStatus
} from '@shared/ipc'

/**
 * The live channels the status capsule, its popover and the Status screen
 * share: "ask me" notices (FR-11.4, FR-11.7) and background page setup
 * (FR-20.6). Tests pass another `LiveSource`.
 */
export interface LiveSource {
  'notices:list'(): Promise<NoticeList>
  'notices:resolve'(request: ResolveNoticeRequest): Promise<ResolveNoticeResult>
  'notices:changed'(listener: (payload: NoticeList) => void): () => void
  'setup:status'(): Promise<SetupStatus>
  'setup:retry'(request: SetupRetryRequest): Promise<SetupStatus>
  'setup:pause'(request: SetupPauseRequest): Promise<SetupStatus>
  'setup:setRate'(request: SetupRateRequest): Promise<SetupStatus>
  'setup:progress'(listener: (payload: SetupProgress) => void): () => void
  /** For the setup drill-downs: the pages still setting up in each project. */
  'pages:list'(request: ProjectIdRequest): Promise<PageList>
  'projects:list'(): Promise<ProjectList>
}

const CHANNELS = [
  'notices:list',
  'notices:resolve',
  'notices:changed',
  'setup:status',
  'setup:retry',
  'setup:pause',
  'setup:setRate',
  'setup:progress',
  'pages:list',
  'projects:list'
] as const

/**
 * The preload bridge as a `LiveSource`, or null when the bridge (or one of
 * these channels) is missing, such as in a unit test of another screen. The
 * capsule then shows no badge instead of failing.
 */
export function createLiveSource(): LiveSource | null {
  if (typeof window === 'undefined' || !window.citefox) return null
  const api = window.citefox
  const bridge = api as unknown as Readonly<Record<string, unknown>>
  if (!CHANNELS.every((channel) => typeof bridge[channel] === 'function')) return null
  return {
    'notices:list': () => api['notices:list'](),
    'notices:resolve': (request) => api['notices:resolve'](request),
    'notices:changed': (listener) => api['notices:changed'](listener),
    'setup:status': () => api['setup:status'](),
    'setup:retry': (request) => api['setup:retry'](request),
    'setup:pause': (request) => api['setup:pause'](request),
    'setup:setRate': (request) => api['setup:setRate'](request),
    'setup:progress': (listener) => api['setup:progress'](listener),
    'pages:list': (request) => api['pages:list'](request),
    'projects:list': () => api['projects:list']()
  }
}
