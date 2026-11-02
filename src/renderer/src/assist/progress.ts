import type { AssistProgress } from '@shared/ipc'

/**
 * Where `assist:progress` events come from: the preload bridge (main's live
 * steps) and, in dev and e2e mock builds, the in-memory clients, which emit
 * the same events through `emitLocalAssistProgress`. Screens subscribe through
 * `useAssistProgress`, never to the bridge directly.
 *
 * One bridge listener serves the window and keeps the last few seconds of
 * events, so a panel that mounts as its call starts still shows the first steps.
 */
type Listener = (event: AssistProgress) => void

const listeners = new Set<Listener>()
let recent: AssistProgress[] = []
let bridged = false

/** Events kept for a panel that starts listening a moment after its call. */
const RECENT_MS = 5000

function deliver(event: AssistProgress): void {
  const now = Date.now()
  recent = [...recent.filter((item) => now - item.startedAt < RECENT_MS), event]
  for (const listener of [...listeners]) listener(event)
}

function ensureBridge(): void {
  if (bridged || typeof window === 'undefined' || !window.citefox) return
  try {
    window.citefox['assist:progress'](deliver)
    bridged = true
  } catch {
    // A missing channel (an old preload) only loses the live steps.
  }
}

ensureBridge()

export function subscribeAssistProgress(listener: Listener): () => void {
  ensureBridge()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The events of the last few seconds, oldest first. */
export function recentAssistProgress(): readonly AssistProgress[] {
  const now = Date.now()
  return recent.filter((item) => now - item.startedAt < RECENT_MS)
}

/** Mock clients and tests: deliver one event as if main had pushed it. */
export function emitLocalAssistProgress(event: AssistProgress): void {
  deliver(event)
}

/** Tests only: forget kept events. */
export function resetAssistProgressForTests(): void {
  recent = []
}

export interface MockStep {
  kind: AssistProgress['kind']
  label: string
  /** Shown while the step runs. */
  detail?: string | null
  /** Shown once it ended; defaults to `detail`. */
  doneDetail?: string | null
  state?: Exclude<AssistProgress['state'], 'running'>
  ms: number
  claude?: AssistProgress['claude']
}

/**
 * A scripted run for mock clients: each step starts, waits `ms × pace`, then
 * ends. Resolves when the last step ended. `pace` 0 runs at once.
 */
export async function playMockSteps(
  options: { channel: string; scope: string | null; steps: readonly MockStep[] },
  pace = 1
): Promise<void> {
  const runId = `mock-${Math.random().toString(36).slice(2, 10)}`
  let index = 0
  for (const step of options.steps) {
    index += 1
    const base = {
      runId,
      channel: options.channel,
      scope: options.scope,
      stepId: `s${index}`,
      kind: step.kind,
      label: step.label,
      startedAt: Date.now(),
      claude: step.claude ?? null
    }
    deliver({ ...base, state: 'running', detail: step.detail ?? null, endedAt: null })
    const wait = Math.round(step.ms * pace)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    deliver({
      ...base,
      state: step.state ?? 'done',
      detail: step.doneDetail !== undefined ? step.doneDetail : (step.detail ?? null),
      endedAt: Date.now()
    })
  }
}
