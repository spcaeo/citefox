import type { IntervalDays, MarketDevice, SampleCount } from '@shared/domain'
import type { ImportCandidate, ImportRejection } from '@shared/ipc'

export type ImportSource = 'sitemap' | 'paste' | 'file'

/** Rule conditions on step 2. `not_contains` removes pages from the selection. */
export type RuleOp = 'contains' | 'starts' | 'not_contains' | 'title'

export interface ImportRule {
  id: number
  op: RuleOp
  value: string
}

export interface QuickPicks {
  links: boolean
  recent: boolean
  money: boolean
}

/** Everything the user chose on step 2, plus preview unticks. Keys are {@link rowKey}. */
export interface SelectionState {
  folders: readonly string[]
  clusters: readonly string[]
  rules: readonly ImportRule[]
  picks: QuickPicks
  /** Keys Claude's pick added. */
  aiKeys: readonly string[]
  /** Pasted or CSV rows. They join the pool and are selected. */
  pasted: readonly ImportCandidate[]
  /** Preview rows the user unticked. */
  off: readonly string[]
}

export interface ParseOutcome {
  rejected: readonly ImportRejection[]
  duplicates: number
  added: number
}

/** One market choice on step 3. `id` is null for a market typed on this screen. */
export interface MarketChoice {
  key: string
  id: string | null
  country: string
  language: string
  location: string | null
  device: MarketDevice
  localWording: boolean
  on: boolean
}

export interface TrackSettings {
  intervalDays: IntervalDays
  promptCount: number
  samples: SampleCount
  stagger: boolean
}
