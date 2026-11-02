import type { KeywordDepth } from '@shared/domain'
import type { TopicPlanOption } from '@shared/ipc'
import { SEARCHES_PER_PROMPT } from '../constants'

export interface Range {
  low: number
  high: number
}

/** Searches for `prompts` prompts in `markets` markets: 1–2 each. */
export function searchRange(prompts: number, markets = 1): Range {
  const n = Math.max(0, prompts) * Math.max(1, markets)
  return { low: n * SEARCHES_PER_PROMPT.low, high: n * SEARCHES_PER_PROMPT.high }
}

export function rangeText(low: number, high: number): string {
  if (low === high) return low.toLocaleString('en-US')
  return `${low.toLocaleString('en-US')}–${high.toLocaleString('en-US')}`
}

export type Fit = TopicPlanOption['fit']

export const FIT_LABEL: Readonly<Record<Fit, string>> = {
  fits: 'Fits',
  may_not_fit: 'May not fit',
  over_budget: 'Over budget',
  unknown: 'Unknown'
}

export const FIT_TONE: Readonly<Record<Fit, 'ok' | 'warn' | 'bad' | 'neutral'>> = {
  fits: 'ok',
  may_not_fit: 'warn',
  over_budget: 'bad',
  unknown: 'neutral'
}

/** Fits when the most it can use is left; over budget when even the least is not. */
export function fitFor(range: Range, left: number | null): Fit {
  if (left === null) return 'unknown'
  if (range.high <= left) return 'fits'
  if (range.low <= left) return 'may_not_fit'
  return 'over_budget'
}

/**
 * How many keywords a depth setting will likely produce before Claude runs:
 * patterns over each kept term and its synonyms, plus capped intent groups,
 * within the max. Shown live on Depth settings; the real count follows.
 */
export function keywordEstimate(settings: KeywordDepth, coreTerms: number): Range {
  const terms = Math.max(1, coreTerms)
  const coverage =
    terms * Math.max(1, settings.synonymsPerCoreTerm) * Math.max(1, settings.patternVariants.length)
  const intent = settings.intentFamilies.length * settings.perGroupCap
  const longTail = settings.longTailQuestions ? Math.round(intent * 0.25) : 0
  const high = Math.min(settings.maxKeywords, coverage + intent + longTail)
  const low = Math.min(high, Math.round(high * (settings.preset === 'deep' ? 0.5 : 0.85)))
  return { low, high }
}

/** Label of the Start button for a plan (Seed-Estimate.png). */
export function startLabel(plan: TopicPlanOption, stageLabel: string | null): string {
  if (plan.plan === 'likeliest') return `Start: ${plan.todayPrompts} likeliest today`
  if (plan.plan === 'stage_first')
    return `Start: check ${stageLabel ?? plan.firstGroup ?? 'one stage'}`
  if (plan.plan === 'stagger') return `Start: ${plan.todayPrompts} today`
  return `Start: check all ${plan.todayPrompts}`
}
