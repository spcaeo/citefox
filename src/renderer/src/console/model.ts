import type {
  ConsoleJob,
  ConsoleLine,
  ConsolePosition,
  ConsolePrefs,
  ConsoleState,
  ConsoleUpdate,
  JobStatus
} from './types'

/**
 * The work console's state machine (pure; the store feeds it events and a clock):
 *
 * - new work opens the window (or the pill, if the user minimised last time);
 * - each stage is one prompt line, steps update in place, errors are red lines;
 * - a job with no end event is done once it has been quiet for its `settleMs`;
 * - when every job is over and the window is open, it counts down
 *   {@link AUTO_CLOSE_MS} and hides, unless "Close when done" is off (pinned) or
 *   a job failed (errors never close by themselves);
 * - when a job ends while minimised, the pill turns green (red on error) and
 *   shakes, then waits for a click: it never closes itself.
 */

export const AUTO_CLOSE_MS = 5000
/** Finished jobs kept for the tabs and history. */
export const MAX_JOBS = 20
/** Lines kept per job (the oldest step lines go first). */
export const MAX_LINES = 200
export const DEFAULT_SETTLE_MS = 2500
/** A job silent this long is over even with a line still "running". */
export const STALE_MS = 5 * 60 * 1000

export type ConsoleAction =
  | { type: 'update'; update: ConsoleUpdate }
  | { type: 'tick'; now: number }
  | { type: 'open'; now: number }
  | { type: 'minimise' }
  | { type: 'hide' }
  /** The top bar's Activity button: open, or close an open window. */
  | { type: 'toggle'; now: number }
  /** "keep open" in the countdown: stay open this time. */
  | { type: 'keepOpen' }
  | { type: 'setCloseWhenDone'; value: boolean }
  | { type: 'select'; jobId: string }
  | { type: 'move'; position: ConsolePosition | null }
  /** A retry was sent: say so under the job's error. */
  | { type: 'retried'; jobId: string; now: number }
  /** The setup screens came or went (see `ConsoleState.quiet`). */
  | { type: 'setQuiet'; value: boolean }

export const DEFAULT_PREFS: ConsolePrefs = {
  prefersMin: false,
  closeWhenDone: true,
  position: null
}

export function initialConsoleState(prefs: ConsolePrefs = DEFAULT_PREFS): ConsoleState {
  return {
    jobs: [],
    activeJobId: null,
    mode: 'hidden',
    prefersMin: prefs.prefersMin,
    closeWhenDone: prefs.closeWhenDone,
    attention: 'none',
    shakeKey: 0,
    closingAt: null,
    errorPending: false,
    position: prefs.position,
    quiet: false
  }
}

export function prefsOf(state: ConsoleState): ConsolePrefs {
  return {
    prefersMin: state.prefersMin,
    closeWhenDone: state.closeWhenDone,
    position: state.position
  }
}

export function runningJobs(state: ConsoleState): readonly ConsoleJob[] {
  return state.jobs.filter((job) => job.status === 'running')
}

export function activeJob(state: ConsoleState): ConsoleJob | null {
  return (
    state.jobs.find((job) => job.id === state.activeJobId) ??
    runningJobs(state).at(-1) ??
    state.jobs.at(-1) ??
    null
  )
}

