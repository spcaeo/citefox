import { pluralize } from '@shared/pluralize'

/**
 * View-model for Progress sections the four shared channels do not return.
 * Populated values live in the harness fixture, not in this module.
 */

export function unchangedPromptsToggle(count: number, open: boolean): string {
  const prompts = pluralize(count, 'unchanged question')
  return open ? `Hide the ${prompts}` : `Show the ${prompts}`
}

export interface ChangeItem {
  id: string
  n: number
  label: string
  full: string
  detail: string
  extra: string
  extraMono: boolean
}

export interface ChangeGroup {
  title: string
  tone: 'up' | 'down' | 'named' | 'flat'
  count: number
  aria: string
  items: readonly ChangeItem[]
}

export interface UnchangedPrompt {
  id: string
  n: number
  label: string
  full: string
  note: string
}

export interface FixResultRow {
  id: string
  n: number
  full: string
  before: string
  after: string
  result: 'Worked' | 'No change' | 'Got worse'
}

export interface PromptHistoryRow {
  id: string
  n: number
  label: string
  full: string
  baseline: string
  oct5: string
  oct19: string
  fix1: boolean
  fix2: boolean
}

export interface MarketCheck {
  label: string
  value: string
}

export interface MarketTrend {
  name: string
  sep21: string
  oct5: string
  oct19: string
  /** Null where that market was not checked yet. */
  scores: readonly (number | null)[]
  delta: string
  tone: 'up' | 'down' | 'flat'
  aria: string
  checks: readonly MarketCheck[]
}

export interface FixTarget {
  id: string
  n: number
  label: string
  full: string
}

export interface ProgressDetail {
  changedHeading: string
  changedIntro: string
  groups: readonly ChangeGroup[]
  unchangedNote: string
  unchanged: readonly UnchangedPrompt[]
  fixIntro: string
  fix1Rows: readonly FixResultRow[]
  fixTargets: readonly FixTarget[]
  prompts: readonly PromptHistoryRow[]
  markets: readonly MarketTrend[]
  rateFootnote: string
}

export function changedPromptCount(detail: ProgressDetail): number {
  return detail.groups.reduce((sum, item) => sum + item.count, 0)
}

export function filterPromptRows<T extends { n: number; label: string; full: string }>(
  rows: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...rows]
  return rows.filter(
    (row) =>
      String(row.n) === needle ||
      row.label.toLowerCase().includes(needle) ||
      row.full.toLowerCase().includes(needle)
  )
}

export type FixFilter = 'all' | 'Worked' | 'No change' | 'Got worse' | 'Planned'

export function visibleFixRows(
  rows: readonly FixResultRow[],
  filter: FixFilter
): readonly FixResultRow[] {
  if (filter === 'all' || filter === 'Planned') return filter === 'Planned' ? [] : rows
  return rows.filter((row) => row.result === filter)
}

/** Latest score minus the previous check. Null previous is not treated as zero. */
export function marketDelta(scores: readonly (number | null)[]): number | null {
  const latest = scores[scores.length - 1]
  const previous = scores[scores.length - 2]
  if (latest === null || latest === undefined || previous === null || previous === undefined) {
    return null
  }
  return latest - previous
}
