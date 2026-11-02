import { inferProduct, type TopicDraft } from '@shared/domain'
import {
  competitorContext,
  type CompetitorContext,
  type CompetitorScope,
  type NamedCompetitor
} from '../engine/competitor-context'
import { buyerBlock, buyerFromTopicPoints, languageName, marketBlock } from '../prompts/blocks'
import { listProducts } from '../storage/products'
import { getMarket, readProjectProfile } from '../storage/project-profile'
import { currentProfilePoints } from './drafts'
import type { OpenedProject, TopicEnv } from './env'
import { topicEvidence, type TopicEvidence } from './site'
import { pageCandidates } from './steps-pages'
import { namesBrand } from './text'

/**
 * Context the topic profile and journey steps share (Docs/PROMPT-AUDIT.md, P3):
 * the market block, the topic's competitors (contract C1), the compact buyer and
 * the topic's own pages as evidence. Each is built in code and passed as a template
 * variable, so templates stay editable.
 */

/** `{{ market_block }}` for the draft's first market (else the project's default). */
export function topicMarketBlock(opened: OpenedProject, draft: TopicDraft): string {
  const market = topicMarket(opened, draft)
  return market === null
    ? 'Market: not set. Write in English.'
    : marketBlock({ country: market.country, language: market.language, location: market.location })
}

/** The language name to write in, for steps that send no full market block. */
export function topicLanguage(opened: OpenedProject, draft: TopicDraft): string {
  const market = topicMarket(opened, draft)
  return market === null ? 'English' : languageName(market.language)
}

function topicMarket(
  opened: OpenedProject,
  draft: TopicDraft
): { country: string; language: string; location: string | null } | null {
  const id = draft.marketIds[0]
  return (
    (id === undefined ? null : getMarket(opened.db, id)) ??
    readProjectProfile(opened.db)?.market ??
    null
  )
}

/**
 * The scope the topic's competitors are read for (Docs/PROMPT-AUDIT.md PC): the
 * product picked on the Seed step; null for the whole business; automatic resolves
 * the saved topic's product, or, before it is saved, infers one from the seed.
 */
export function topicCompetitorScope(opened: OpenedProject, draft: TopicDraft): CompetitorScope {
  if (typeof draft.productId === 'string') return { productId: draft.productId }
  if (draft.productId === null) return {}
  if (draft.topicId !== null) return { topicId: draft.topicId }
  const inferred = inferProduct(listProducts(opened.db), {
    url: null,
    title: draft.name,
    text: draft.seed
  })
  return inferred.productId === null ? {} : { productId: inferred.productId }
}

/**
 * The topic's product's competitors (contract C1, `competitorContext` with the
 * topic's scope), with what the user marked on the draft as switch-from options and
 * integrations added, and the brand never listed.
 */
export function topicCompetitors(opened: OpenedProject, draft: TopicDraft): CompetitorContext {
  const context = competitorContext(opened.db, topicCompetitorScope(opened, draft))
  const merge = (left: readonly string[], right: readonly string[] | undefined): string[] => {
    const seen = new Set<string>()
    return [...left, ...(right ?? [])]
      .map((item) => item.trim())
      .filter((item) => {
        const key = item.toLowerCase()
        if (item.length === 0 || seen.has(key)) return false
        seen.add(key)
        return true
      })
  }
  const notBrand = (item: NamedCompetitor): boolean => !namesBrand(item.name, draft.brandNames)
  return {
    ...context,
    direct: context.direct.filter(notBrand),
    partial: context.partial.filter(notBrand),
    switchingFrom: merge(context.switchingFrom, draft.switchingFrom),
    integrations: merge(context.integrations, draft.integrations)
  }
}

/**
 * `{{ buyer_block }}` from the draft's current profile. `offset` starts each list
 * that many points in (wrapping round), so parallel journey stages each lead with a
 * different buyer, setting and trigger instead of all writing for the first one.
 */
export function topicBuyerBlock(draft: TopicDraft, offset = 0): string {
  const buyer = buyerFromTopicPoints(currentProfilePoints(draft))
  const turn = (items: readonly string[]): string[] => {
    const start = items.length === 0 ? 0 : offset % items.length
    return [...items.slice(start), ...items.slice(0, start)]
  }
  return buyerBlock({
    who: turn(buyer.who),
    environment: turn(buyer.environment),
    triggers: turn(buyer.triggers)
  })
}

/** The topic's own pages as evidence, from tracked pages, the sitemap and the key pages. */
export function draftEvidence(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft
): Promise<TopicEvidence> {
  const candidates = pageCandidates(opened.db, opened.project.id).candidates.map((candidate) => ({
    url: candidate.url,
    title: candidate.title,
    outline: candidate.outline,
    tracked: candidate.source === 'tracked'
  }))
  return topicEvidence(
    env.host,
    opened.db,
    opened.project.id,
    draft,
    candidates,
    opened.project.domain
  )
}

/**
 * A check that asks once and then accepts: the first reply with a problem gets one
 * retry with the problem named; whatever comes back after that is kept, and code
 * trims or fills what it can. A reply that fails the check twice never fails the step.
 */
export function askOnce<T>(problem: (value: T) => string | null): (value: T) => string | null {
  let asked = false
  return (value) => {
    if (asked) return null
    const found = problem(value)
    if (found !== null) asked = true
    return found
  }
}
