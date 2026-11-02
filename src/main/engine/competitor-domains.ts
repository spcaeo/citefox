import { resolvePublicAddresses, type AddressLookup } from '../pipeline/fetch-guard'
import type { SqliteDatabase } from '../storage/database'

/**
 * "Fill from my website" asks Claude for competitor domains. Claude can misspell a
 * domain (the live run suggested textemall.com; the real one is text-em-all.com), so
 * every suggestion is checked before it is shown:
 *
 * 1. A domain that Google's AI Overviews already cited for this project is kept, and is
 *    preferred over a look-alike spelling (same letters, different hyphens or dots).
 * 2. Otherwise the domain must resolve to a public address through the same guarded
 *    DNS path page reads use (`resolvePublicAddresses`). No page is fetched.
 * 3. A domain that does not resolve, or resolves to a private address, is left out.
 */

export interface SuggestedCompetitor {
  domain: string
  reason: string
}

export interface VerifiedCompetitors {
  kept: SuggestedCompetitor[]
  /** Suggested domains left out because they do not resolve. */
  dropped: string[]
}

const SEEN_LIMIT = 40

/** Domains cited in this project's AI Overviews, most cited first. Own pages excluded. */
export function seenReferenceDomains(db: SqliteDatabase): string[] {
  const rows = db
    .prepare<unknown[], { domain: string }>(
      `SELECT domain, COUNT(*) AS cited
         FROM aio_references
        WHERE classification IN ('competitor', 'other')
        GROUP BY domain
        ORDER BY cited DESC, domain ASC
        LIMIT ?`
    )
    .all(SEEN_LIMIT)
  return rows.map((row) => bareDomain(row.domain)).filter((domain) => domain.length > 0)
}

/** Lowercase host without scheme, `www.`, port, path or trailing dot. */
export function bareDomain(value: string): string {
  let host = value.trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split(/[/?#]/)[0] ?? ''
  host = host.replace(/:\d+$/, '').replace(/\.$/, '')
  return host.startsWith('www.') ? host.slice(4) : host
}

/** Letters and digits only, so text-em-all.com and textemall.com match. */
function spellingKey(domain: string): string {
  return domain.replace(/[^a-z0-9]/g, '')
}

export async function verifyCompetitorDomains(input: {
  suggested: readonly SuggestedCompetitor[]
  seen: readonly string[]
  dns: AddressLookup
}): Promise<VerifiedCompetitors> {
  const seen = new Map(input.seen.map((domain) => [bareDomain(domain), domain] as const))
  const seenByKey = new Map([...seen.keys()].map((domain) => [spellingKey(domain), domain]))
  const kept: SuggestedCompetitor[] = []
  const dropped: string[] = []
  const used = new Set<string>()
  for (const suggestion of input.suggested) {
    const domain = bareDomain(suggestion.domain)
    if (domain.length === 0 || !domain.includes('.')) {
      dropped.push(suggestion.domain)
      continue
    }
    const match = seen.has(domain) ? domain : seenByKey.get(spellingKey(domain))
    const chosen = match ?? ((await resolves(domain, input.dns)) ? domain : null)
    if (chosen === null) {
      dropped.push(domain)
      continue
    }
    if (used.has(chosen)) continue
    used.add(chosen)
    kept.push({ domain: chosen, reason: suggestion.reason })
  }
  // Domains Google actually cites come first.
  const order = (domain: string): number => (seen.has(domain) ? 0 : 1)
  kept.sort((a, b) => order(a.domain) - order(b.domain))
  return { kept, dropped }
}

async function resolves(domain: string, dns: AddressLookup): Promise<boolean> {
  try {
    await resolvePublicAddresses(domain, dns)
    return true
  } catch {
    return false
  }
}