export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  switch (action.type) {
    case 'update':
      return applyUpdate(state, action.update)
    case 'tick':
      return tick(state, action.now)
    case 'open':
      return { ...state, mode: 'open', prefersMin: false, attention: 'none', closingAt: null }
    case 'minimise':
      return { ...state, mode: 'min', prefersMin: true, closingAt: null }
    case 'hide':
      return { ...state, mode: 'hidden', attention: 'none', closingAt: null, errorPending: false }
    case 'toggle':
      return state.mode === 'open'
        ? consoleReducer(state, { type: 'hide' })
        : consoleReducer(state, { type: 'open', now: action.now })
    case 'keepOpen':
      return { ...state, closingAt: null }
    case 'setCloseWhenDone':
      return {
        ...state,
        closeWhenDone: action.value,
        closingAt: action.value ? state.closingAt : null
      }
    case 'select':
      return state.jobs.some((job) => job.id === action.jobId)
        ? { ...state, activeJobId: action.jobId }
        : state
    case 'move':
      return { ...state, position: action.position }
    case 'setQuiet':
      return state.quiet === action.value ? state : { ...state, quiet: action.value }
    case 'retried':
      return {
        ...state,
        jobs: state.jobs.map((job) =>
          job.id === action.jobId
            ? {
                ...job,
                retry: null,
                lines: [
                  ...job.lines,
                  line(job, 'step', 'RETRY', 'retry sent, a new run starts', 'ok', action.now)
                ]
              }
            : job
        )
      }
  }
}

function line(
  job: Pick<ConsoleJob, 'id' | 'lines'>,
  kind: ConsoleLine['kind'],
  stage: string,
  text: string,
  state: ConsoleLine['state'],
  at: number,
  detail: string | null = null
): ConsoleLine {
  return {
    id: `${job.id}:${kind}:${job.lines.length}:${at}`,
    kind,
    stage,
    text,
    state,
    detail,
    startedAt: at,
    endedAt: state === 'running' ? null : at
  }
}

function newJob(update: ConsoleUpdate): ConsoleJob {
  return {
    id: update.jobId,
    kind: update.kind,
    title: update.title,
    command: update.command,
    status: 'running',
    startedAt: update.at,
    updatedAt: update.at,
    endedAt: null,
    lines: [],
    progress: null,
    summary: null,
    error: null,
    retry: null,
    stop: null,
    settleMs: update.settleMs ?? DEFAULT_SETTLE_MS,
    expectedMs: update.expectedMs ?? null,
    background: update.background === true,
    live: null
  }
}

/** The job an update belongs to: its own id, or the newest running job of `attachTo`. */
function targetId(state: ConsoleState, update: ConsoleUpdate): string {
  if (update.attachTo === undefined) return update.jobId
  if (state.jobs.some((job) => job.id === update.jobId)) return update.jobId
  const host = [...state.jobs]
    .reverse()
    .find((job) => job.kind === update.attachTo && job.status === 'running')
  return host?.id ?? update.jobId
}

function withLines(job: ConsoleJob, update: ConsoleUpdate): readonly ConsoleLine[] {
  let lines = [...job.lines]
  const stage = update.stage ?? lastStage(lines) ?? 'WORK'
  const lastStageLine = [...lines].reverse().find((item) => item.kind === 'stage')
  if (update.stage !== undefined) {
    const text = update.stageText ?? ''
    // A stage is running while its current step runs; a finished step leaves it done
    // (the next step or stage starts it again), so a job with no end event can settle.
    const stageState = update.step
      ? update.step.state === 'error'
        ? 'error'
        : update.step.state === 'running'
          ? 'running'
          : 'ok'
      : update.state
    if (lastStageLine && lastStageLine.stage === update.stage) {
      lines = lines.map((item) =>
        item === lastStageLine
          ? {
              ...item,
              text: text || item.text,
              state: stageState === 'error' ? 'error' : stageState,
              endedAt: stageState === 'running' ? null : update.at
            }
          : item
      )
    } else {
      // The previous stage is over once the next one starts.
      lines = lines.map((item) =>
        item.kind === 'stage' && item.state === 'running'
          ? { ...item, state: 'ok', endedAt: update.at }
          : item
      )
      lines.push(line({ ...job, lines }, 'stage', update.stage, text, stageState, update.at))
    }
  }
  if (update.step) {
    const step = update.step
    const id = `${job.id}:step:${step.id}`
    const next: ConsoleLine = {
      id,
      kind: 'step',
      stage,
      text: step.text,
      state: step.state,
      detail: step.detail,
      startedAt: step.startedAt,
      endedAt: step.endedAt
    }
    const index = lines.findIndex((item) => item.id === id)
    if (index === -1) lines.push(next)
    else lines[index] = next
  }
  if (update.error && (update.state === 'error' || update.state === 'warning')) {
    const last = lines.at(-1)
    const text = update.error.message
    if (!(last && last.kind === 'error' && last.text === text)) {
      lines.push(
        line(
          { ...job, lines },
          'error',
          stage,
          text,
          update.state,
          update.at,
          update.error.nextStep
        )
      )
    }
  }
  if (lines.length > MAX_LINES) {
    const over = lines.length - MAX_LINES
    let dropped = 0
    lines = lines.filter((item) => {
      if (dropped < over && item.kind === 'step') {
        dropped += 1
        return false
      }
      return true
    })
  }
  return lines
}

