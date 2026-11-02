import type {
  StartItemState,
  StartKnown,
  StartPhase,
  StartProgress,
  StartStepId,
  StartStepItem,
  StartSubItem
} from '@shared/ipc'

/**
 * The autopilot's live step list (Mockups/v2/journey-a A2): each step's state,
 * what it found, how long it took, retries and skips, and "What we know".
 * Every change pushes a full snapshot, so a screen opened late paints at once.
 */

/** Steps in order, with their label and usual seconds (for the time left). */
export const START_STEPS: readonly { id: StartStepId; label: string; seconds: number }[] = [
  { id: 'home', label: 'Read homepage', seconds: 3 },
  { id: 'sitemap', label: 'Read sitemap', seconds: 4 },
  { id: 'sections', label: 'Group pages into sections', seconds: 2 },
  { id: 'key_pages', label: 'Read key pages', seconds: 20 },
  { id: 'pick', label: 'Pick pages most likely to matter', seconds: 25 },
  { id: 'rivals', label: 'Sort rivals from partners', seconds: 1 },
  { id: 'profile', label: 'Write buyer profile', seconds: 20 },
  { id: 'questions', label: 'Draft buyer questions', seconds: 40 },
  { id: 'plan', label: 'Suggest a starting plan', seconds: 25 }
]

export function emptyKnown(): StartKnown {
  return {
    pageCount: null,
    sections: [],
    rivals: [],
    buyers: null,
    picked: null,
    pickedPages: [],
    questions: [],
    upNext: []
  }
}

export class StartTracker {
  private readonly items: StartStepItem[]
  private readonly started = new Map<StartStepId, number>()
  private phase: StartPhase = 'running'
  private message: string | null = null
  known: StartKnown = emptyKnown()

  constructor(
    private readonly projectId: string,
    private readonly startedAt: number,
    private readonly clock: () => number,
    private readonly emit: (progress: StartProgress) => void
  ) {
    this.items = START_STEPS.map((step) => ({
      id: step.id,
      label: step.label,
      state: 'pending',
      detail: null,
      durationMs: null,
      estimateSeconds: step.seconds,
      subItems: [],
      progress: null
    }))
  }

  start(id: StartStepId, detail: string | null = null): void {
    this.started.set(id, this.clock())
    this.patch(id, { state: 'running', detail })
  }

  update(
    id: StartStepId,
    patch: Partial<Pick<StartStepItem, 'detail' | 'progress' | 'label'>>
  ): void {
    this.patch(id, patch)
  }

  sub(id: StartStepId, item: StartSubItem): void {
    const current = this.item(id)
    const others = current.subItems.filter((entry) => entry.label !== item.label)
    // Only retries, skips and the read in flight stay listed; plain successes collapse.
    const keep = item.state === 'ok' ? others : [...others, item]
    this.patch(id, { subItems: keep })
  }

  finish(
    id: StartStepId,
    state: Exclude<StartItemState, 'pending' | 'running'>,
    detail: string
  ): void {
    const began = this.started.get(id) ?? this.clock()
    this.patch(id, {
      state,
      detail,
      durationMs: Math.max(0, this.clock() - began),
      subItems: this.item(id).subItems.filter((entry) => entry.state !== 'running')
    })
  }

  setKnown(patch: Partial<StartKnown>): void {
    this.known = { ...this.known, ...patch }
    this.push()
  }

  end(phase: Exclude<StartPhase, 'running'>, message: string | null = null): StartProgress {
    this.phase = phase
    this.message = message
    if (phase !== 'done') {
      for (const item of this.items) {
        if (item.state === 'running') {
          item.state = phase === 'failed' ? 'failed' : 'pending'
          item.progress = null
        }
      }
    }
    return this.push()
  }

  snapshot(): StartProgress {
    const elapsedMs = Math.max(0, this.clock() - this.startedAt)
    return {
      projectId: this.projectId,
      phase: this.phase,
      items: this.items.map((item) => ({ ...item, subItems: [...item.subItems] })),
      startedAt: new Date(this.startedAt).toISOString(),
      elapsedMs,
      etaSeconds: this.phase === 'running' ? this.eta() : null,
      message: this.message,
      known: this.known
    }
  }

  /** Seconds left: the usual time of every step not done, minus time spent on the running one. */
  private eta(): number {
    let seconds = 0
    for (const item of this.items) {
      if (item.state === 'pending') seconds += item.estimateSeconds
      if (item.state === 'running') {
        const spent = (this.clock() - (this.started.get(item.id) ?? this.clock())) / 1000
        seconds += Math.max(1, item.estimateSeconds - spent)
      }
    }
    return Math.round(seconds)
  }

  private item(id: StartStepId): StartStepItem {
    const found = this.items.find((item) => item.id === id)
    if (found === undefined) throw new Error(`unknown step ${id}`)
    return found
  }

  private patch(id: StartStepId, patch: Partial<StartStepItem>): void {
    Object.assign(this.item(id), patch)
    this.push()
  }

  private push(): StartProgress {
    const snapshot = this.snapshot()
    this.emit(snapshot)
    return snapshot
  }
}
