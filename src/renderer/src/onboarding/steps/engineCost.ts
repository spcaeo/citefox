import {
  CLORO_CREDITS,
  engineOnProvider,
  normaliseEngines,
  providerPlan,
  unitsCostMicros,
  type ApiKeyMetadata,
  type EngineId,
  type ProviderPlanPrice,
  type SearchProvider
} from '@shared/domain'
import {
  PROMPT_SHAPES,
  type EngineEstimate,
  type EngineOption,
  type PromptMix,
  type SetupDraft
} from '@shared/ipc'
import { keptCount } from '../setupSteps'
import { costText } from '../../engines/model'

/**
 * Step 7's live cost line and step 8's "First check" note: questions × the ticked
 * engines' credits (cloro) or searches (SerpApi), and how often the check runs. The
 * project has no questions yet during setup, so the count comes from the draft.
 */

/** How many questions a first topic usually starts with, before step 8 writes them. */
export const TYPICAL_QUESTIONS = 10

/** Scheduled checks in 30 days: every day is 30, 7 days is 4, 14 days is 2, 60 days is half of one. */
export function checksPerMonth(everyDays: number): number {
  if (everyDays <= 0) return 0
  return everyDays <= 30 ? Math.floor(30 / everyDays) : 30 / everyDays
}

/** cloro credits for one question on one engine (the engines:get option, else cloro's list). */
export function engineCredits(engine: EngineId, options: readonly EngineOption[]): number {
  return options.find((option) => option.id === engine)?.credits ?? CLORO_CREDITS[engine]
}

/** The plan the estimate prices at, else the provider's default plan. */
export function planFor(
  provider: SearchProvider,
  estimate: EngineEstimate | null
): ProviderPlanPrice {
  const plan = estimate?.plans.find((item) => item.provider === provider)
  if (plan)
    return { id: plan.label.toLowerCase(), label: plan.label, usd: plan.usd, units: plan.units }
  return providerPlan(provider, null)
}

export interface CheckCost {
  questions: number
  answers: number
  /** Credits (cloro) or searches (SerpApi) for one check. */
  perCheck: number
  perMonth: number
  costMicros: number
  unit: 'credit' | 'search'
}

export function checkCost(input: {
  provider: SearchProvider
  engines: readonly EngineId[]
  options: readonly EngineOption[]
  questions: number
  everyDays: number
  plan: ProviderPlanPrice
}): CheckCost {
  const engines =
    input.provider === 'serpapi' ? input.engines.filter((e) => e === 'google_aio') : input.engines
  const perQuestion =
    input.provider === 'serpapi'
      ? engines.length
      : engines.reduce((sum, engine) => sum + engineCredits(engine, input.options), 0)
  const perCheck = input.questions * perQuestion
  const perMonth = Math.round(perCheck * checksPerMonth(input.everyDays))
  return {
    questions: input.questions,
    answers: engines.length,
    perCheck,
    perMonth,
    costMicros: unitsCostMicros(perMonth, input.plan),
    unit: input.provider === 'serpapi' ? 'search' : 'credit'
  }
}

function units(count: number, unit: CheckCost['unit']): string {
  const word = unit === 'credit' ? 'credit' : 'search'
  const plural = unit === 'credit' ? 'credits' : 'searches'
  return `${count.toLocaleString('en-US')} ${count === 1 ? word : plural}`
}

function times(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "10 prompts × 2 answers every 14 days ≈ 280 credits a month, about $0.22". */
export function monthlyLine(cost: CheckCost, everyDays: number): string {
  if (everyDays <= 0) {
    return `${times(cost.questions, 'prompt', 'prompts')} × ${times(cost.answers, 'answer', 'answers')} ≈ ${units(cost.perCheck, cost.unit)} each time you press Check now`
  }
  const every = everyDays === 1 ? 'every day' : `every ${everyDays} days`
  const head = `${times(cost.questions, 'prompt', 'prompts')} × ${times(cost.answers, 'answer', 'answers')} ${every}`
  return `${head} ≈ ${units(cost.perMonth, cost.unit)} a month, about ${costText(cost.costMicros)}`
}

/**
 * Said under the cost line when checks run every day: about 30 checks a month, so the
 * bill is a surprise unless it is spelled out. Null for any other choice.
 */
export function dailyCostNote(everyDays: number): string | null {
  if (everyDays !== 1) return null
  return `Every day runs about ${checksPerMonth(1)} checks a month, about 7 times what every 7 days uses.`
}

/** "First check: 10 prompts × 2 answers · 140 credits". */
export function firstCheckLine(cost: CheckCost): string {
  return `First check: ${times(cost.questions, 'prompt', 'prompts')} × ${times(cost.answers, 'answer', 'answers')} · ${units(cost.perCheck, cost.unit)}`
}

/** The engines a check runs with this provider: SerpApi reaches Google AI Overview only. */
export function effectiveEngines(
  engines: readonly EngineId[],
  provider: SearchProvider
): EngineId[] {
  return normaliseEngines(engines.filter((engine) => engineOnProvider(engine, provider)))
}

/** The questions the cost line counts: the kept ones, else a typical first topic. */
export function questionsToPrice(draft: SetupDraft): number {
  const kept = keptCount(draft, 'questions')
  return kept > 0 ? kept : TYPICAL_QUESTIONS
}

/** Credits (cloro) or searches (SerpApi) one prompt costs on the ticked engines. */
export function promptCost(
  provider: SearchProvider,
  engines: readonly EngineId[],
  options: readonly EngineOption[]
): number {
  const picked = effectiveEngines(engines, provider)
  return provider === 'serpapi'
    ? picked.length
    : picked.reduce((sum, engine) => sum + engineCredits(engine, options), 0)
}

/**
 * What the working keys of `provider` have left: cloro credits, or SerpApi searches this
 * month. Null when no working key has reported it yet (a key is read when it is tested).
 */
export function searchBalance(
  keys: readonly ApiKeyMetadata[],
  provider: SearchProvider
): number | null {
  let known = false
  let left = 0
  for (const key of keys) {
    if (key.provider !== provider || !key.on || key.state !== 'ok') continue
    if (key.cloroCredits) {
      known = true
      left += Math.max(0, key.cloroCredits.remaining)
    } else if (key.serpapiUsage && key.serpapiUsage.planLimit !== null) {
      known = true
      left += Math.max(0, key.serpapiUsage.planLimit - key.serpapiUsage.used)
    }
  }
  return known ? left : null
}

/**
 * The mix scaled down to `most` prompts in all, each shape keeping its share (rounded
 * down, the rest handed out to the largest shares first). A mix that fits is returned.
 */
export function fitMix(mix: PromptMix, most: number): PromptMix {
  const total = PROMPT_SHAPES.reduce((sum, shape) => sum + mix[shape], 0)
  const cap = Math.max(0, Math.floor(most))
  if (total <= cap) return mix
  const exact = PROMPT_SHAPES.map((shape) => ({ shape, share: (mix[shape] * cap) / total }))
  const out: Record<keyof PromptMix, number> = { search: 0, question: 0, situation: 0 }
  for (const { shape, share } of exact) out[shape] = Math.floor(share)
  let left = cap - PROMPT_SHAPES.reduce((sum, shape) => sum + out[shape], 0)
  for (const { shape } of [...exact].sort((a, b) => (b.share % 1) - (a.share % 1))) {
    if (left <= 0) break
    out[shape] += 1
    left -= 1
  }
  return out
}
