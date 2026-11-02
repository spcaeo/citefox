import { cleanHost, isCompetitorHost } from '@shared/competitor-hosts'
import {
  kindTable,
  siteKindOf,
  type SiteKind,
  type SortableSiteKind
} from '@shared/report/site-kinds'
import { bareDomain } from '../../engine/checks/url'
import type { DrillRegistry } from './drills'
import { isAioStatus, toReference, uniqueReferences, type ScopeData } from './rows'
import type { ReportReference, SiteKindRow } from './types'

/**
 * Kinds of cited sites for the Competition section (Docs/REPORT-SPEC.md "Who else the
 * AI answers cite"), and what the previous full checks cited, for the faint earlier
 * bars. A saved competitor first, then the built-in host list, then Claude's stored
 * answer for the domain, else `other`.
 */

export interface SiteKindFacts {
  competitors: readonly string[]
  /** Claude's stored kinds by bare domain. */
  siteKinds: Readonly<Record<string, SortableSiteKind>>
}

/** The kind of one leaderboard domain. `competitor` is a reference classified so. */
export function domainKind(domain: string, competitor: boolean, facts: SiteKindFacts): SiteKind {
  const sorted = facts.siteKinds[domain] ?? facts.siteKinds[cleanHost(domain)] ?? null
  return siteKindOf({
    host: domain,
    competitor: competitor || isCompetitorHost(domain, facts.competitors),
    sorted
  })
}

/** What the previous full checks of the same pages and markets cited. */
export interface PreviousCitations {
  /** False when no page and market in scope has a previous full check. */
  any: boolean
  /** Prompts with an overview citing the domain, by leaderboard domain. */
  prompts: Map<string, number>
  /** Distinct cited URLs per prompt, summed, by leaderboard domain. */
  citations: Map<string, number>
  /** Domains with a reference classified as a competitor. */
  competitors: Set<string>
  /** Prompts citing your domain. */
  you: number
}

/**
 * `domainOf` folds a reference into its leaderboard domain (own pages into the own
 * domain); `isOwn` tells own references apart.
 */
export function previousCitations(
  scope: ScopeData,
  domainOf: (reference: ReportReference) => string,
  isOwn: (reference: ReportReference) => boolean
): PreviousCitations {
  const result: PreviousCitations = {
    any: false,
    prompts: new Map(),
    citations: new Map(),
    competitors: new Set(),
    you: 0
  }
  for (const slice of scope.slices) {
    if (slice.previous === null) continue
    result.any = true
    for (const row of slice.previous.prompts) {
      if (!isAioStatus(row.status)) continue
      if (row.status === 'page_cited' || row.status === 'other_own_page') result.you += 1
      const seen = new Set<string>()
      for (const source of uniqueReferences(row.references)) {
        const reference = toReference('', source)
        if (isOwn(reference)) continue
        const domain = domainOf(reference)
        result.citations.set(domain, (result.citations.get(domain) ?? 0) + 1)
        if (reference.classification === 'competitor') result.competitors.add(domain)
        if (seen.has(domain)) continue
        seen.add(domain)
        result.prompts.set(domain, (result.prompts.get(domain) ?? 0) + 1)
      }
    }
  }
  return result
}

/**
 * Other sites by kind: citations in the previous and the latest full checks, and the
 * prompts whose latest overview cites a site of that kind (a drill).
 */
export function buildKindRows(input: {
  scope: ScopeData
  ownDomain: string
  domainOf: (reference: ReportReference) => string
  isOwn: (reference: ReportReference) => boolean
  previous: PreviousCitations
  facts: SiteKindFacts
  drills: DrillRegistry
}): SiteKindRow[] {
  const own = bareDomain(input.ownDomain)
  const aioIds = new Set(input.scope.rows.filter((row) => row.aio).map((row) => row.id))
  const now = new Map<string, number>()
  const rowsOf = new Map<string, Set<string>>()
  const competitors = new Set(input.previous.competitors)
  for (const reference of input.scope.references) {
    if (!aioIds.has(reference.rowId) || input.isOwn(reference)) continue
    const domain = input.domainOf(reference)
    if (domain === own) continue
    now.set(domain, (now.get(domain) ?? 0) + 1)
    const rows = rowsOf.get(domain) ?? new Set<string>()
    rows.add(reference.rowId)
    rowsOf.set(domain, rows)
    if (reference.classification === 'competitor') competitors.add(domain)
  }
  const domains = new Set([...now.keys(), ...input.previous.citations.keys()])
  domains.delete(own)
  const kindOf = new Map(
    [...domains].map((domain) => [domain, domainKind(domain, competitors.has(domain), input.facts)])
  )
  const table = kindTable(
    [...domains].map((domain) => ({
      kind: kindOf.get(domain) ?? 'other',
      before: input.previous.any ? (input.previous.citations.get(domain) ?? 0) : null,
      now: now.get(domain) ?? 0
    }))
  )
  return table.map((row) => {
    const ids = new Set<string>()
    for (const [domain, rows] of rowsOf) {
      if (kindOf.get(domain) === row.kind) for (const id of rows) ids.add(id)
    }
    const ordered = input.scope.rows.filter((item) => ids.has(item.id)).map((item) => item.id)
    return { ...row, prompts: input.drills.count(`kind:${row.kind}`, ordered) }
  })
}
