import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { AssistProgress, AssistProgressClaude } from '@shared/ipc'
import { recentAssistProgress, subscribeAssistProgress } from '../assist/progress'

/** One row of the live panel. */
export interface AssistStepView {
  key: string
  kind: AssistProgress['kind']
  label: string
  state: AssistProgress['state']
  detail: string | null
  startedAt: number
  endedAt: number | null
}

/** What `AssistProgress` draws. */
export interface AssistProgressView {
  steps: readonly AssistStepView[]
  /** True while the screen's call is in flight. */
  running: boolean
  /** When the screen started the call (renderer clock). Null before the first run. */
  startedAt: number | null
  /** When the call answered. Null while it runs. */
  endedAt: number | null
  /** The connection of the latest Claude step. */
  claude: AssistProgressClaude | null
}

export const IDLE_PROGRESS: AssistProgressView = {
  steps: [],
  running: false,
  startedAt: null,
  endedAt: null,
  claude: null
}

/**
 * Which runs belong to a screen. `channel` is an invoke channel or a prefix
 * ending in `:` (`topics:`); null takes every channel. `scope` is the assist
 * id, draft id or domain main put on the run; null takes any.
 */
export interface AssistProgressMatch {
  channel: string | null
  scope: string | null
}

/** A run that started this long before the screen marked itself active still counts. */
const START_SKEW_MS = 1500

export function matchesChannel(match: string | null, channel: string): boolean {
  if (match === null) return true
  return match.endsWith(':') ? channel.startsWith(match) : match === channel
}

/**
 * The steps of the runs a screen is waiting on. Pure data: the hook feeds it
 * events and edges, React reads it through `useSyncExternalStore`.
 */
export class AssistProgressStore {
  private view: AssistProgressView = IDLE_PROGRESS
  private active = false
  private since = 0
  private runs = new Set<string>()
  private shown = new Set<string>()
  private match: AssistProgressMatch = { channel: null, scope: null }
  private readonly listeners = new Set<() => void>()

  /** `recent`: events already pushed when the screen turns active (replayed if they match). */
  constructor(private readonly recent: () => readonly AssistProgress[] = () => []) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): AssistProgressView => this.view

  /** Applies the screen's `active` flag and match. Idempotent. */
  sync(active: boolean, match: AssistProgressMatch, now: number): void {
    this.match = match
    if (active && !this.active) {
      this.active = true
      this.since = now - START_SKEW_MS
      // Runs shown by an earlier call ("Try again" right after) never join the new list.
      this.shown = new Set([...this.shown, ...this.runs].slice(-50))
      this.runs = new Set()
      this.view = { steps: [], running: true, startedAt: now, endedAt: null, claude: null }
      for (const event of this.recent()) if (this.accepts(event)) this.apply(event)
      this.emit()
    } else if (!active && this.active) {
      this.active = false
      this.view = { ...this.view, running: false, endedAt: now }
      this.emit()
    }
  }

  push(event: AssistProgress): void {
    if (!this.accepts(event)) return
    this.apply(event)
    this.emit()
  }

  private accepts(event: AssistProgress): boolean {
    if (this.runs.has(event.runId)) return true
    if (!this.active || this.shown.has(event.runId)) return false
    if (!matchesChannel(this.match.channel, event.channel)) return false
    if (this.match.scope !== null && this.match.scope !== event.scope) return false
    if (event.startedAt < this.since) return false
    this.runs.add(event.runId)
    return true
  }

  private apply(event: AssistProgress): void {
    const key = `${event.runId}:${event.stepId}`
    const next: AssistStepView = {
      key,
      kind: event.kind,
      label: event.label,
      state: event.state,
      detail: event.detail,
      startedAt: event.startedAt,
      endedAt: event.endedAt
    }
    const steps = this.view.steps
    const index = steps.findIndex((step) => step.key === key)
    this.view = {
      ...this.view,
      steps:
        index === -1
          ? [...steps, next]
          : steps.map((step, position) => (position === index ? next : step)),
      claude: event.claude ?? this.view.claude
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Live steps for the call a screen is running. Pass `active` true while the
 * call is in flight: the steps reset when it turns true and stop growing when
 * it turns false (late end events of runs already shown still land).
 */
export function useAssistProgress(
  active: boolean,
  channel: string | null = null,
  scope: string | null = null
): AssistProgressView {
  const [store] = useState(() => new AssistProgressStore(recentAssistProgress))
  useEffect(() => subscribeAssistProgress((event) => store.push(event)), [store])
  // Layout effect: the edge is applied before any event the call pushes is delivered.
  useLayoutEffect(() => {
    store.sync(active, { channel, scope }, Date.now())
  }, [store, active, channel, scope])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
