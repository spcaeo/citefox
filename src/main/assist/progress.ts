import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type {
  AssistProgress,
  AssistProgressClaude,
  AssistStepKind,
  AssistStepState
} from '@shared/ipc'
import { redactString } from '../logging/redact'

/**
 * Live progress for assists and long Claude steps (`assist:progress`).
 *
 * Every invoke runs inside `runWithProgress` (src/main/ipc.ts), so code deep in
 * the engine (a page read, the Claude call log, the answer check) calls
 * `progressStep` without threading an emitter through. Outside a run, or once
 * the invoke has answered (background work it started), a step is a no-op.
 * A run with no steps sends nothing.
 *
 * Labels and details are short sentences written by the engine: a path, a
 * method, a count, a model id. Never page text, prompts, replies, or secrets;
 * as a last guard both are redacted for key shapes and capped.
 */

export type AssistProgressEmit = (event: AssistProgress) => void

interface ProgressRun {
  runId: string
  channel: string
  scope: string | null
  emit: AssistProgressEmit
  closed: boolean
  sequence: number
  /** The next Claude step repeats a rejected reply ("Asking Claude again"). */
  retryNext: boolean
  /** What the run is doing right now, shown under the next Claude step. */
  hint: string | null
  clock: () => number
}

const storage = new AsyncLocalStorage<ProgressRun>()

const LABEL_MAX = 120
const DETAIL_MAX = 160

export interface ProgressRunOptions {
  channel: string
  scope?: string | null
  emit: AssistProgressEmit
  /** Tests only. */
  clock?: () => number
  /** Tests only. */
  runId?: string
}

/** Runs `work` as one progress run. Steps after `work` settles are dropped. */
export async function runWithProgress<T>(
  options: ProgressRunOptions,
  work: () => Promise<T> | T
): Promise<T> {
  const run: ProgressRun = {
    runId: options.runId ?? `run-${randomUUID()}`,
    channel: options.channel,
    scope: options.scope ?? null,
    emit: options.emit,
    closed: false,
    sequence: 0,
    retryNext: false,
    hint: null,
    clock: options.clock ?? Date.now
  }
  try {
    return await storage.run(run, work)
  } finally {
    run.closed = true
  }
}

/** The scope a screen filters on: the assist id, else the draft id, else the domain. */
export function progressScope(args: readonly unknown[]): string | null {
  const first = args[0]
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null
  const record = first as Record<string, unknown>
  for (const key of ['assistId', 'draftId', 'domain']) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value
  }
  return null
}

/** One step. Every method after the first that ends the step is ignored. */
export interface ProgressStepHandle {
  /** Changes the detail of a running step. */
  update(detail: string | null): void
  done(detail?: string | null, label?: string): void
  skip(detail?: string | null, label?: string): void
  fail(detail?: string | null, label?: string): void
  /** Sets the Claude connection line (Claude steps). */
  claude(claude: AssistProgressClaude): void
}

const NOOP_STEP: ProgressStepHandle = {
  update: () => undefined,
  done: () => undefined,
  skip: () => undefined,
  fail: () => undefined,
  claude: () => undefined
}

export interface ProgressStepInput {
  kind: AssistStepKind
  label: string
  detail?: string | null
  claude?: AssistProgressClaude | null
}

/** Starts a step in the current run. A no-op handle outside a run. */
export function progressStep(input: ProgressStepInput): ProgressStepHandle {
  const run = storage.getStore()
  if (run === undefined || run.closed) return NOOP_STEP
  run.sequence += 1
  const stepId = `s${run.sequence}`
  const startedAt = run.clock()
  let label = clean(input.label, LABEL_MAX) ?? 'Working'
  let detail = clean(input.detail ?? null, DETAIL_MAX)
  let claude = input.claude ?? null
  let ended = false
  const send = (state: AssistStepState, endedAt: number | null): void => {
    if (run.closed) return
    try {
      run.emit({
        runId: run.runId,
        channel: run.channel,
        scope: run.scope,
        stepId,
        kind: input.kind,
        label,
        state,
        detail,
        startedAt,
        endedAt,
        claude
      })
    } catch {
      // A closed window must not fail the step.
    }
  }
  const finish =
    (state: AssistStepState) =>
    (nextDetail?: string | null, nextLabel?: string): void => {
      if (ended) return
      ended = true
      if (nextDetail !== undefined) detail = clean(nextDetail, DETAIL_MAX)
      if (nextLabel !== undefined) label = clean(nextLabel, LABEL_MAX) ?? label
      send(state, Math.max(startedAt, run.clock()))
    }
  send('running', null)
  return {
    update(nextDetail) {
      if (ended) return
      detail = clean(nextDetail, DETAIL_MAX)
      send('running', null)
    },
    done: finish('done'),
    skip: finish('skipped'),
    fail: finish('failed'),
    claude(next) {
      claude = next
      if (!ended) send('running', null)
    }
  }
}

/** A step that is already over, such as "9 suggestions ready". */
export function progressNote(
  input: ProgressStepInput & { state?: Exclude<AssistStepState, 'running'> }
): void {
  const run = storage.getStore()
  if (run === undefined || run.closed) return
  const step = progressStep(input)
  const state = input.state ?? 'done'
  if (state === 'done') step.done()
  else if (state === 'skipped') step.skip()
  else step.fail()
}

/** Shown under the next Claude step, such as "Matching 20 questions". */
export function progressHint(hint: string | null): void {
  const run = storage.getStore()
  if (run === undefined || run.closed) return
  run.hint = clean(hint, DETAIL_MAX)
}

/** The next Claude step repeats a rejected reply. */
export function progressRetryNext(): void {
  const run = storage.getStore()
  if (run !== undefined) run.retryNext = true
}

/** Reads and clears the retry flag and the hint, for the Claude step that starts now. */
export function takeClaudeContext(): { retry: boolean; hint: string | null } {
  const run = storage.getStore()
  if (run === undefined) return { retry: false, hint: null }
  const taken = { retry: run.retryNext, hint: run.hint }
  run.retryNext = false
  return taken
}

/** True inside an open run (tests and callers that skip work nobody sees). */
export function inProgressRun(): boolean {
  const run = storage.getStore()
  return run !== undefined && !run.closed
}

/** "/pricing" for a page on the site, "example.com" for its homepage. */
export function pageLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/u, '')
    if (path === '') return parsed.hostname.replace(/^www\./u, '')
    return path
  } catch {
    return url
  }
}

function clean(value: string | null, max: number): string | null {
  if (value === null) return null
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim()
  if (flat.length === 0) return null
  const safe = redactString(flat, { hexKeys: true })
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe
}
