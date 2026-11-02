import { INTERVAL_DAYS, type IntervalDays, type SampleCount } from '@shared/domain'
import type { QuickPicks, RuleOp, SelectionState, TrackSettings } from './types'

export const RULE_OPS: readonly { value: RuleOp; label: string }[] = [
  { value: 'contains', label: 'URL contains' },
  { value: 'starts', label: 'URL starts with' },
  { value: 'not_contains', label: "URL doesn't contain" },
  { value: 'title', label: 'Title contains' }
]

export const RECENT_DAYS = 90

export const INTERVAL_OPTIONS: readonly IntervalDays[] = INTERVAL_DAYS

export const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const satisfies readonly SampleCount[]

export const DEFAULT_TRACK: TrackSettings = {
  intervalDays: 30,
  promptCount: 5,
  samples: 1,
  stagger: true
}

export const NO_PICKS: QuickPicks = { links: false, recent: false, money: false }

export const EMPTY_SELECTION: SelectionState = {
  folders: [],
  clusters: [],
  rules: [],
  picks: NO_PICKS,
  aiKeys: [],
  pasted: [],
  off: []
}

/** Pause before the cost estimate asks the engine again. */
export const ESTIMATE_DEBOUNCE_MS = 250

/** Shown when a page has no cluster yet. */
export const NO_CLUSTER = 'No cluster'