function lastStage(lines: readonly ConsoleLine[]): string | null {
  return [...lines].reverse().find((item) => item.kind === 'stage')?.stage ?? null
}

function applyUpdate(state: ConsoleState, update: ConsoleUpdate): ConsoleState {
  const id = targetId(state, update)
  const existing = state.jobs.find((job) => job.id === id)
  // A late event for a finished job (a straggling step) reopens it only if it is running work.
  const base = existing ?? newJob({ ...update, jobId: id })
  const reopened = existing !== undefined && existing.status !== 'running'
  if (reopened && (update.final || update.state !== 'running')) {
    // Late end events of a finished job only refresh its lines.
    const job = { ...existing, lines: withLines(existing, update) }
    return { ...state, jobs: state.jobs.map((item) => (item.id === id ? job : item)) }
  }
  let job: ConsoleJob = {
    ...base,
    title: existing && update.attachTo ? base.title : update.title,
    command: existing && update.attachTo ? base.command : update.command,
    status: 'running',
    endedAt: null,
    updatedAt: update.at,
    lines: withLines(base, update),
    progress: update.progress === undefined ? base.progress : update.progress,
    summary: update.summary === undefined ? base.summary : update.summary,
    error: update.error === undefined ? base.error : update.error,
    retry: update.retry === undefined ? base.retry : update.retry,
    stop: update.stop === undefined ? base.stop : update.stop,
    settleMs: update.settleMs ?? base.settleMs,
    expectedMs: update.expectedMs === undefined ? base.expectedMs : update.expectedMs,
    live: update.live === undefined ? base.live : update.live
  }
  if (update.final) {
    job = finish(
      job,
      update.state === 'error' || update.state === 'warning' ? 'error' : 'done',
      update.at
    )
  }
  const isNew = existing === undefined
  let jobs = isNew ? [...state.jobs, job] : state.jobs.map((item) => (item.id === id ? job : item))
  if (jobs.length > MAX_JOBS) {
    const drop = jobs.find((item) => item.status !== 'running')
    if (drop) jobs = jobs.filter((item) => item !== drop)
  }
  let next: ConsoleState = { ...state, jobs }
  if ((isNew || reopened) && !job.background && !(state.quiet && job.kind !== 'checks')) {
    next = {
      ...next,
      activeJobId: job.id,
      closingAt: null,
      mode: next.mode === 'hidden' ? openingMode(next, job) : next.mode,
      attention: next.mode === 'min' && !next.errorPending ? 'none' : next.attention
    }
  }
  if (job.status !== 'running') next = afterFinish(next, job, update.at)
  return next
}

/**
 * How new work shows: the window, or the pill when the user minimised last
 * time. First-run setup always starts as the pill: its screen shows the same
 * steps, and the window would cover that screen's footer.
 */
function openingMode(state: ConsoleState, job: ConsoleJob): 'open' | 'min' {
  return state.prefersMin || job.kind === 'start' ? 'min' : 'open'
}

