import type {
  AssistProgress,
  CheckFinishedNotice,
  CheckProgress,
  ExportProgress,
  PageReadProgress,
  SetupProgress,
  StartProgress,
  TopicProgress
} from '@shared/ipc'
import { subscribeAssistProgress } from '../assist/progress'

/** What the console listens to and the few things it can do (retry, stop). Tests pass a fake. */
export interface ConsoleClient {
  onCheckProgress(listener: (event: CheckProgress) => void): () => void
  onCheckFinished(listener: (event: CheckFinishedNotice) => void): () => void
  onPageRead(listener: (event: PageReadProgress) => void): () => void
  onAssist(listener: (event: AssistProgress) => void): () => void
  onTopic(listener: (event: TopicProgress) => void): () => void
  onSetup(listener: (event: SetupProgress) => void): () => void
  onStart(listener: (event: StartProgress) => void): () => void
  onExport(listener: (event: ExportProgress) => void): () => void
  retryCheck(projectId: string, pageId: string): Promise<void>
  retrySetup(pageId: string): Promise<void>
  cancelCheck(jobId: string): Promise<void>
  stopStart(projectId: string): Promise<void>
}

type Bridge = Window['citefox']

const none = (): (() => void) => () => undefined

function bridge(): Bridge | null {
  return typeof window !== 'undefined' && window.citefox ? window.citefox : null
}

/** Subscribes only when the bridge and the channel exist (the Vite harness has none). */
function listen<K extends keyof Bridge>(channel: K, listener: (event: never) => void): () => void {
  const api = bridge()
  const subscribe = api?.[channel] as unknown
  if (typeof subscribe !== 'function') return none()
  try {
    return (subscribe as (listener: (event: never) => void) => () => void)(listener)
  } catch {
    return none()
  }
}

function call(run: (api: Bridge) => Promise<unknown>): Promise<void> {
  const api = bridge()
  if (api === null) return Promise.reject(new Error('The preload bridge is missing.'))
  return run(api).then(() => undefined)
}

export function createIpcConsoleClient(): ConsoleClient {
  return {
    onCheckProgress: (listener) => listen('checks:progress', listener),
    onCheckFinished: (listener) => listen('checks:finished', listener),
    onPageRead: (listener) => listen('pages:readProgress', listener),
    // One shared bridge listener feeds every AI panel and the console (assist/progress.ts).
    onAssist: (listener) => subscribeAssistProgress(listener),
    onTopic: (listener) => listen('topics:progress', listener),
    onSetup: (listener) => listen('setup:progress', listener),
    onStart: (listener) => listen('start:changed', listener),
    onExport: (listener) => listen('exports:progress', listener),
    retryCheck: (projectId, pageId) =>
      call((api) =>
        api['checks:start']({ projectId, pageIds: [pageId], marketIds: null, promptIds: null })
      ),
    retrySetup: (pageId) => call((api) => api['setup:retry']({ pageIds: [pageId] })),
    cancelCheck: (jobId) => call((api) => api['checks:cancel']({ jobId })),
    stopStart: (projectId) => call((api) => api['start:stop']({ projectId }))
  }
}
