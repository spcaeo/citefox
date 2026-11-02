/**
 * Topic results read the `topics:results` contract as it is
 * (src/shared/ipc/topics.ts, src/shared/domain/topics.ts). Only the
 * renderer-side shapes live here.
 */
export type {
  KeywordUniverse,
  KeywordUniverseRow,
  MatchState,
  TopicBand,
  TopicGoal,
  TopicProgressPoint,
  TopicResultRow,
  TopicRowState,
  TopicStage,
  TopicStageCoverage,
  TopicSummary,
  TopicTodoGroup
} from '@shared/domain'
export type { TopicMeta, TopicResults } from '@shared/ipc'

/** A topic in the sidebar Topics list (the shell renders it). */
export interface TopicNavItem {
  id: string
  title: string
  /**
   * The headline on the latest check: target page cited ÷ searches with an AI Overview
   * (`TopicSummary.targetPct`). Null before the first check.
   */
  goalPct: number | null
  href: string
}