function finish(job: ConsoleJob, status: Exclude<JobStatus, 'running'>, at: number): ConsoleJob {
  const lines = job.lines.map((item) =>
    item.state === 'running' ? { ...item, state: 'ok' as const, endedAt: at } : item
  )
  return { ...job, status, endedAt: at, updatedAt: at, lines, stop: null, live: null }
}

/** Bookkeeping when one job ends: the pill's news, and the countdown once all are over. */
function afterFinish(state: ConsoleState, job: ConsoleJob, now: number): ConsoleState {
  // Background work ends quietly: no pill news, and an error never pins the window open.
  if (job.background) return scheduleClose(state, now)
  const failed = job.status === 'error'
  let next: ConsoleState = { ...state, errorPending: state.errorPending || failed }
  if (next.mode === 'min') {
    // The pill reports the job that just ended, and opening it shows that job.
    next = {
      ...next,
      activeJobId: job.id,
      attention: next.errorPending ? 'error' : 'done',
      shakeKey: next.shakeKey + 1
    }
  }
  return scheduleClose(next, now)
}

function scheduleClose(state: ConsoleState, now: number): ConsoleState {
  const busy = state.jobs.some((job) => job.status === 'running')
  if (busy) return { ...state, closingAt: null }
  if (state.mode !== 'open' || !state.closeWhenDone || state.errorPending) {
    return { ...state, closingAt: null }
  }
  return state.closingAt === null ? { ...state, closingAt: now + AUTO_CLOSE_MS } : state
}

function tick(state: ConsoleState, now: number): ConsoleState {
  let next = state
  for (const job of state.jobs) {
    if (job.status !== 'running') continue
    const quiet = now - job.updatedAt
    // A running line keeps the job open, unless nothing at all was heard for a long time
    // (a cancelled check sends no end event).
    const busy = job.lines.some((item) => item.state === 'running') && quiet < STALE_MS
    if (busy || quiet < job.settleMs) continue
    const last = job.lines.at(-1)
    const failed = last !== undefined && last.state === 'error'
    const done = finish(job, failed ? 'error' : 'done', now)
    const ended: ConsoleJob = failed
      ? { ...done, error: done.error ?? { message: last.text, nextStep: last.detail } }
      : done
    next = afterFinish(
      { ...next, jobs: next.jobs.map((item) => (item.id === job.id ? ended : item)) },
      ended,
      now
    )
  }
  if (next.closingAt !== null && now >= next.closingAt) {
    next = { ...next, mode: 'hidden', closingAt: null, attention: 'none' }
  }
  return next
}

/** "8 s", "1 min 5 s". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/**
 * Whose terminal the prompt looks like: Windows keeps the DOS `C:\` style; macOS and
 * Linux get a neutral shell prompt (`citefox/checks/search $`), never a drive letter.
 */
export type ConsolePlatform = 'windows' | 'unix'

export function consolePlatform(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent
): ConsolePlatform {
  return /Macintosh|Mac OS X|Linux|X11/.test(userAgent) ? 'unix' : 'windows'
}

/**
 * The prompt before a stage. Windows: `C:\CITEFOX\FILL\READ>`, and `short` drops
 * `CITEFOX` for the pill (`C:\FILL\READ>`). macOS and Linux: `citefox/fill/read $`
 * (`fill/read $` in the pill).
 */
export function promptFor(
  kind: string | null,
  stage: string | null,
  short = false,
  platform: ConsolePlatform = consolePlatform()
): string {
  const parts = [short ? null : 'CITEFOX', kind?.toUpperCase() ?? null, stage].filter(
    (part): part is string => part !== null && part.length > 0
  )
  if (platform === 'unix') {
    return `${(parts.length > 0 ? parts : ['CITEFOX']).join('/').toLowerCase()} $`
  }
  return `C:\\${parts.join('\\')}>`
}

/** The stage a job is on now, for the pill and the window title. */
export function currentStage(job: ConsoleJob): string | null {
  return [...job.lines].reverse().find((item) => item.kind === 'stage')?.stage ?? null
}
