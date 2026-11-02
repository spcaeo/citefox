/**
 * Answer engines CiteFox checks (multi-engine tracking, owner decision 2026-10-24).
 *
 * Google AI Overview is the engine every project had before: its samples stay in
 * `serp_results` and every existing screen reads them. The other engines are answers
 * from cloro (https://cloro.dev), stored in `engine_answers`. SerpApi only reaches
 * Google AI Overview; cloro reaches all six with one key.
 */

import { isOneOf } from './one-of'

export const ENGINE_IDS = [
  'google_aio',
  'chatgpt',
  'perplexity',
  'google_ai_mode',
  'gemini',
  'copilot'
] as const

export type EngineId = (typeof ENGINE_IDS)[number]

/** Every engine but Google AI Overview: an answer with sources, from cloro only. */
export type AnswerEngineId = Exclude<EngineId, 'google_aio'>

export const ANSWER_ENGINE_IDS: readonly AnswerEngineId[] = [
  'chatgpt',
  'perplexity',
  'google_ai_mode',
  'gemini',
  'copilot'
]

/** What a project checks before anyone picks engines: today's behaviour. */
export const DEFAULT_ENGINES: readonly EngineId[] = ['google_aio']

export const ENGINE_LABEL: Readonly<Record<EngineId, string>> = {
  google_aio: 'Google AI Overview',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  google_ai_mode: 'Google AI Mode',
  gemini: 'Gemini',
  copilot: 'Copilot'
}

/** Short names for tight spots, such as a row's "Checking Google · ChatGPT…". */
export const ENGINE_SHORT_LABEL: Readonly<Record<EngineId, string>> = {
  google_aio: 'Google',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  google_ai_mode: 'AI Mode',
  gemini: 'Gemini',
  copilot: 'Copilot'
}

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && isOneOf(ENGINE_IDS, value)
}

export function isAnswerEngineId(value: unknown): value is AnswerEngineId {
  return isEngineId(value) && value !== 'google_aio'
}

/** The engines in display order, repeats and unknown values left out. */
export function normaliseEngines(values: readonly unknown[]): EngineId[] {
  const picked = new Set(values.filter(isEngineId))
  return ENGINE_IDS.filter((engine) => picked.has(engine))
}

/** Who answers the Google AI Overview search. Answer engines are always cloro. */
export const SEARCH_PROVIDERS = ['cloro', 'serpapi'] as const

export type SearchProvider = (typeof SEARCH_PROVIDERS)[number]

export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === 'string' && isOneOf(SEARCH_PROVIDERS, value)
}

/**
 * A project's provider setting. `auto` (the default) is cloro when a cloro key the
 * project may use is saved, else SerpApi.
 */
export const PROVIDER_CHOICES = ['auto', 'cloro', 'serpapi'] as const

export type ProviderChoice = (typeof PROVIDER_CHOICES)[number]

export function isProviderChoice(value: unknown): value is ProviderChoice {
  return typeof value === 'string' && isOneOf(PROVIDER_CHOICES, value)
}

/** The engines a provider can answer. */
export function engineOnProvider(engine: EngineId, provider: SearchProvider): boolean {
  return provider === 'cloro' || engine === 'google_aio'
}

/**
 * cloro credits for one sync call, from cloro's price list: base + the +2 sync
 * surcharge (Google: 3 base + 2 AI Overview + 2 sync). The real charge is read from
 * `X-Credits-Charged` and stored; this table is for estimates and a missing header.
 */
export const CLORO_CREDITS: Readonly<Record<EngineId, number>> = {
  google_aio: 7,
  chatgpt: 7,
  perplexity: 6,
  google_ai_mode: 6,
  gemini: 6,
  copilot: 7
}

/** One plan's price: `usd` buys `units` (cloro credits, SerpApi searches) a month. */
export interface ProviderPlanPrice {
  id: string
  label: string
  usd: number
  units: number
}

/**
 * cloro plans, by the plan name a cloro key carries (`api_keys.plan`, set by the user).
 * Only Lite's price is confirmed; any other name costs at the Lite rate.
 */
export const CLORO_PLANS: readonly ProviderPlanPrice[] = [
  { id: 'lite', label: 'Lite', usd: 30, units: 37_500 }
]

export const DEFAULT_CLORO_PLAN = 'lite'

/**
 * SerpApi plans by the plan name SerpApi reports (or the user typed), at SerpApi's public
 * list prices. A search costs `usd / units`. Unknown names cost at the Developer rate.
 */
export const SERPAPI_PLANS: readonly ProviderPlanPrice[] = [
  { id: 'free', label: 'Free', usd: 0, units: 250 },
  { id: 'starter', label: 'Starter', usd: 25, units: 1_000 },
  { id: 'developer', label: 'Developer', usd: 75, units: 5_000 },
  { id: 'production', label: 'Production', usd: 150, units: 15_000 },
  { id: 'big data', label: 'Big Data', usd: 275, units: 30_000 }
]

export const DEFAULT_SERPAPI_PLAN = 'developer'

/** Money is stored as whole micro-dollars (USD × 1,000,000) so sums stay exact. */
export const MICROS_PER_USD = 1_000_000

/** The plan a key's plan name points to, else the provider's default plan. */
export function providerPlan(provider: SearchProvider, planName: string | null): ProviderPlanPrice {
  const plans = provider === 'cloro' ? CLORO_PLANS : SERPAPI_PLANS
  const fallback = provider === 'cloro' ? DEFAULT_CLORO_PLAN : DEFAULT_SERPAPI_PLAN
  const wanted = (planName ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+plan$/u, '')
    .trim()
  const found = plans.find((plan) => plan.id === wanted)
  const plan = found ?? plans.find((item) => item.id === fallback)
  if (plan === undefined) throw new Error('provider plan table is empty')
  return plan
}

/** Micro-dollars for `units` (credits or searches) on a plan, rounded to the nearest micro. */
export function unitsCostMicros(units: number, plan: ProviderPlanPrice): number {
  if (units <= 0 || plan.units <= 0) return 0
  return Math.round((units * plan.usd * MICROS_PER_USD) / plan.units)
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD
}

/**
 * One engine answer as stored. `cited`: our domain is in the sources. `named`: our
 * brand is in the answer text but no source is ours. `no_answer`: the engine gave no
 * answer (a missing overview is normal, not an error). `unavailable`: the engine is
 * down at the provider (cloro `MODEL_UNAVAILABLE`); not charged, tried again at the next
 * check. `error`: the call failed.
 */
export const ENGINE_ANSWER_STATUSES = [
  'cited',
  'named',
  'not_cited',
  'no_answer',
  'unavailable',
  'error'
] as const

export type EngineAnswerStatus = (typeof ENGINE_ANSWER_STATUSES)[number]

export function isEngineAnswerStatus(value: unknown): value is EngineAnswerStatus {
  return typeof value === 'string' && isOneOf(ENGINE_ANSWER_STATUSES, value)
}
