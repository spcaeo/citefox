import {
  entryMatchesCompetitor,
  type BrandFact,
  type BrandPromptKind,
  type CitationClass,
  type CitationSourceType,
  type Market,
  type SentimentReference
} from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'
import type { NewSentimentClaim } from '../../storage/sentiment-records'
import { competitorBlock } from '../../prompts/blocks'
import { competitorContext, type CompetitorContext } from '../competitor-context'

/** Text for the brand-sentiment template variables (see `TEMPLATE_VARIABLES`). */

/**
 * The competitors a page's sentiment is read against: the direct and partial
 * competitors of the page's product (`competitorContext`), else the whole business.
 * `keys` keep the flat list's spelling, so stored claims match the sentiment view;
 * `aliases` let Claude name a competitor by its product name or domain.
 */
export interface PageCompetitors {
  context: CompetitorContext
  /** `{{ competitor_block }}` for `sentiment_claims_v2`. */
  block: string
  keys: string[]
  aliases: Map<string, string[]>
}

export function pageCompetitors(
  db: SqliteDatabase,
  pageId: string,
  flat: readonly string[]
): PageCompetitors {
  const context = competitorContext(db, { pageId })
  const keys: string[] = []
  const aliases = new Map<string, string[]>()
  for (const item of [...context.direct, ...context.partial]) {
    const key =
      flat.find((entry) => entryMatchesCompetitor(entry, item)) ?? item.domain ?? item.name
    if (keys.some((known) => known.toLowerCase() === key.toLowerCase())) continue
    keys.push(key)
    aliases.set(
      key,
      [item.name, item.domain].filter((name): name is string => name !== null && name !== key)
    )
  }
  return { context, block: competitorBlock(context, { withRule: false }), keys, aliases }
}

/** `{{ claims }}` for `sentiment_fact_check`: the own-brand claims, numbered from 0. */
export function claimsText(claims: readonly Omit<NewSentimentClaim, 'id'>[]): string {
  return claims
    .map((claim, index) =>
      [
        `${index}. [${claim.theme}] ${claim.attribute}`,
        `   Overview sentence: "${claim.sentence}"`,
        `   Cited URL: ${claim.url ?? 'none'}`
      ].join('\n')
    )
    .join('\n')
}

export const BRAND_PROMPT_KIND_LABEL: Readonly<Record<BrandPromptKind, string>> = {
  review: 'Reviews',
  pricing: 'Pricing',
  alternatives: 'Alternatives',
  comparison: 'Comparison',
  use_case: 'Use case'
}

/** "Spanish (es)", or the code alone when the runtime has no name for it. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
    return name !== undefined && name !== code ? `${name} (${code})` : code
  } catch {
    return code
  }
}

/** "US · Austin · desktop · English (en)", matching the market line in reports. */
export function marketText(market: Market | null): string {
  if (market === null) return 'none'
  const parts = [market.country, market.location, market.device, languageName(market.language)]
  return parts.filter((part): part is string => part !== null && part.length > 0).join(' · ')
}

export function factsText(facts: readonly BrandFact[]): string {
  if (facts.length === 0) return 'No brand facts yet.'
  return facts
    .map((fact) =>
      fact.source === null ? `- ${fact.text}` : `- ${fact.text} (source: ${fact.source})`
    )
    .join('\n')
}

export function referencesText(references: readonly SentimentReference[]): string {
  if (references.length === 0) return 'No cited sources.'
  return references
    .map(
      (reference) =>
        `${reference.position}. ${reference.title ?? reference.domain} — ${reference.url}`
    )
    .join('\n')
}

/** A stored reference, reduced to what sentiment needs. */
export function toSentimentReference(reference: {
  position: number
  url: string
  domain: string
  title: string | null
  classification: CitationClass
  sourceType: CitationSourceType
}): SentimentReference {
  return {
    position: reference.position,
    url: reference.url,
    domain: reference.domain,
    title: reference.title,
    classification: reference.classification,
    sourceType: reference.sourceType
  }
}
