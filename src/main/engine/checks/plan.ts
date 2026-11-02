import type {
  BrandPrompt,
  EngineId,
  BuyerPrompt,
  IntentStage,
  MarketDevice,
  PromptSource
} from '@shared/domain'
import { readStoredPromptSet, type StoredCheckStep } from '../../storage/check-records'
import { getLatestPromptSet, getPromptSetVersion } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { listPageMarkets } from '../../storage/pages'
import { getMarket } from '../../storage/project-profile'

/** One page of a check job: its markets and the prompts searched in each. */
export interface PagePlan {
  pageId: string
  /** Null for a topic: it has no single URL, so any own-domain page counts. */
  url: string | null
  /**
   * A topic's target page (migration 047): a cited URL on it counts as the target.
   * Null for a page, and for a topic without one.
   */
  targetPage: string | null
  /** A topic's question → its pages (Primary + Also OK, or the topic's page). */
  promptTargets?: ReadonlyMap<string, readonly string[]>
  label: string
  samples: number
  defaultMarketId: string
  snapshotId: string
  contentHash: string
  promptSetId: string
  markets: MarketPlan[]
  prompts: PromptPlan[]
  /** FR-16.1. Sentiment only, searched after each market's buyer prompts. Empty on a follow-up. */
  brandPrompts: readonly BrandPrompt[]
  /** The engines this page is checked on, in display order. Never empty. */
  engines: readonly EngineId[]
}

export interface MarketPlan {
  id: string
  gl: string
  hl: string
  location: string | null
  device: MarketDevice
  addedAt: string
}

export interface PromptVariantPlan {
  marketId: string
  language: string
  text: string
}

export interface PromptPlan {
  id: string
  position: number
  label: string
  source: PromptSource
  intentStage: IntentStage
  /** Wording saved for each market, or the wording a resumed job already searched. */
  textByMarket: Map<string, string>
  /** Every saved variant, so a market without its own wording can borrow one in its language. */
  variants: readonly PromptVariantPlan[]
}

/** Page markets in link order. A resume keeps the markets the job already started. */
export function marketPlans(
  db: SqliteDatabase,
  pageId: string,
  marketIds: readonly string[] | null,
  resume: boolean,
  startedMarketIds: readonly string[]
): MarketPlan[] {
  const links = listPageMarkets(db, pageId)
  const selected = new Set<string>()
  const plans: MarketPlan[] = []
  const push = (marketId: string, addedAt: string): void => {
    if (selected.has(marketId)) return
    if (marketIds !== null && !marketIds.includes(marketId)) return
    const market = getMarket(db, marketId)
    if (market === null) return
    selected.add(marketId)
    plans.push({
      id: market.id,
      gl: market.country,
      hl: market.language,
      location: market.serpapiLocation ?? market.location,
      device: market.device,
      addedAt
    })
  }
  for (const link of links) push(link.marketId, link.addedAt)
  if (resume && marketIds === null) {
    for (const marketId of startedMarketIds) {
      const link = links.find((item) => item.marketId === marketId)
      push(marketId, link?.addedAt ?? '')
    }
  }
  return plans
}

export function promptsFromLatest(
  db: SqliteDatabase,
  pageId: string,
  brands: readonly string[],
  promptIds: readonly string[] | null
): { promptSetId: string; prompts: PromptPlan[] } {
  const promptSet = getLatestPromptSet(db, pageId, brands)
  return {
    promptSetId: promptSet?.promptSetId ?? '',
    prompts: selectPrompts(promptSet?.prompts ?? [], promptIds).map(toPlan)
  }
}

/**
 * A page that already has a run keeps that run's prompt set.
 * Step text wins when the job stored the wording it searched.
 * A page with no run yet still uses the current active set.
 */
export function promptsFromStored(
  db: SqliteDatabase,
  pageId: string,
  promptSetId: string,
  promptIds: readonly string[] | null,
  steps: readonly StoredCheckStep[]
): PromptPlan[] {
  const facts = readStoredPromptSet(db, promptSetId)
  const set = facts === null ? null : getPromptSetVersion(db, pageId, facts.version, [])
  if (set === null || set.promptSetId !== promptSetId) return []
  const listed = selectPrompts(set.prompts, promptIds, true)
  const byId = new Map(listed.map((prompt) => [prompt.id, toPlan(prompt)]))
  for (const step of steps) {
    if (step.pageId !== pageId || step.promptText.length === 0) continue
    byId.get(step.promptId)?.textByMarket.set(step.marketId, step.promptText)
  }
  return [...byId.values()].sort((left, right) => left.position - right.position)
}

/**
 * FR-8.6 wording for one market. The market's own variant first. Without one, a
 * variant in the same language, the page's default market first, so a search is
 * never sent in another language. Null when no variant shares the language: the
 * prompt is skipped in that market.
 */
export function wordingFor(
  prompt: PromptPlan,
  market: MarketPlan,
  defaultMarketId: string
): string | null {
  const own = prompt.textByMarket.get(market.id)
  if (own !== undefined && own.length > 0) return own
  const language = market.hl.toLowerCase()
  const same = prompt.variants.filter(
    (variant) => variant.language.toLowerCase() === language && variant.text.length > 0
  )
  return (same.find((variant) => variant.marketId === defaultMarketId) ?? same[0])?.text ?? null
}

/** No ids: the enabled prompts. With ids: those prompts, enabled ones only unless `anyListed`. */
function selectPrompts(
  prompts: readonly BuyerPrompt[],
  promptIds: readonly string[] | null,
  anyListed = false
): BuyerPrompt[] {
  return prompts.filter((prompt) => {
    if (promptIds === null) return prompt.enabled
    return (anyListed || prompt.enabled) && promptIds.includes(prompt.id)
  })
}

function toPlan(prompt: BuyerPrompt): PromptPlan {
  return {
    id: prompt.id,
    position: prompt.position,
    label: prompt.label,
    source: prompt.source,
    intentStage: prompt.intentStage,
    textByMarket: new Map(prompt.variants.map((variant) => [variant.marketId, variant.text])),
    variants: prompt.variants.map((variant) => ({
      marketId: variant.marketId,
      language: variant.language,
      text: variant.text
    }))
  }
}
