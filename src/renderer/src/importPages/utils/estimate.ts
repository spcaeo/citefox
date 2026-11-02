import type { ImportEstimate } from '@shared/ipc'
import { pluralWord } from '@shared/pluralize'

export function fmt(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export interface EstimateInputs {
  pages: number
  /** Chosen pages that still need a page read, buyer profile, and prompts. */
  setupPages: number
  prompts: number
  markets: number
  samples: number
  intervalDays: number
  stagger: boolean
}

/** "N pages × p prompts × m markets × 1–2 searches = a–b searches per check". */
export function estimateFormula(inputs: EstimateInputs, estimate: ImportEstimate): string {
  const samples = inputs.samples > 1 ? ` × ${inputs.samples} samples` : ''
  return `${fmt(inputs.pages)} ${pluralWord(inputs.pages, 'page')} × ${inputs.prompts} ${pluralWord(inputs.prompts, 'question')} × ${inputs.markets} ${pluralWord(inputs.markets, 'market')}${samples} × 1–2 searches = ${fmt(estimate.minSearches)}–${fmt(estimate.maxSearches)} searches per check`
}

/** Fit and over notes, worded as in the mock-up. */
export function estimateNotes(
  inputs: EstimateInputs,
  estimate: ImportEstimate
): { fit: string | null; over: string | null } {
  if (estimate.maxSearches === 0) return { fit: 'Nothing to estimate yet.', over: null }
  const overNow = estimate.firstRoundFits === false
  const overPlan = estimate.monthlyFits === false
  const plan = estimate.monthlyPlan === null ? null : fmt(estimate.monthlyPlan)
  if (overNow && overPlan) {
    return {
      fit: null,
      over: `This is more than you have left this month and more than your ${plan ?? ''}-search plan each month. Try fewer pages, fewer questions per page, fewer markets, or a longer interval.`
    }
  }
  if (overNow) {
    return {
      fit: null,
      over: `The first round could use more than the ${fmt(estimate.searchesLeft ?? 0)} searches you have left this month. Pages that don't fit wait until your searches reset.`
    }
  }
  if (overPlan) {
    return {
      fit: null,
      over: `Later months could use more than your ${plan ?? ''}-search plan. Try a longer interval or fewer questions per page.`
    }
  }
  const perDay = inputs.stagger
    ? `about ${fmt(estimate.perDayMin)}–${fmt(estimate.perDayMax)} searches a day for the first week.`
    : 'all on the first day.'
  if (estimate.firstRoundFits === null) return { fit: `First round: ${perDay}`, over: null }
  return { fit: `Fits in what you have left this month: ${perDay}`, over: null }
}
