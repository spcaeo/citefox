import { brandNamed } from '@shared/brand-mentions'
import type { CitationClass, CitationSourceType, PromptCheckStatus } from '@shared/domain'
import { isOwnHost } from '@shared/own-site'
import { targetPageKey } from '@shared/target-page'
import { sourceTypeOf } from '../../communities/source-type'
import type { NamedCompetitor } from '../competitor-context'
import { isCompetitorHost } from './competitor-match'
import { hostOf, normalizeUrl } from './url'

export interface ClassifyReferenceInput {
  url: string
  title: string | null
}

export interface ClassifiedReference {
  position: number
  url: string
  normalizedUrl: string
  domain: string
  title: string | null
  classification: CitationClass
  untracked: boolean
  sourceType: CitationSourceType
}

export interface ClassifiedSample {
  status: PromptCheckStatus
  named: boolean | null
  citedUrl: string | null
  /** Position of the reference that decided `page_cited` or `other_own_page`. */
  position: number | null
  references: readonly ClassifiedReference[]
}

export interface ClassifyInput {
  failed: boolean
  hasAio: boolean
  aioText: string | null
  references: readonly ClassifyReferenceInput[]
  /** The page being checked. Null for a topic: no reference is `target`, own pages are `own`. */
  targetUrl: string | null
  /**
   * A topic's target page (migration 047). A cited URL on the same host and path is
   * `target`, ignoring the scheme, `www.`, a trailing slash, the query and the fragment;
   * other own pages stay `own`. Null or absent: the topic's own pages are all `own`.
   */
  targetPage?: string | null
  /**
   * A topic question's own pages (Primary + Also OK, src/main/topics/question-targets.ts).
   * When given it replaces `targetPage`: any of them is `target`; empty means no target.
   */
  targetPages?: readonly string[] | null
  ownDomain: string
  includeSubdomains: boolean
  brandNames: readonly string[]
  /**
   * The competitors of the page's product (a topic: the topic's product), direct and
   * partial, or the project-wide list when it has none (Docs/PROMPT-AUDIT.md P9).
   * Saved rows, or plain names and domains.
   */
  competitors: readonly (NamedCompetitor | string)[]
  /** Normalized URLs of pages that count as tracked (tracked, setting up, or paused). */
  trackedUrls: readonly string[]
}

/**
 * FR-6. Page cited beats another own page, which beats a brand mention, which
 * beats not cited. `named` is independent, and is null when there is no overview.
 */
export function classifySample(input: ClassifyInput): ClassifiedSample {
  const references = classifyReferences(input)
  if (input.failed) {
    return { status: 'error', named: null, citedUrl: null, position: null, references }
  }
  if (!input.hasAio) {
    return { status: 'no_aio', named: null, citedUrl: null, position: null, references: [] }
  }
  const named = brandNamed(input.aioText, input.brandNames)
  const target = references.find((reference) => reference.classification === 'target')
  if (target !== undefined) {
    return {
      status: 'page_cited',
      named,
      citedUrl: target.url,
      position: target.position,
      references
    }
  }
  const own = references.find((reference) => reference.classification === 'own')
  if (own !== undefined) {
    // A topic with no target page yet: any page of the site is the cited page.
    const noTarget =
      input.targetUrl === null &&
      (input.targetPages != null
        ? input.targetPages.length === 0
        : (input.targetPage ?? null) === null)
    return {
      status: noTarget ? 'page_cited' : 'other_own_page',
      named,
      citedUrl: own.url,
      position: own.position,
      references
    }
  }
  if (named) {
    return { status: 'brand_mentioned', named, citedUrl: null, position: null, references }
  }
  return { status: 'not_cited', named, citedUrl: null, position: null, references }
}

/**
 * FR-6.4. The brand counts as a whole word: "Box" is not named by "inbox".
 * Case and accents are folded, so "Rêve" matches "reve". A brand that starts or
 * ends with punctuation ("AT&T", "Booking.com") is still matched on its letters.
 * One rule with the prompt page's yellow marks (src/shared/brand-mentions.ts).
 */
export { brandNamed }

function classifyReferences(input: ClassifyInput): ClassifiedReference[] {
  const target = input.targetUrl === null ? null : normalizeUrl(input.targetUrl)
  const topicKeys = new Set(
    (input.targetPages ?? (input.targetPage ? [input.targetPage] : []))
      .map((url) => targetPageKey(url))
      .filter((key): key is string => key !== null)
  )
  const tracked = new Set(input.trackedUrls)
  const seen = new Set<string>()
  const references: ClassifiedReference[] = []
  for (const reference of input.references) {
    const normalized = normalizeUrl(reference.url)
    if (normalized === null || seen.has(normalized)) continue
    seen.add(normalized)
    const domain = hostOf(normalized)
    const classification =
      topicKeys.size > 0 && topicKeys.has(targetPageKey(normalized) ?? '')
        ? 'target'
        : classificationFor(normalized, domain, target, input)
    references.push({
      position: references.length + 1,
      url: reference.url,
      normalizedUrl: normalized,
      domain,
      title: reference.title,
      classification,
      untracked: classification === 'own' && !tracked.has(normalized),
      sourceType: sourceTypeOf(normalized)
    })
  }
  return references
}

function classificationFor(
  normalized: string,
  domain: string,
  target: string | null,
  input: ClassifyInput
): CitationClass {
  if (target !== null && normalized === target) return 'target'
  if (isOwnHost(domain, input.ownDomain, input.includeSubdomains)) return 'own'
  if (isCompetitorHost(domain, input.competitors)) return 'competitor'
  return 'other'
}

export { isOwnHost }
