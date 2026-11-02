import {
  DEFAULT_TOPIC_BANDS,
  TOPIC_STAGE_LABEL,
  type TopicBand,
  type TopicStage
} from '@shared/domain'
import type { QuestionRow, QuestionSource } from '@shared/ipc'
import { bandState, percent } from '@shared/topic-scoring'
import type { ChipTone } from '../../ui'

/**
 * Shared rules of the Topics screen, the Questions grouping and the New topic dialog
 * (Docs/TOPICS-SPEC.md §8). A topic's goal is the share of its buyer questions that
 * cite the own site, out of those that showed an AI Overview (keywords are scored
 * apart, so they are left out here), against the topic's band (default 50–70%).
 */

/** The group key of questions that sit on a page, not in a topic ("Not in a topic"). */
export const NOT_IN_TOPIC = 'not-in-topic'

export const NOT_IN_TOPIC_LABEL = 'Not in a topic'

/** The group key of questions with no stage, or no target page. */
export const NO_STAGE = 'no-stage'
export const NO_TARGET = 'no-target'

export const DEFAULT_QUESTION_BAND: TopicBand = DEFAULT_TOPIC_BANDS.questions

export type BandState = 'below' | 'in' | 'above'

/** Counts behind a cited share: one group of questions on its latest check. */
export interface ClusterStats {
  /** Buyer questions (keywords left out). */
  questions: number
  /** Questions whose latest check showed an AI Overview (the denominator). */
  withAio: number
  /** Of those, the own site was cited. */
  cited: number
  /** cited ÷ withAio in whole percent; null before an overview showed. */
  rate: number | null
  band: BandState | null
}

/** The goal of a group of rows (latest checks). Keywords do not count. */
export function clusterStats(
  rows: readonly QuestionRow[],
  band: TopicBand = DEFAULT_QUESTION_BAND
): ClusterStats {
  let questions = 0
  let withAio = 0
  let cited = 0
  for (const row of rows) {
    if (row.promptKind !== 'question') continue
    questions += 1
    if (row.overview === true) {
      withAio += 1
      if (row.cited === true) cited += 1
    }
  }
  const rate = percent(cited, withAio)
  return { questions, withAio, cited, rate, band: bandState(rate, band) }
}

/** The same counts on each question's previous check (before and after tables). */
export function previousStats(
  rows: readonly QuestionRow[],
  band: TopicBand = DEFAULT_QUESTION_BAND
): ClusterStats {
  let questions = 0
  let withAio = 0
  let cited = 0
  for (const row of rows) {
    if (row.promptKind !== 'question') continue
    questions += 1
    if (row.previous?.overview === true) {
      withAio += 1
      if (row.previous.cited === true) cited += 1
    }
  }
  const rate = percent(cited, withAio)
  return { questions, withAio, cited, rate, band: bandState(rate, band) }
}

export const BAND_LABEL: Readonly<Record<BandState, string>> = {
  in: 'In band',
  below: 'Below band',
  above: 'Above band'
}

export const BAND_TONE: Readonly<Record<BandState, ChipTone>> = {
  in: 'ok',
  below: 'warn',
  above: 'info'
}

/** "50–70%". */
export function bandText(band: TopicBand = DEFAULT_QUESTION_BAND): string {
  return `${band.lo}–${band.hi}%`
}

/** True when the row's page or topic is a topic. */
export function inTopic(
  row: Pick<QuestionRow, 'sourceId'>,
  sources: ReadonlyMap<string, QuestionSource>
): boolean {
  return sources.get(row.sourceId)?.kind === 'topic'
}

export function stageLabel(stage: TopicStage | null): string {
  return stage === null ? 'No stage' : TOPIC_STAGE_LABEL[stage]
}

/** `/pricing/` for a full URL; the text itself when it does not parse. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname || '/'}${parsed.search}`
  } catch {
    return url
  }
}

/** Every question of a topic, as the move and drill channels name them. */
export function refsOf(
  rows: readonly Pick<QuestionRow, 'sourceId' | 'promptId'>[]
): { sourceId: string; promptId: string }[] {
  return rows.map((row) => ({ sourceId: row.sourceId, promptId: row.promptId }))
}
