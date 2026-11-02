import type { EngineId, PromptCheckStatus } from '@shared/domain'
import { cleanHost } from '@shared/competitor-hosts'
import type { MetricResult, MetricRow, MetricSegments } from '@shared/metrics'
import { sameTargetPage } from '@shared/target-page'
import { isOwnReference, type ScoredReference } from '@shared/topic-scoring'

/**
 * One stored outcome (a Google AI Overview check row, or an answer engine's outcome) as
 * a plain metrics row. The definitions are the Summary's (`engine/overview/measure.ts`):
 * an answer showed when the status is not `no_aio` or `error`; cited when that answer
 * links to a page of yours; named when the check found your brand in the answer text.
 */

/** What every stored outcome has: a Google check row and an answer engine outcome alike. */
export interface StoredOutcome {
  status: PromptCheckStatus | null
  references: readonly ScoredReference[]
  named: boolean | null
}

const ANSWERED = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

export function answered(outcome: StoredOutcome): boolean {
  return outcome.status !== null && ANSWERED.has(outcome.status)
}

function ownReferences(outcome: StoredOutcome): ScoredReference[] {
  return outcome.references
    .filter(isOwnReference)
    .sort((left, right) => left.position - right.position)
}

/**
 * The result. Null when the outcome has no status. `topicTarget`: a topic question's
 * target page (null: none yet); undefined for a tracked page's question, whose target
 * is the reference the check classified `target`.
 */
export function resultOf(outcome: StoredOutcome, topicTarget?: string | null): MetricResult | null {
  if (outcome.status === null) return null
  if (outcome.status === 'error') return 'failed'
  if (!answered(outcome)) return 'no_answer'
  const own = ownReferences(outcome)
  if (own.length === 0) return 'not_cited'
  if (topicTarget !== undefined) {
    return own.some((reference) => sameTargetPage(reference.url, topicTarget)) ? 'target' : 'other'
  }
  return own.some((reference) => reference.classification === 'target') ? 'target' : 'other'
}

/** Other sites the answer cites, each once, as bare hosts in source order. */
export function citedDomains(outcome: StoredOutcome): string[] {
  if (!answered(outcome)) return []
  const out: string[] = []
  for (const reference of [...outcome.references].sort((a, b) => a.position - b.position)) {
    if (isOwnReference(reference)) continue
    const host = cleanHost(reference.domain || reference.url)
    if (host.length > 0 && !out.includes(host)) out.push(host)
  }
  return out
}

/** Each other site's best source position in the answer, by bare host. */
export function sitePositionsOf(outcome: StoredOutcome): Record<string, number> {
  const out: Record<string, number> = {}
  if (!answered(outcome)) return out
  for (const reference of outcome.references) {
    if (isOwnReference(reference)) continue
    const host = cleanHost(reference.domain || reference.url)
    if (host.length === 0 || !Number.isFinite(reference.position)) continue
    const known = out[host]
    if (known === undefined || reference.position < known) out[host] = reference.position
  }
  return out
}

export const NO_SEGMENTS: MetricSegments = {
  topic: null,
  group: null,
  funnel: null,
  intent: null,
  pageType: null
}

export interface RowFacts {
  id: string
  questionId: string
  text: string
  engine: EngineId
  marketId: string
  sourceId: string
  sourceKind: 'page' | 'topic'
  checkId: string
  checkedAt: string
  segments?: MetricSegments
  /** Undefined for a page question (see {@link resultOf}). */
  topicTarget?: string | null
  /** Overrides the hosts read from the references (Summary counts sites by name). */
  domains?: readonly string[]
}

/** The metrics row of one outcome. Null when the outcome has no status. */
export function metricRowOf(outcome: StoredOutcome, facts: RowFacts): MetricRow | null {
  const result = resultOf(outcome, facts.topicTarget)
  if (result === null) return null
  const cited = result === 'target' || result === 'other'
  const own = cited ? ownReferences(outcome) : []
  const best = own[0] ?? null
  return {
    id: facts.id,
    questionId: facts.questionId,
    text: facts.text,
    engine: facts.engine,
    marketId: facts.marketId,
    sourceId: facts.sourceId,
    sourceKind: facts.sourceKind,
    checkId: facts.checkId,
    checkedAt: facts.checkedAt,
    result,
    citedUrl: best?.url ?? null,
    position: best?.position ?? null,
    ownUrls: [...new Set(own.map((reference) => reference.url))],
    domains: facts.domains ?? citedDomains(outcome),
    ...sitePositionsField(outcome, facts),
    named: answered(outcome) && outcome.named === true,
    segments: facts.segments ?? NO_SEGMENTS
  }
}

/** Positions are kept by host, so they are left out when `domains` names sites otherwise. */
function sitePositionsField(
  outcome: StoredOutcome,
  facts: RowFacts
): { sitePositions?: Record<string, number> } {
  if (facts.domains !== undefined) return {}
  const positions = sitePositionsOf(outcome)
  return Object.keys(positions).length === 0 ? {} : { sitePositions: positions }
}
