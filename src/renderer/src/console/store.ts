import type { ConsoleClient } from './client'
import {
  consoleReducer,
  DEFAULT_PREFS,
  initialConsoleState,
  prefsOf,
  type ConsoleAction
} from './model'
import {
  fromAssist,
  fromCheckFinished,
  fromCheckProgress,
  fromExportProgress,
  fromPageRead,
  fromSetupProgress,
  fromStartProgress,
  fromTopicProgress
} from './sources'
import type { ConsoleJob, ConsolePrefs, ConsoleState, ConsoleUpdate } from './types'

/**
 * The window's one console store: subscribes to every progress stream once,
 * runs the state machine, ticks a clock while something can change (a job
 * settling, the auto-close countdown), and saves the user's preferences.
 */

const PREFS_KEY = 'citefox.console'
const TICK_MS = 500

export interface ConsoleStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): ConsoleState
  dispatch(action: ConsoleAction): void
  retry(job: ConsoleJob): void
  stop(job: ConsoleJob): void
  /** Stops listening (tests). */
  dispose(): void
}

export interface ConsoleStoreOptions {
  now?: () => number
  /** Per-user preferences; defaults to localStorage (wrapped, it can throw). */
  loadPrefs?: () => ConsolePrefs
  savePrefs?: (prefs: ConsolePrefs) => void
  setTimer?: (run: () => void, ms: number) => () => void
}

export function loadStoredPrefs(): ConsolePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const value = JSON.parse(raw) as Partial<ConsolePrefs>
    const position =
      value.position &&
      typeof value.position.x === 'number' &&
      typeof value.position.y === 'number' &&
      Number.isFinite(value.position.x) &&
      Number.isFinite(value.position.y)
        ? { x: value.position.x, y: value.position.y }
        : null
    return {
      prefersMin: value.prefersMin === true,
      closeWhenDone: value.closeWhenDone !== false,
      position
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveStoredPrefs(prefs: ConsolePrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private windows and blocked storage only lose the preference.
  }
}

function defaultTimer(run: () => void, ms: number): () => void {
  const id = setInterval(run, ms)
  return () => clearInterval(id)
}

export function createConsoleStore(
  client: ConsoleClient,
  options: ConsoleStoreOptions = {}
): ConsoleStore {
  const now = options.now ?? Date.now
  const save = options.savePrefs ?? saveStoredPrefs
  const setTimer = options.setTimer ?? defaultTimer
  let state = initialConsoleState((options.loadPrefs ?? loadStoredPrefs)())
  let savedPrefs = JSON.stringify(prefsOf(state))
  const listeners = new Set<() => void>()
  let stopTimer: (() => void) | null = null

  function dispatch(action: ConsoleAction): void {
    const next = consoleReducer(state, action)
    if (next === state) return
    state = next
    const prefs = JSON.stringify(prefsOf(state))
    if (prefs !== savedPrefs) {
      savedPrefs = prefs
      save(prefsOf(state))
    }
    syncTimer()
    for (const listener of [...listeners]) listener()
  }

  function needsClock(): boolean {
    return state.closingAt !== null || state.jobs.some((job) => job.status === 'running')
  }

  function syncTimer(): void {
    if (needsClock() && stopTimer === null) {
      stopTimer = setTimer(() => dispatch({ type: 'tick', now: now() }), TICK_MS)
    } else if (!needsClock() && stopTimer !== null) {
      stopTimer()
      stopTimer = null
    }
  }

  const feed =
    <T>(map: (event: T, at: number) => ConsoleUpdate) =>
    (event: T): void => {
      try {
        dispatch({ type: 'update', update: map(event, now()) })
      } catch {
        // A malformed event never breaks the console.
      }
    }

  const unsubscribers = [
    client.onCheckProgress(feed(fromCheckProgress)),
    client.onCheckFinished(feed(fromCheckFinished)),
    client.onPageRead(feed(fromPageRead)),
    client.onAssist(feed(fromAssist)),
    client.onTopic(feed(fromTopicProgress)),
    client.onSetup(feed(fromSetupProgress)),
    client.onStart(feed(fromStartProgress)),
    client.onExport(feed(fromExportProgress))
  ]

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    dispatch,
    retry(job) {
      const spec = job.retry
      if (spec === null) return
      const sent =
        spec.kind === 'check'
          ? client.retryCheck(spec.projectId, spec.pageId)
          : client.retrySetup(spec.pageId)
      dispatch({ type: 'retried', jobId: job.id, now: now() })
      sent.catch((error: unknown) => {
        dispatch({
          type: 'update',
          update: {
            jobId: job.id,
            kind: job.kind,
            title: job.title,
            command: job.command,
            at: now(),
            state: 'error',
            final: true,
            error: {
              message: error instanceof Error ? error.message : 'The retry did not start.',
              nextStep: 'Try again from the page.'
            }
          }
        })
      })
    },
    stop(job) {
      const spec = job.stop
      if (spec === null) return
      const sent =
        spec.kind === 'check' ? client.cancelCheck(spec.jobId) : client.stopStart(spec.projectId)
      sent.catch(() => undefined)
    },
    dispose() {
      for (const off of unsubscribers) off()
      stopTimer?.()
      stopTimer = null
      listeners.clear()
    }
  }
}

let shared: ConsoleStore | null = null

/** The window's store, created on first use. */
export function sharedConsoleStore(client: () => ConsoleClient): ConsoleStore {
  shared ??= createConsoleStore(client())
  return shared
}

/** Tests only. */
export function resetSharedConsoleStore(): void {
  shared?.dispose()
  shared = null
}
