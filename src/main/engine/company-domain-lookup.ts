import { resolvePublicAddresses, type AddressLookup } from '../pipeline/fetch-guard'
import { bareDomain } from './competitor-domains'
import { notCompetitorReason } from './project-settings/competitors'

/**
 * Docs/FEEDBACK.md batch 2 row 3: a competitor whose domain the site pages do not show
 * (Text-Em-All on textbolt.com) is looked up instead of left as "Domain unknown".
 *
 * Candidates come from Claude's own knowledge (the same call, or one small follow-up;
 * never a search). A candidate is only shown when it is verified:
 *
 * 1. it is a plain hostname, not the business's own domain, not a marketplace, review
 *    site or carrier;
 * 2. it resolves to a public address (the same guarded DNS path page reads use);
 * 3. its name part matches the brand (text-em-all.com for Text-Em-All), or else the
 *    homepage title or text names the brand (read without any search).
 *
 * Unverified candidates are never shown. When none passes, the domain stays unknown and
 * the user can type it (`projects:checkCompanyDomain`).
 */

export const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u

/** Most candidates tried per company. */
export const MAX_CANDIDATES = 3

export type HomepageReader = (domain: string) => Promise<{ title: string; text: string } | null>

/** Letters and digits only, lower case. */
function key(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** A bare, valid hostname (`https://www.Example.com/x` → `example.com`), else null. */
export function validHostname(value: string): string | null {
  const host = bareDomain(value)
  return host.length <= 253 && HOSTNAME.test(host) ? host : null
}

export async function resolvesPublicly(domain: string, dns: AddressLookup): Promise<boolean> {
  try {
    await resolvePublicAddresses(domain, dns)
    return true
  } catch {
    return false
  }
}

/** The domain's name part spells the brand: text-em-all.com for Text-Em-All, twilio.com for Twilio SMS. */
export function domainNamesBrand(domain: string, name: string): boolean {
  const full = key(name)
  const first = key(name.trim().split(/\s+/u)[0] ?? '')
  if (full.length < 3) return false
  const labels = domain.split('.').slice(0, -1).map(key)
  return labels.some(
    (label) =>
      label.length >= 3 &&
      (label === full ||
        (full.length >= 4 && label.includes(full)) ||
        (first.length >= 4 && label === first))
  )
}

/** The homepage title or opening text names the brand. */
export function pageNamesBrand(page: { title: string; text: string }, name: string): boolean {
  const corpus = key(`${page.title} ${page.text.slice(0, 4000)}`)
  const full = key(name)
  const first = key(name.trim().split(/\s+/u)[0] ?? '')
  return (
    (full.length >= 3 && corpus.includes(full)) || (first.length >= 4 && corpus.includes(first))
  )
}

/**
 * The first candidate that passes every check, or null. `taken` holds domains already
 * used by another row (each domain is shown once).
 */
export async function lookupCompanyDomain(input: {
  name: string
  candidates: readonly string[]
  ownDomain: string
  dns: AddressLookup
  readHomepage?: HomepageReader
  taken?: ReadonlySet<string>
}): Promise<string | null> {
  const own = bareDomain(input.ownDomain)
  const tried = new Set<string>()
  for (const candidate of input.candidates) {
    if (tried.size >= MAX_CANDIDATES) break
    const host = validHostname(candidate)
    if (host === null || tried.has(host)) continue
    tried.add(host)
    if (own.length > 0 && (host === own || host.endsWith(`.${own}`))) continue
    if (input.taken?.has(host)) continue
    if (notCompetitorReason(host, [], new Set()) !== null) continue
    if (!(await resolvesPublicly(host, input.dns))) continue
    if (domainNamesBrand(host, input.name)) return host
    if (input.readHomepage === undefined) continue
    const page = await input.readHomepage(host).catch(() => null)
    if (page !== null && pageNamesBrand(page, input.name)) return host
  }
  return null
}

/** `projects:checkCompanyDomain`: a domain the user typed for a row with an unknown domain. */
export async function checkTypedDomain(
  value: string,
  dns: AddressLookup
): Promise<{ ok: boolean; domain: string | null; message: string }> {
  const host = validHostname(value)
  if (host === null) {
    return { ok: false, domain: null, message: 'Enter a domain such as example.com.' }
  }
  if (!(await resolvesPublicly(host, dns))) {
    return {
      ok: false,
      domain: null,
      message: `${host} was not found. Check the spelling and try again.`
    }
  }
  return { ok: true, domain: host, message: `${host} found.` }
}
