/**
 * The own-site rule (FR-6.5) in one place for main and the renderer: a host is the
 * project's own site when it is the own domain, or one of its subdomains when the
 * project counts them. The check classification ("This page", "Own page") and the
 * prompt page's yellow marks both read it, so they never disagree.
 */

export function bareDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/** Host equals the domain, or, when subdomains count, ends with `.<domain>`. */
export function hostMatchesDomain(
  host: string,
  domain: string,
  includeSubdomains: boolean
): boolean {
  const bare = bareDomain(domain)
  if (host === bare) return true
  return includeSubdomains && bare.length > 0 && host.endsWith(`.${bare}`)
}

/** FR-6.5. The own domain, and its subdomains when the project counts them. */
export function isOwnHost(host: string, ownDomain: string, includeSubdomains: boolean): boolean {
  return bareDomain(ownDomain).length > 0 && hostMatchesDomain(host, ownDomain, includeSubdomains)
}
