import {
  CLORO_CREDITS,
  DEFAULT_SERPAPI_PLAN,
  ENGINE_IDS,
  MICROS_PER_USD,
  providerPlan,
  unitsCostMicros,
  type ApiKeyMetadata,
  type EngineId,
  type ProviderChoice,
  type SearchProvider
} from '@shared/domain'
import type { EngineCounts, EngineEstimate, EngineOption, ProjectEnginesView } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { formatCount } from '../../keys/serpUsage'
import { costText } from '../../engines/model'

/** The one line under each engine's name (Engines board, panel 1). */
export const ENGINE_NOTES: Readonly<Record<EngineId, { note: string }>> = {
  google_aio: { note: 'The answer box above Google’s results' },
  chatgpt: { note: 'With web search, as a logged-out user' },
  perplexity: { note: 'Answers with sources from the web' },
  google_ai_mode: { note: 'Google’s chat-style search' },
  gemini: { note: 'Google’s assistant' },
  copilot: { note: 'Microsoft’s assistant' }
}

/** What a row's chip says. */
export type EngineState = 'on' | 'off' | 'needs-cloro' | 'unavailable'

export function engineState(
  option: EngineOption,
  picked: boolean,
  counts: EngineCounts | undefined
): EngineState {
  if (!option.runnable) return 'needs-cloro'
  if (!picked) return 'off'
  // Every answer at the last check said the engine was down at cloro.
  if (counts && counts.checked > 0 && counts.unavailable === counts.checked) return 'unavailable'
  return 'on'
}

/** "About $0.005–0.006 per answer": cloro's credit range at the plan the key carries. */
export function cloroAnswerRange(planName: string | null): string {
  const plan = providerPlan('cloro', planName)
  const credits = ENGINE_IDS.map((engine) => CLORO_CREDITS[engine])
  const low = unitsCostMicros(Math.min(...credits), plan) / MICROS_PER_USD
  const high = unitsCostMicros(Math.max(...credits), plan) / MICROS_PER_USD
  return low === high ? `$${low.toFixed(3)}` : `$${low.toFixed(3)}–${high.toFixed(3)}`
}

/** "$0.03": one question on SerpApi is up to two searches (the overview's follow-up). */
export function serpPerQuestion(planName: string | null): string {
  const plan = providerPlan('serpapi', planName ?? DEFAULT_SERPAPI_PLAN)
  return costText(unitsCostMicros(2, plan))
}

/** The provider a card shows as picked: `auto` is whoever runs the search now. */
export function pickedProvider(view: ProjectEnginesView): SearchProvider {
  return view.provider === 'auto' ? view.activeProvider : view.provider
}

/** What Save sends for the provider: nothing when the pick is what `auto` already does. */
export function providerToSave(
  view: ProjectEnginesView,
  picked: SearchProvider
): ProviderChoice | undefined {
  return picked === pickedProvider(view) ? undefined : picked
}

/** The plan name on the first cloro key that is on, for prices. */
export function cloroPlanName(keys: readonly ApiKeyMetadata[]): string | null {
  return keys.find((key) => key.provider === 'cloro' && key.on)?.plan ?? null
}

export function sameEngines(a: readonly EngineId[], b: readonly EngineId[]): boolean {
  return a.length === b.length && a.every((engine, index) => engine === b[index])
}

/**
 * The cost line beside Save: the month first (what a budget is set against), then one
 * check of everything. "About 2,400 credits a month (≈ $1.90) · One check: 210 credits
 * (≈ $0.17) for 10 questions × 3 engines".
 */
export function costLines(
  estimate: EngineEstimate,
  engines: number
): { month: string; check: string } {
  if (estimate.pages === 0 || estimate.questions === 0) {
    return {
      month: 'Nothing to check yet.',
      check: 'Track a page or topic with questions to see what checks cost.'
    }
  }
  const google = estimate.byEngine.find((row) => row.engine === 'google_aio' && row.runnable)
  const serpSearches = estimate.provider === 'serpapi' && google ? google.searches : 0
  const cloroOnly = serpSearches === 0
  const month = estimate.perMonth
  const monthText = cloroOnly
    ? `About ${formatCount(month.credits)} credits a month (≈ ${costText(month.costMicros)})`
    : month.credits === 0
      ? `About ${formatCount(month.searches)} searches a month (≈ ${costText(month.costMicros)})`
      : `About ${costText(month.costMicros)} a month: ${formatCount(month.credits)} search credits plus searches`
  const check = estimate.perCheck
  const checkUnits = cloroOnly
    ? `${formatCount(check.credits)} credits`
    : check.credits === 0
      ? `${formatCount(serpSearches)} searches`
      : `${formatCount(serpSearches)} searches + ${formatCount(check.credits)} credits`
  const questions = pluralize(estimate.questions, 'question')
  return {
    month: monthText,
    check: `One check: ${checkUnits} (≈ ${costText(check.costMicros)}) for ${questions} × ${pluralize(engines, 'engine')}, each page and topic on its own schedule`
  }
}

/** "ChatGPT and Gemini are left out until a cloro key is saved." */
export function skippedLine(skipped: readonly string[]): string | null {
  if (skipped.length === 0) return null
  const names =
    skipped.length === 1
      ? skipped[0]
      : `${skipped.slice(0, -1).join(', ')} and ${skipped[skipped.length - 1]}`
  return `${names} ${skipped.length === 1 ? 'is' : 'are'} left out until a multi-engine search key is saved.`
}
