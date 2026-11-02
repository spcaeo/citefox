import type { CompanySuggestion } from '@shared/ipc'
import type { AddressLookup } from '../pipeline/fetch-guard'
import { lookupCompanyDomain, type HomepageReader } from './company-domain-lookup'
import { verifyCompetitorDomains } from './competitor-domains'
import {
  guardCompanyIdeas,
  type CompanyIdeas,
  type GuardedCompany,
  type GuardedIdeas,
  type ReadPage
} from './competitor-guard'

/** One small follow-up asking Claude (no search) for official domains, by company name. */
export type OfficialDomainAsker = (
  companies: readonly { name: string; reason: string }[]
) => Promise<ReadonlyMap<string, readonly string[]>>

type Source = CompanySuggestion['domainSource']

/**
 * The shared competitor groups ("Fill from my website" and topic seed discover): the
 * competitor rules in code (`competitor-guard.ts`), then
 *
 * - a DNS check on each competitor domain the pages show (no page fetch): kept as
 *   `site`; one that does not resolve is cleared;
 * - for a competitor whose domain is still unknown, a lookup (`company-domain-lookup.ts`)
 *   of Claude's candidates: the domain Claude gave, its `officialDomain`, or one follow-up
 *   (`askOfficialDomains`). Only a verified candidate is kept, as `lookup`.
 */
export async function guardFillCompanies(input: {
  ideas: CompanyIdeas
  pages: readonly ReadPage[]
  domain: string
  brandNames: readonly string[]
  seen: readonly string[]
  dns: AddressLookup
  createId: () => string
  askOfficialDomains?: OfficialDomainAsker
  readHomepage?: HomepageReader
}): Promise<{
  competitors: CompanySuggestion[]
  switchingFrom: CompanySuggestion[]
  integrations: CompanySuggestion[]
  dropped: GuardedIdeas['dropped']
}> {
  const guarded = guardCompanyIdeas(input.ideas, input.pages, {
    ownDomain: input.domain,
    brandNames: input.brandNames,
    seenDomains: input.seen
  })
  const competitors: { item: GuardedCompany; source: Source }[] = []
  for (const item of guarded.competitors) {
    if (item.domain === null) {
      competitors.push({ item, source: null })
      continue
    }
    const verified = await verifyCompetitorDomains({
      suggested: [{ domain: item.domain, reason: item.reason }],
      seen: input.seen,
      dns: input.dns
    })
    const kept = verified.kept[0]?.domain ?? null
    competitors.push({
      item: { ...item, domain: kept, checkDomain: item.checkDomain || kept === null },
      source: kept === null ? null : 'site'
    })
  }
  await lookUpUnknown(competitors, input)
  const withId =
    (prefix: string) =>
    ({ item, source }: { item: GuardedCompany; source: Source }): CompanySuggestion => ({
      id: `${prefix}-${input.createId()}`,
      name: item.name,
      domain: item.domain,
      domainSource: item.domain === null ? null : source,
      reason: item.reason,
      evidence: item.evidence,
      checkDomain: item.checkDomain
    })
  const fromSite = (item: GuardedCompany): { item: GuardedCompany; source: Source } => ({
    item,
    source: 'site'
  })
  return {
    competitors: competitors.map(withId('comp')),
    switchingFrom: guarded.switchingFrom.map(fromSite).map(withId('switch')),
    integrations: guarded.integrations.map(fromSite).map(withId('integ')),
    dropped: guarded.dropped
  }
}

async function lookUpUnknown(
  rows: { item: GuardedCompany; source: Source }[],
  input: {
    domain: string
    dns: AddressLookup
    askOfficialDomains?: OfficialDomainAsker
    readHomepage?: HomepageReader
  }
): Promise<void> {
  const unknown = rows.filter((row) => row.item.domain === null)
  if (unknown.length === 0) return
  const asked = unknown.filter((row) => row.item.candidates.length === 0)
  let answers: ReadonlyMap<string, readonly string[]> = new Map()
  if (asked.length > 0 && input.askOfficialDomains !== undefined) {
    try {
      answers = await input.askOfficialDomains(
        asked.map((row) => ({ name: row.item.name, reason: row.item.reason }))
      )
    } catch {
      // The lookup is a bonus: without it the domain stays unknown and the user can type it.
    }
  }
  const taken = new Set(rows.flatMap((row) => (row.item.domain === null ? [] : [row.item.domain])))
  for (const row of unknown) {
    const candidates = [...row.item.candidates, ...(answers.get(row.item.name) ?? [])]
    if (candidates.length === 0) continue
    const found = await lookupCompanyDomain({
      name: row.item.name,
      candidates,
      ownDomain: input.domain,
      dns: input.dns,
      taken,
      ...(input.readHomepage !== undefined ? { readHomepage: input.readHomepage } : {})
    })
    if (found === null) continue
    taken.add(found)
    row.item = { ...row.item, domain: found, checkDomain: false }
    row.source = 'lookup'
  }
}
