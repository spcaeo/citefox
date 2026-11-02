import type {
  PagePipeline,
  PagePipelineAction,
  PagePipelineState,
  PagePipelineStep,
  PagePipelineStepId,
  PagePipelineStepState,
  SetupRunStep
} from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { SqliteDatabase } from '../storage/database'
import { getLatestCoverage } from '../storage/coverage-records'
import {
  firstCheckWaits,
  pageCheckWhenReady,
  readCheckWhenReady
} from '../storage/first-check-waits'
import type { PageSetupJob } from '../storage/page-setup-jobs'
import { getPage, listPageMarkets } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import { getLatestPromptSet } from '../storage/prompt-set-records'
import { getLatestBuyerProfile, getLatestSnapshot } from '../storage/snapshot-records'

/** Stored on a job the user stopped (`setup:stop`); Resume clears it. */
export const STOPPED_BY_USER = 'Stopped by you.'

const STEP_LABEL: Readonly<Record<PagePipelineStepId, string>> = {
  read: 'Read page',
  profile: 'Buyer profile',
  prompts: 'Prompts',
  coverage: 'Content gaps',
  ready: 'Ready'
}

const RUN_STEPS: readonly SetupRunStep[] = ['read', 'profile', 'prompts', 'coverage']

/** What only the runner knows about a page right now. */
export interface PipelineRuntime {
  /** A step is in flight in this process. */
  running: boolean
  /** The background runner loop is on (off in tests and when CITEFOX_SETUP_RUNNER=off). */
  looping: boolean
  /** Every page's setup is paused (Status screen). */
  paused: boolean
  /** Why the project is held (a Claude limit, no connection), or null. */
  hold: { reason: string; connection: boolean } | null
}

/**
 * One page's setup for the page tabs, from what is stored plus the runner's
 * runtime state. Never throws for a page that exists; returns null when it does not.
 */
export function buildPagePipeline(
  db: SqliteDatabase,
  projectId: string,
  pageId: string,
  job: PageSetupJob | null,
  runtime: PipelineRuntime
): PagePipeline | null {
  const page = getPage(db, pageId, projectId)
  if (page === null || page.status === 'removed') return null
  const brands = readProjectProfile(db)?.brandNames ?? []
  const snapshot = getLatestSnapshot(db, pageId)
  const profile = getLatestBuyerProfile(db, pageId)
  const promptSet = page.promptSetVersion === null ? null : getLatestPromptSet(db, pageId, brands)
  const coverage = getLatestCoverage(db, pageId, null)
  const markets = listPageMarkets(db, pageId)
  const checked =
    db
      .prepare(
        `SELECT 1 FROM page_markets WHERE page_id = ? AND last_checked_at IS NOT NULL LIMIT 1`
      )
      .get(pageId) !== undefined
  const enabled = promptSet?.prompts.filter((prompt) => prompt.enabled).length ?? 0
  const has: Readonly<Record<SetupRunStep, boolean>> = {
    read: snapshot !== null,
    profile: profile !== null,
    prompts: promptSet !== null && promptSet.prompts.length > 0,
    coverage: coverage !== null
  }
  const waits = firstCheckWaits(db, pageId)
  const checkWhenReady = readCheckWhenReady(db)
  const checkAsked = waits && pageCheckWhenReady(db, pageId)
  const stopped = job?.lastError === STOPPED_BY_USER && job.state === 'failed'
  const coreDone = has.read && has.profile && has.prompts
  const jobOpen = job !== null && job.state !== 'done'
  const settingUp = page.status === 'setting_up'
  const coverageOpen = coreDone && !has.coverage && (runtime.running || jobOpen)

  let state: PagePipelineState
  if (runtime.running) state = 'running'
  else if (stopped) state = 'stopped'
  else if (job?.state === 'failed') state = 'failed'
  else if (job?.state === 'retry' && runtime.hold !== null) state = 'held'
  else if (job?.state === 'retry') state = 'retrying'
  else if (coreDone && !coverageOpen) state = checked ? 'checked' : 'ready'
  else if (runtime.hold !== null || (runtime.paused && settingUp)) state = 'held'
  else state = 'queued'

  const current: SetupRunStep | null = runtime.running
    ? (job?.step ?? firstMissing(has))
    : state === 'failed' || state === 'retrying' || state === 'held' || state === 'stopped'
      ? (job?.step ?? firstMissing(has))
      : null

  const steps: PagePipelineStep[] = RUN_STEPS.map((id) => ({
    id,
    label: STEP_LABEL[id],
    state: stepState(id, has, current, state),
    detail: stepDetail(id, {
      words: snapshot?.wordCount ?? null,
      segments: profile?.segments.length ?? null,
      prompts: promptSet?.prompts.length ?? null,
      gaps: coverage?.rows.filter((row) => row.coverage !== 'strong').length ?? null,
      has
    })
  }))
  const ready = state === 'ready' || state === 'checked'
  steps.push({
    id: 'ready',
    label: STEP_LABEL.ready,
    state: ready ? 'done' : 'todo',
    detail: ready ? (checked ? 'Checked' : 'Ready to check') : null
  })

  const samples = page.samples
  const searchesMin = enabled * Math.max(1, markets.length) * samples
  return {
    projectId,
    pageId,
    state,
    message: withAsk(messageFor(state, current, job, runtime, { waits, checkWhenReady }), {
      state,
      asked: checkAsked
    }),
    steps,
    startedAt: job?.startedAt ?? null,
    finishedAt: job?.state === 'done' ? (job.finishedAt ?? null) : null,
    retryAt: job?.state === 'retry' ? job.nextAttemptAt : null,
    attempts: job?.attempts ?? 0,
    error: stopped ? null : job !== null && job.state !== 'running' ? job.lastError : null,
    action: actionFor(state, job, runtime),
    prompts: enabled,
    markets: markets.length,
    samples,
    searchesMin,
    searchesMax: searchesMin * 2,
    firstCheckWaits: waits,
    checkWhenReady,
    checkAsked
  }
}

