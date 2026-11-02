import type { MatchState, TopicPromptKind, TopicStage } from '@shared/domain'

/**
 * The "Topic coverage" section (Docs/TOPICS-SPEC.md section 5) for topic subjects: goal
 * bars per kind, the stage table, to-do counts and rows by match state, the keyword
 * universe tables, and an executive summary with the next three actions from saved
 * data. Counts are {@link TopicCount}s: `drill` names a report drill list (row ids)
 * when every prompt behind the number is a row of this report, else it is null.
 */

/** Same shape as the report `Count`; declared here so this file has no cycle. */
export interface TopicCount {
  n: number
  drill: string | null
}

export interface TopicCoverageGoal {
  kind: TopicPromptKind
  label: string
  prompts: number
  withAio: TopicCount
  cited: TopicCount
  rightPage: TopicCount
  otherPage: TopicCount
  named: TopicCount
  noAio: TopicCount
  failed: TopicCount
  notChecked: number
  /** Whole percent; null when no prompt showed an AI Overview. */
  rate: number | null
  bandLo: number
  bandHi: number
  bandState: 'below' | 'in' | 'above' | null
  toReachBand: number
}

export interface TopicCoverageStage {
  stage: TopicStage
  label: string
  questions: number
  aio: TopicCount
  cited: TopicCount
  rate: number | null
}

export interface TopicCoverageTodoRow {
  /** Q number (questions) or K number (keywords), as in the app. */
  number: number
  kind: TopicPromptKind
  text: string
  stage: string | null
  targetUrl: string | null
  /** Path of the target page, `/blog/x`. Null when there is no target. */
  targetPath: string | null
  citedInstead: readonly string[]
  winOdds: number | null
  winLevel: string | null
  /** Report row of this prompt, when the report holds it. */
  rowId: string | null
}

export interface TopicCoverageTodoGroup {
  state: MatchState
  label: string
  hint: string
  count: TopicCount
  rows: readonly TopicCoverageTodoRow[]
}

export interface TopicCoverageKeywordRow {
  key: string
  label: string
  /** For the by-group table: coverage or intent. */
  groupKind: string | null
  keywords: TopicCount
  aio: TopicCount
  cited: TopicCount
  named: TopicCount
  rate: number | null
}

export interface TopicCoverageAction {
  text: string
  /** A fact to re-check before acting, or null. */
  verify: string | null
}

export interface TopicCoverageTopic {
  topicId: string
  name: string
  /** "From a seed · 28 questions · 21 target pages · every 14 days". */
  sourceLine: string
  marketId: string
  marketLabel: string
  /** ISO-8601 UTC of the latest finished check in that market. */
  checkedAt: string | null
  /** The executive summary paragraph. */
  executive: string
  /** True when it is the saved Claude summary; false when built from the numbers. */
  executiveSaved: boolean
  /** ISO-8601 UTC when the saved summary was written. */
  executiveAt: string | null
  nextActions: readonly TopicCoverageAction[]
  /** Questions first, then keywords; a kind with no prompts is left out. */
  goals: readonly TopicCoverageGoal[]
  stages: readonly TopicCoverageStage[]
  /** In to-do order: page exists not cited, another page cited, no page yet, right page. */
  todo: readonly TopicCoverageTodoGroup[]
  keywords: {
    byGroup: readonly TopicCoverageKeywordRow[]
    byIntent: readonly TopicCoverageKeywordRow[]
    byFunnel: readonly TopicCoverageKeywordRow[]
    byPageType: readonly TopicCoverageKeywordRow[]
  }
}

export interface TopicCoverageSection {
  empty: { title: string; message: string; nextStep: string | null } | null
  topics: readonly TopicCoverageTopic[]
}
