import { competitorDomainOf } from './domain/products'

/**
 * The host half of the competitor matcher (Docs/PROMPT-AUDIT.md P9), pure so the
 * renderer reads the same rule as the check. `src/main/engine/checks/competitor-match.ts`
 * re-exports it with the reads that need the project database; that file stays the
 * one matcher every "competitor" goes through.
 */

export type CompetitorTier = 'direct' | 'partial'

/** A competitor as prompts name it. `domain` is null when it is not known. */
export interface CompetitorEntry {
  name: string
  domain: string | null
  /** Other domains of the same company. A host on one of them (or a subdomain) matches. */
  aliases?: readonly string[]
}

/** The competitors a page is judged against. */
export interface CompetitorTiers {
  direct: readonly CompetitorEntry[]
  partial: readonly CompetitorEntry[]
}

export interface CompetitorHit {
  name: string
  /** Null when a stored run says competitor but the product's list no longer has it. */
  tier: CompetitorTier | null
}

/**
 * True when the host is this competitor:
 *
 * - its domain, or a subdomain of it (`blog.twilio.com` is Twilio);
 * - or, by name, the host's site label: "SimpleTexting" or "Simple Texting" match
 *   `simpletexting.com` and `blog.simpletexting.com`, "Twilio" matches `twilio.co.uk`.
 *
 * A saved entry may be a plain string as the flat list holds it ("twilio.com",
 * "Twilio"); a string that is a domain matches as a domain.
 */
export function hostIsCompetitor(host: string, competitor: CompetitorEntry | string): boolean {
  const site = cleanHost(host)
  if (site.length === 0) return false
  const item =
    typeof competitor === 'string'
      ? { name: competitor, domain: competitorDomainOf(competitor) }
      : competitor
  const domain = item.domain === null ? competitorDomainOf(item.name) : cleanHost(item.domain)
  for (const alias of item.aliases ?? []) {
    const other = cleanHost(alias)
    if (other.length > 0 && (site === other || site.endsWith(`.${other}`))) return true
  }
  if (domain !== null && domain.length > 0) {
    if (site === domain || site.endsWith(`.${domain}`)) return true
    if (competitorDomainOf(item.name) !== null) return false
  }
  const name = flat(item.name)
  return name.length >= 3 && flat(siteLabel(site)) === name
}

/** The competitor this host belongs to, direct first, else null. */
export function competitorFor(host: string, lists: CompetitorTiers): CompetitorHit | null {
  for (const tier of ['direct', 'partial'] as const) {
    const item = lists[tier].find((entry) => hostIsCompetitor(host, entry))
    if (item !== undefined) return { name: item.name, tier }
  }
  return null
}

/** True when any listed competitor (a name, a domain or a saved row) is this host. */
export function isCompetitorHost(
  host: string,
  competitors: readonly (CompetitorEntry | string)[]
): boolean {
  return competitors.some((entry) => hostIsCompetitor(host, entry))
}

/** A host or URL as a bare lower-case host: no scheme, www., path, port or trailing dot. */
export function cleanHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/[/:?#].*$/u, '')
    .replace(/\.$/u, '')
}

const GENERIC_SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** `blog.simpletexting.com` → `simpletexting`; `textmagic.co.uk` → `textmagic`. */
function siteLabel(host: string): string {
  const parts = host.split('.').filter((part) => part.length > 0)
  if (parts.length < 2) return parts[0] ?? ''
  const second = parts[parts.length - 2] ?? ''
  if (parts.length >= 3 && GENERIC_SECOND_LEVEL.has(second)) return parts[parts.length - 3] ?? ''
  return second
}

/** Letters and digits only, lower case, accents folded: "AT&T" → "att". */
export function flatName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const flat = flatName