/** "Add and check now" is pending: say so until the first check starts. */
function withAsk(message: string, facts: { state: PagePipelineState; asked: boolean }): string {
  if (!facts.asked || facts.state === 'checked') return message
  // Set up outside the runner (or its start failed): the ask waits for the user's Start.
  if (facts.state === 'ready')
    return 'Set up. Start the first check you asked for when you are ready.'
  return `${message} The first check you asked for starts when setup is ready.`
}

function firstMissing(has: Readonly<Record<SetupRunStep, boolean>>): SetupRunStep {
  return RUN_STEPS.find((step) => !has[step]) ?? 'coverage'
}

function stepState(
  id: SetupRunStep,
  has: Readonly<Record<SetupRunStep, boolean>>,
  current: SetupRunStep | null,
  state: PagePipelineState
): PagePipelineStepState {
  if (current === id) {
    if (state === 'running') return 'running'
    if (state === 'failed') return 'failed'
    return 'waiting'
  }
  return has[id] ? 'done' : 'todo'
}

function stepDetail(
  id: SetupRunStep,
  facts: {
    words: number | null
    segments: number | null
    prompts: number | null
    gaps: number | null
    has: Readonly<Record<SetupRunStep, boolean>>
  }
): string | null {
  if (!facts.has[id]) return null
  if (id === 'read' && facts.words !== null) return pluralize(facts.words, 'word')
  if (id === 'profile' && facts.segments !== null) return pluralize(facts.segments, 'segment')
  if (id === 'prompts' && facts.prompts !== null) return pluralize(facts.prompts, 'prompt')
  if (id === 'coverage' && facts.gaps !== null) return pluralize(facts.gaps, 'gap')
  return null
}

const RUNNING_COPY: Readonly<Record<SetupRunStep, string>> = {
  read: 'Reading the page. No searches.',
  profile: 'Claude is writing the buyer profile from the page.',
  prompts: 'Claude is writing the buyer prompts from the buyer profile.',
  coverage: 'Claude is comparing each prompt with the page for content gaps.'
}

function messageFor(
  state: PagePipelineState,
  current: SetupRunStep | null,
  job: PageSetupJob | null,
  runtime: PipelineRuntime,
  project: { waits: boolean; checkWhenReady: boolean }
): string {
  switch (state) {
    case 'running':
      return RUNNING_COPY[current ?? 'read']
    case 'queued':
      return runtime.looping
        ? 'Waiting to start. CiteFox sets this page up by itself, without searches.'
        : 'Background setup is off in this window. Choose Start setup to run it now.'
    case 'held':
      if (runtime.hold !== null) return runtime.hold.reason
      if (runtime.paused) return 'Page setup is paused for every page.'
      return job?.lastError ?? 'Waiting on Claude.'
    case 'retrying':
      return `${job?.lastError ?? 'A step failed.'} CiteFox tries again by itself.`
    case 'failed':
      return job?.lastError ?? 'Setup stopped.'
    case 'stopped':
      return 'You stopped setting up this page. Resume continues where it stopped.'
    case 'ready':
      if (!project.waits) return 'Set up. The first check starts by itself.'
      return 'Set up. Review the prompts, then start the first check when you are ready.'
    case 'checked':
      return 'Set up and checked.'
  }
}

function actionFor(
  state: PagePipelineState,
  job: PageSetupJob | null,
  runtime: PipelineRuntime
): PagePipelineAction | null {
  if (state === 'stopped') return { kind: 'resume', label: 'Resume setup' }
  if (state === 'held') {
    if (runtime.hold?.connection === true) {
      return { kind: 'connections', label: 'Fix in Connections' }
    }
    if (runtime.paused) return { kind: 'resume', label: 'Resume page setup' }
    return { kind: 'retry', label: 'Try again now' }
  }
  if (state === 'failed' || state === 'retrying') {
    if (needsConnection(job?.lastError ?? '')) {
      return { kind: 'connections', label: 'Fix in Connections' }
    }
    return { kind: 'retry', label: state === 'failed' ? 'Retry' : 'Retry now' }
  }
  if (state === 'queued' && !runtime.looping) return { kind: 'retry', label: 'Start setup' }
  return null
}

/** A failure only Connections can fix: no Claude, a rejected key, Claude Code not signed in. */
export function needsConnection(message: string): boolean {
  return /connect claude|claude code is not|sign in|log in|api key|rejected|no claude|not installed|update claude code/i.test(
    message
  )
}
