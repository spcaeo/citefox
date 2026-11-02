import type { ChipTone } from '../ui'
import type { SourceKind } from './types'

/** Newest checks shown in "This prompt over time". One `checks:getPrompt` each. */
export const HISTORY_RUNS = 6

/** Chip tone for each source kind, in the sources grid and the overview's sources rail. */
export const KIND_TONE: Record<SourceKind, ChipTone> = {
  this_page: 'fox',
  own: 'info',
  competitor: 'warn',
  other: 'neutral'
}
