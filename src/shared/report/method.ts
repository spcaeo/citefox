import { normaliseQuestion } from '../question-text'
import { CITATION_CHANGE_DEFINITIONS } from './diff'

/**
 * "How this report was made" (Docs/REPORT-SPEC.md): the plain words every output uses to say
 * what was searched and how to read the numbers, plus the agreement between two
 * independent checks of the same questions (a tracked page's own prompts and a
 * topic's questions with the same wording, in the same market).
 */

/** The same wording a page prompt and a topic question share in one market. */
export function agreementKey(text: string, marketId: string): string {
  return `${marketId}|${normaliseQuestion(text)}`
}

/** One question's latest result from one kind of check. */
export interface AgreementItem<Id = string> {
  id: Id
  text: string
  marketId: string
  /** `page`: a tracked page's own prompt. `topic`: a topic's question. */
  source: 'page' | 'topic'
  cited: boolean
}

export interface Agreement<Id = string> {
  /** Questions both kinds of check measured. */
  total: number
  /** Of those, the ones where both say the same about your citation. */
  agree: number
  /** Whole percent, `agree ÷ total`. */
  percent: number
  /** Ids of the page-side results for the questions behind `total` and `agree`. */
  totalIds: readonly Id[]
  agreeIds: readonly Id[]
}

/**
 * Null when no question was measured by both a page check and a topic check, so the
 * line is only shown when the data exists. A side counts as cited when any of its
 * results for that question cites you.
 */
export function checkAgreement<Id>(items: readonly AgreementItem<Id>[]): Agreement<Id> | null {
  const groups = new Map<string, { page: AgreementItem<Id>[]; topic: AgreementItem<Id>[] }>()
  for (const item of items) {
    const key = agreementKey(item.text, item.marketId)
    if (key.endsWith('|')) continue
    const group = groups.get(key) ?? { page: [], topic: [] }
    group[item.source].push(item)
    groups.set(key, group)
  }
  const totalIds: Id[] = []
  const agreeIds: Id[] = []
  let total = 0
  let agree = 0
  for (const group of groups.values()) {
    const first = group.page[0]
    if (first === undefined || group.topic.length === 0) continue
    total += 1
    totalIds.push(first.id)
    const pageCited = group.page.some((item) => item.cited)
    const topicCited = group.topic.some((item) => item.cited)
    if (pageCited === topicCited) {
      agree += 1
      agreeIds.push(first.id)
    }
  }
  if (total === 0) return null
  return { total, agree, percent: Math.round((agree / total) * 100), totalIds, agreeIds }
}

/**
 * "Both checks agree on 9 of 10 questions (90%): …". The numbers stay in this order so
 * a renderer can swap them for clickable counts ({@link AGREEMENT_TAIL}).
 */
export function agreementLine(agreement: Pick<Agreement, 'agree' | 'total' | 'percent'>): string {
  return `Both checks agree on ${agreement.agree} of ${agreement.total} ${
    agreement.total === 1 ? 'question' : 'questions'
  } (${agreement.percent}%)${AGREEMENT_TAIL}`
}

/** What "both checks" are, after the counts. */
export const AGREEMENT_TAIL =
  ': a tracked page’s own check and a topic check searched the same wording in the same market, and say the same about whether you are cited.'

/** The fixed paragraphs, in order. Dynamic facts (questions, markets, dates) come first. */
export const METHOD_COPY = {
  cited:
    '“Cited” means a page on your domain is listed as a source of the AI Overview. “Named” means the answer text mentions your brand by name. Position is the source’s place in the overview’s list (1 is first).',
  vary: 'Google can give a different AI Overview to the same search on another day, device or location, so any single question can move by chance. The conclusions here rest on totals across every question, not on one result.',
  partial:
    'Only full checks count. A partial check (some questions re-run on their own) never enters a total, and a search that failed is left out of every rate.',
  change: `Before vs after compares each question’s latest full check with an earlier one in the same market. Gained: ${lowerFirst(CITATION_CHANGE_DEFINITIONS.gained)} Lost: ${lowerFirst(CITATION_CHANGE_DEFINITIONS.lost)} Kept: ${lowerFirst(CITATION_CHANGE_DEFINITIONS.kept)} Not cited: ${lowerFirst(CITATION_CHANGE_DEFINITIONS.never)}`
} as const

/** The last section of every report. */
export const METHOD_TITLE = 'How this report was made'

/** What every report measures, and what it does not. */
export const METHOD_SOURCE = 'Google AI Overviews only. Other AI answer engines are not checked.'

/** Below this many questions, one question moves a rate a lot. */
export const SMALL_SAMPLE = 10

/** The sample-size warning, or null at {@link SMALL_SAMPLE} questions or more. */
export function sampleWarning(questions: number): string | null {
  if (questions >= SMALL_SAMPLE || questions === 0) return null
  const noun = questions === 1 ? 'question was' : 'questions were'
  return `Small sample: only ${questions} ${noun} measured, so one question moves every rate a lot. Read the rates as early signs, not trends.`
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase() ?? ''}${value.slice(1)}`
}
