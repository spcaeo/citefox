import { cleanHost, competitorFor, type CompetitorHit } from '@shared/competitor-hosts'
import type { SqliteDatabase } from '../../storage/database'
import { competitorContext, type CompetitorContext } from '../competitor-context'

/**
 * Which cited hosts are competitors (Docs/PROMPT-AUDIT.md P9). One matcher for every
 * place that says "competitor": the classification a check stores, the leaderboard
 * badge, and the source labels in report and explanation prompts. A domain is never
 * "competitor" in the numbers and "other" in the text, or the reverse.
 *
 * - A check classifies against the competitors of the page's product (a topic: the
 *   topic's product), from `competitorContext()`, direct and partial alike. A page with
 *   no product, or a product with no saved competitors, reads the project-wide list.
 * - Readers of a stored check follow its stored classification, so an old run keeps
 *   what it was classified with; the matcher only names the competitor and its tier.
 */

// The host rule is pure and shared with the renderer (src/shared/competitor-hosts.ts).
export {
  competitorFor,
  hostIsCompetitor,
  isCompetitorHost,
  type CompetitorHit,
  type CompetitorTier
} from '@shared/competitor-hosts'

/** The competitors a page is judged against. */
export type CompetitorLists = Pick<CompetitorContext, 'direct' | 'partial'>

/** The competitors a check of this page (or topic) classifies against. */
export function checkCompetitors(
  db: SqliteDatabase,
  page: { id: string; kind?: 'page' | 'topic' }
): CompetitorLists {
  const context = competitorContext(
    db,
    page.kind === 'topic' ? { topicId: page.id } : { pageId: page.id }
  )
  return { direct: context.direct, partial: context.partial }
}

/**
 * A stored source as reports and explanations name it: null unless the check stored it
 * as a competitor, then the product's competitor it is (name and tier), else its domain
 * with no tier (an old run classified against a list that has since changed).
 */
export function storedCompetitor(
  reference: { domain?: string; url?: string; classification: string },
  lists: CompetitorLists
): CompetitorHit | null {
  if (reference.classification !== 'competitor') return null
  const host = cleanHost(reference.domain ?? hostFromUrl(reference.url ?? ''))
  return competitorFor(host, lists) ?? { name: host, tier: null }
}

/** "competitor: ClickSend, direct", or "competitor: clicksend.com" with no known tier. */
export function competitorLabel(hit: CompetitorHit): string {
  return hit.tier === null ? `competitor: ${hit.name}` : `competitor: ${hit.name}, ${hit.tier}`
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
