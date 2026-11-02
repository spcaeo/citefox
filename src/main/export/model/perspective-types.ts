import type { CitationChange } from '@shared/report/diff'
import type { VerdictFinding, VerdictSet, VerdictStatus, VerdictTone } from '@shared/report/verdict'

/**
 * The report's perspectives (Docs/REPORT-SPEC.md "Verdict", "What changed" and "How we
 * measured"): what the numbers say, what moved between the previous full check and the
 * latest one, and how the numbers were taken. Counts have the report `Count` shape.
 */

/** Same shape as the report `Count`; declared here so this file has no cycle. */
export interface PerspectiveCount {
  n: number
  drill: string | null
}

/** A clickable number inside a finding: the question set, its drawer title and its drill. */
export interface VerdictCountModel extends PerspectiveCount {
  set: VerdictSet
  label: string
}

export type VerdictPartModel = string | VerdictCountModel

export interface VerdictFindingModel {
  id: VerdictFinding['id']
  tone: VerdictTone
  /** The coloured lead phrase, such as "More answers cite you." */
  lead: string
  parts: readonly VerdictPartModel[]
}

/** The badge and three to five findings, by the fixed rules of `@shared/report/verdict`. */
export interface VerdictModel {
  status: VerdictStatus
  /** "Working, early signs". */
  label: string
  tone: VerdictTone
  /** "the 3 Oct 2026 check", or null without an earlier full check. */
  compareLabel: string | null
  /** Latest earlier full check and latest full check in scope. ISO-8601 UTC. */
  previousAt: string | null
  currentAt: string | null
  findings: readonly VerdictFindingModel[]
}

/** One question: its citation change and where it is cited from. */
export interface WhatChangedRow {
  rowId: string
  prompt: string
  pagePath: string
  marketId: string
  /** Null when there is no earlier full result or a search failed in either check. */
  change: CitationChange | null
  /** Citation position in the earlier and the latest check. 1-based. */
  positionBefore: number | null
  positionNow: number | null
  /** Path of the own URL the latest overview cites. Null when it cites none. */
  citedThrough: string | null
  /** The latest overview cites the question's own tracked page. Null when the search failed. */
  ownPageCited: boolean | null
}

/** Before vs after: each question's latest full check against the full check before it. */
export interface WhatChangedSection {
  empty: { title: string; message: string; nextStep: string | null } | null
  previousAt: string | null
  currentAt: string | null
  gained: PerspectiveCount
  kept: PerspectiveCount
  lost: PerspectiveCount
  never: PerspectiveCount
  /** No earlier full result, or a failed search: in no change count. */
  noEarlier: PerspectiveCount
  rows: readonly WhatChangedRow[]
}

/** Which evidence a recommendation rests on. */
export type RecommendationKind = 'competitor_gap' | 'wrong_page' | 'content_gap' | 'not_visible'

/** One question behind a recommendation: who Google cited instead of you, and which page. */
export interface RecommendationEvidence {
  rowId: string
  question: string
  /** The question's tracked page path, or the topic's title. */
  pagePath: string
  marketId: string
  /** A saved competitor's domain cited on this question. Null when none is. */
  competitor: string | null
  /** The page Google cited instead: your other page, the competitor's, or another site's. */
  citedUrl: string | null
  citedTitle: string | null
}

/** "What to do next": one recommendation, Do this / Why, and its evidence. */
export interface RecommendationModel {
  kind: RecommendationKind
  /** One line: what to change and where. */
  doThis: string
  /** One line: the observation behind it, with its count. */
  why: string
  /** Every question behind it; `evidence` shows the first few. */
  questions: PerspectiveCount
  evidence: readonly RecommendationEvidence[]
}

/** "How this report was made": what was searched and when, and how to read the numbers. */
export interface MethodSection {
  /** "Page · /pricing" or "Project · 4 tracked pages". */
  scopeLabel: string
  /** Set when fewer than `SMALL_SAMPLE` (`@shared/report/method`) questions were measured. */
  sampleWarning: string | null
  questions: PerspectiveCount
  /** Market ids in report order. */
  marketIds: readonly string[]
  trackedPages: number
  windowFrom: string | null
  windowTo: string | null
  previousAt: string | null
  currentAt: string | null
  copy: { cited: string; vary: string; partial: string; change: string }
  /**
   * A tracked page's own check and a topic check of the same wording in the same market:
   * how often they say the same about your citation. Null when no question has both.
   */
  agreement: { total: PerspectiveCount; agree: PerspectiveCount; percent: number } | null
}
