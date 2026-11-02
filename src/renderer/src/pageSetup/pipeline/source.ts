import type {
  PageDetail,
  PagePipeline,
  PagePipelineStep,
  SetupCheckWhenReadyRequest,
  SetupPageRequest,
  SetupProgress
} from '@shared/ipc'
import { currentClientMode } from '../../onboarding/flags'

/**
 * One page's automatic setup (owner feedback 5): `setup:page`, `setup:start`,
 * `setup:stop`, `setup:checkWhenReady` and the `setup:progress` push. Tests
 * pass another `PipelineSource`.
 */
export interface PipelineSource {
  page(request: SetupPageRequest): Promise<PagePipeline>
  start(request: SetupPageRequest): Promise<PagePipeline>
  stop(request: SetupPageRequest): Promise<PagePipeline>
  checkWhenReady(request: SetupCheckWhenReadyRequest): Promise<{ checkWhenReady: boolean }>
  onProgress(listener: (progress: SetupProgress) => void): () => void
}

const CHANNELS = [
  'setup:page',
  'setup:start',
  'setup:stop',
  'setup:checkWhenReady',
  'setup:progress'
] as const

/**
 * The preload bridge, or null in the in-memory mock (whose pages live in the
 * renderer) and when the bridge lacks these channels. The tabs then read the
 * page's own setup step through {@link derivedPipeline}.
 */
export function createPipelineSource(): PipelineSource | null {
  if (currentClientMode() === 'mock') return null
  if (typeof window === 'undefined' || !window.citefox) return null
  const api = window.citefox
  const bridge = api as unknown as Readonly<Record<string, unknown>>
  if (!CHANNELS.every((channel) => typeof bridge[channel] === 'function')) return null
  return {
    page: (request) => api['setup:page'](request),
    start: (request) => api['setup:start'](request),
    stop: (request) => api['setup:stop'](request),
    checkWhenReady: (request) => api['setup:checkWhenReady'](request),
    onProgress: (listener) => api['setup:progress'](listener)
  }
}

const LABELS: Readonly<Record<PagePipelineStep['id'], string>> = {
  read: 'Read page',
  profile: 'Buyer profile',
  prompts: 'Questions',
  coverage: 'Content gaps',
  ready: 'Ready'
}

/**
 * The page's setup from its own fields, for the mock and for a bridge without
 * the setup channels: steps already stored are done, the rest wait.
 */
export function derivedPipeline(page: PageDetail, prompts: number | null = null): PagePipeline {
  const order = ['read', 'profile', 'prompts', 'check'] as const
  const at = page.setupStep === null ? order.length : order.indexOf(page.setupStep)
  const done = (index: number): boolean => at > index
  const coreDone = done(2) || page.promptSetVersion !== null
  const checked = page.score !== null
  const count = prompts ?? page.promptCount
  const markets = Math.max(1, page.markets.length)
  const steps: PagePipelineStep[] = [
    step('read', done(0)),
    step('profile', done(1)),
    step('prompts', coreDone),
    step('coverage', coreDone),
    step('ready', coreDone)
  ]
  return {
    projectId: page.projectId,
    pageId: page.id,
    state: coreDone ? (checked ? 'checked' : 'ready') : 'queued',
    message: coreDone
      ? 'Set up. Review the questions, then start the first check when you are ready.'
      : 'Waiting to start. CiteFox sets this page up by itself, without searches.',
    steps,
    startedAt: null,
    finishedAt: null,
    retryAt: null,
    attempts: 0,
    error: null,
    action: null,
    prompts: count,
    markets,
    samples: page.samples,
    searchesMin: count * markets * page.samples,
    searchesMax: count * markets * page.samples * 2,
    firstCheckWaits: !checked,
    checkWhenReady: false,
    checkAsked: false
  }
}

function step(id: PagePipelineStep['id'], isDone: boolean): PagePipelineStep {
  return { id, label: LABELS[id], state: isDone ? 'done' : 'todo', detail: null }
}
