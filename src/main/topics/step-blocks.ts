import { inferProduct } from '@shared/domain'
import type { TopicDraft } from '@shared/domain'
import type { CompetitorScope } from '../engine/competitor-context'
import { buyerBlock, buyerFromTopicPoints, marketBlock } from '../prompts/blocks'
import type { SqliteDatabase } from '../storage/database'
import { listProducts } from '../storage/products'
import { getMarket, readProjectProfile } from '../storage/project-profile'
import { currentProfilePoints } from './drafts'

/**
 * Context blocks the keyword and competitor steps fill (Docs/PROMPT-AUDIT.md,
 * package P4), read from the draft and the project database and handed to the
 * builders in `prompts/blocks.ts`.
 */

/** `{{ market_block }}` for the chosen market, else the project's default market. */
export function marketBlockFor(db: SqliteDatabase, marketId: string | null): string {
  const market =
    (marketId === null ? null : getMarket(db, marketId)) ?? readProjectProfile(db)?.market ?? null
  if (market === null) return marketBlock({ country: 'US', language: 'en' })
  return marketBlock({
    country: market.country,
    language: market.language,
    location: market.location
  })
}

/**
 * What `competitorContext()` reads for a draft (PC): the product picked on the Seed
 * step (null: the whole business); else the saved topic's product; else, before the
 * topic exists, the product its seed points to, as the picker's Automatic would.
 */
export function topicScope(
  db: SqliteDatabase,
  draft: Pick<TopicDraft, 'topicId' | 'productId' | 'seed'>
): CompetitorScope {
  if (typeof draft.productId === 'string') return { productId: draft.productId }
  if (draft.productId === null) return {}
  if (draft.topicId !== null) return { topicId: draft.topicId }
  const inferred = inferProduct(listProducts(db), { text: draft.seed })
  return inferred.productId === null ? {} : { productId: inferred.productId }
}

/** `{{ buyer_block }}` from the topic profile: who, environment and, unless left out, triggers. */
export function topicBuyerBlock(draft: TopicDraft, options: { triggers?: boolean } = {}): string {
  const buyer = buyerFromTopicPoints(currentProfilePoints(draft))
  const block = buyerBlock(options.triggers === false ? { ...buyer, triggers: [] } : buyer)
  return options.triggers === false
    ? block
        .split('\n')
        .filter((line) => !line.startsWith('Triggers:'))
        .join('\n')
    : block
}
