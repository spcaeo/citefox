import {
  CLORO_CREDITS,
  ENGINE_IDS,
  ENGINE_LABEL,
  normaliseEngines,
  unitsCostMicros,
  type EngineId,
  type PageSummary,
  type ProviderChoice,
  type ProviderPlanPrice,
  type SearchProvider
} from '@shared/domain'
import type { EngineEstimate, EngineEstimateRow, EstimatePlan, SpendFigure } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { readPageEngines } from '../../storage/engine-records'
import { brandPromptsForCheck, brandPromptsForMarket } from '../sentiment/capture'
import { runnableEngines, selectedEngines } from '../checks/engines-plan'
import { marketPlans, promptsFromLatest } from '../checks/plan'
import type { EngineAccess } from './access'

/** Days a month of scheduled checks covers. */
const MONTH_DAYS = 30

export interface EstimateInput {
  db: SqliteDatabase
  projectId: string
  access: EngineAccess
  /** The pages and topics to price. */
  pages: readonly PageSummary[]
  /** True when `pages` were asked for by id (a preview then replaces their engines). */
  picked: boolean
  brands: readonly string[]
  engines: readonly EngineId[] | null
  provider: ProviderChoice | null
}

interface Tally {
  calls: number
  searches: number
  credits: number
  costMicros: number
}

/**
 * Prices checks before they are saved or run: every question × market × sample on
 * every engine, plus brand prompts on Google AI Overview. A Google sample is counted as
 * one search (SerpApi adds a second only when the overview needs a follow-up); cloro
 * credits come from its price list, the real charge is stored after each call.
 */
export function estimateEngines(input: EstimateInput): EngineEstimate {
  const provider = input.access.providerFor(input.provider)
  const cloroPlan = input.access.planFor('cloro')
  const serpPlan = input.access.planFor('serpapi')
  const perCheck = new Map<EngineId, Tally>()
  const perMonth = new Map<EngineId, Tally>()
  const used = new Set<EngineId>()
  const skipped = new Set<EngineId>()
  let questions = 0
  for (const page of input.pages) {
    const engines = enginesFor(input, page.id)
    for (const engine of engines) used.add(engine)
    const runnable = runnableEngines(engines, input.access.cloroReady)
    for (const engine of engines) if (!runnable.includes(engine)) skipped.add(engine)
    const markets = marketPlans(input.db, page.id, null, false, [])
    const prompts = promptsFromLatest(input.db, page.id, input.brands, null).prompts.length
    const pairs = prompts * markets.length
    questions += pairs
    const brandPrompts = runnable.includes('google_aio')
      ? brandPromptsForCheck(input.db, page.id, null)
      : []
    const brand = markets.reduce(
      (sum, market) => sum + brandPromptsForMarket(brandPrompts, market).length,
      0
    )
    const checksPerMonth = page.status === 'tracked' ? MONTH_DAYS / page.intervalDays : 0
    for (const engine of runnable) {
      const calls = pairs * page.samples + (engine === 'google_aio' ? brand : 0)
      const onCloro = engine !== 'google_aio' || provider === 'cloro'
      const credits = onCloro ? calls * CLORO_CREDITS[engine] : 0
      const tally: Tally = {
        calls,
        searches: calls,
        credits,
        costMicros: onCloro ? unitsCostMicros(credits, cloroPlan) : unitsCostMicros(calls, serpPlan)
      }
      add(perCheck, engine, tally, 1)
      add(perMonth, engine, tally, checksPerMonth)
    }
  }
  const byEngine: EngineEstimateRow[] = ENGINE_IDS.filter((engine) => used.has(engine)).map(
    (engine) => {
      const tally = perCheck.get(engine) ?? { calls: 0, searches: 0, credits: 0, costMicros: 0 }
      return {
        engine,
        label: ENGINE_LABEL[engine],
        calls: tally.calls,
        searches: tally.searches,
        credits: tally.credits,
        costMicros: tally.costMicros,
        runnable: !skipped.has(engine)
      }
    }
  )
  const needsCloro = byEngine.some(
    (row) => row.runnable && (row.engine !== 'google_aio' || provider === 'cloro')
  )
  const needsSerp = byEngine.some((row) => row.engine === 'google_aio' && provider === 'serpapi')
  return {
    projectId: input.projectId,
    provider,
    cloroReady: input.access.cloroReady,
    pages: input.pages.length,
    questions,
    perCheck: total(perCheck),
    perMonth: total(perMonth),
    byEngine,
    plans: [
      ...(needsCloro ? [planView('cloro', cloroPlan)] : []),
      ...(needsSerp ? [planView('serpapi', serpPlan)] : [])
    ],
    skipped: ENGINE_IDS.filter((engine) => skipped.has(engine))
  }
}

/** A preview replaces the engines of the pages asked for, or of pages that follow the project. */
function enginesFor(input: EstimateInput, pageId: string): EngineId[] {
  if (input.engines !== null && (input.picked || readPageEngines(input.db, pageId) === null)) {
    const preview = normaliseEngines(input.engines)
    if (preview.length > 0) return preview
  }
  return selectedEngines(input.db, pageId)
}

function add(into: Map<EngineId, Tally>, engine: EngineId, tally: Tally, times: number): void {
  const current = into.get(engine) ?? { calls: 0, searches: 0, credits: 0, costMicros: 0 }
  into.set(engine, {
    calls: current.calls + tally.calls * times,
    searches: current.searches + tally.searches * times,
    credits: current.credits + tally.credits * times,
    costMicros: current.costMicros + tally.costMicros * times
  })
}

function total(tallies: Map<EngineId, Tally>): SpendFigure {
  let searches = 0
  let credits = 0
  let costMicros = 0
  for (const tally of tallies.values()) {
    searches += tally.searches
    credits += tally.credits
    costMicros += tally.costMicros
  }
  return {
    searches: Math.round(searches),
    credits: Math.round(credits),
    costMicros: Math.round(costMicros)
  }
}

function planView(provider: SearchProvider, plan: ProviderPlanPrice): EstimatePlan {
  return { provider, label: plan.label, usd: plan.usd, units: plan.units }
}
