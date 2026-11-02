import type {
  ActiveJobsRequest,
  CheckFinishedNotice,
  CheckJob,
  CheckJobIdRequest,
  CheckProgress,
  ProjectIdRequest,
  SetupProgress,
  SiteStartPlan,
  StartBeginRequest,
  StartBeginResult,
  StartEditList,
  StartEditRequest,
  StartEditResult,
  StartSuggestUrlsRequest,
  StartUndoRequest,
  StartUrlSuggestions,
  StartHomeworkRequest,
  StartJourney,
  StartProgress,
  TopicProgress,
  TopicResults,
  TopicResultsRequest
} from '@shared/ipc'

/** The first-run journey calls (owner feedback 4). Tests pass a fake. */
export interface StartClient {
  homework(request: StartHomeworkRequest): Promise<SiteStartPlan>
  get(request: ProjectIdRequest): Promise<SiteStartPlan | null>
  progress(request: ProjectIdRequest): Promise<StartProgress | null>
  stop(request: ProjectIdRequest): Promise<StartProgress | null>
  begin(request: StartBeginRequest): Promise<StartBeginResult>
  status(request: ProjectIdRequest): Promise<StartJourney>
  topicResults(request: TopicResultsRequest): Promise<TopicResults>
  activeJobs(request: ActiveJobsRequest): Promise<readonly CheckJob[]>
  cancelJob(request: CheckJobIdRequest): Promise<CheckJob>
  edit(request: StartEditRequest): Promise<StartEditResult>
  undo(request: StartUndoRequest): Promise<StartEditResult>
  edits(request: ProjectIdRequest): Promise<StartEditList>
  suggestUrls(request: StartSuggestUrlsRequest): Promise<StartUrlSuggestions>
  onChanged(listener: (progress: StartProgress) => void): () => void
  onCheckProgress(listener: (progress: CheckProgress) => void): () => void
  onCheckFinished(listener: (notice: CheckFinishedNotice) => void): () => void
  onSetupProgress(listener: (progress: SetupProgress) => void): () => void
  onTopicProgress(listener: (progress: TopicProgress) => void): () => void
}

const noop = (): (() => void) => () => undefined

function api(): NonNullable<Window['citefox']> {
  if (typeof window === 'undefined' || !window.citefox) {
    throw new Error('The preload bridge is missing.')
  }
  return window.citefox
}

/** Listens only when the bridge exists (the Vite harness pages have none). */
function listen(subscribe: (bridge: NonNullable<Window['citefox']>) => () => void): () => void {
  if (typeof window === 'undefined' || !window.citefox) return noop()
  return subscribe(window.citefox)
}

export function createIpcStartClient(): StartClient {
  return {
    homework: (request) => Promise.resolve().then(() => api()['start:homework'](request)),
    get: (request) => Promise.resolve().then(() => api()['start:get'](request)),
    progress: (request) => Promise.resolve().then(() => api()['start:progress'](request)),
    stop: (request) => Promise.resolve().then(() => api()['start:stop'](request)),
    begin: (request) => Promise.resolve().then(() => api()['start:begin'](request)),
    status: (request) => Promise.resolve().then(() => api()['start:status'](request)),
    topicResults: (request) => Promise.resolve().then(() => api()['topics:results'](request)),
    activeJobs: (request) => Promise.resolve().then(() => api()['checks:listActive'](request)),
    cancelJob: (request) => Promise.resolve().then(() => api()['checks:cancel'](request)),
    edit: (request) => Promise.resolve().then(() => api()['start:edit'](request)),
    undo: (request) => Promise.resolve().then(() => api()['start:undo'](request)),
    edits: (request) => Promise.resolve().then(() => api()['start:edits'](request)),
    suggestUrls: (request) => Promise.resolve().then(() => api()['start:suggestUrls'](request)),
    onChanged: (listener) => listen((bridge) => bridge['start:changed'](listener)),
    onCheckProgress: (listener) => listen((bridge) => bridge['checks:progress'](listener)),
    onCheckFinished: (listener) => listen((bridge) => bridge['checks:finished'](listener)),
    onSetupProgress: (listener) => listen((bridge) => bridge['setup:progress'](listener)),
    onTopicProgress: (listener) => listen((bridge) => bridge['topics:progress'](listener))
  }
}

let shared: StartClient | null = null

/** One client per window. */
export function startClient(): StartClient {
  shared ??= createIpcStartClient()
  return shared
}
