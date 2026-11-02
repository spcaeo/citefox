import type { CheckCompanyDomainRequest, CheckCompanyDomainResult } from '@shared/ipc'

/** `projects:checkCompanyDomain`: DNS-checks a domain the user typed. */
export type CheckCompanyDomain = (
  request: CheckCompanyDomainRequest
) => Promise<CheckCompanyDomainResult>

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u

/** `https://www.Example.com/x` → `example.com`; null when it is not a hostname. */
export function typedHostname(value: string): string | null {
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .split(/[/?#]/u)[0]
    ?.replace(/:\d+$/u, '')
    .replace(/\.$/u, '')
    .replace(/^www\./u, '')
  return host !== undefined && host.length <= 253 && HOSTNAME.test(host) ? host : null
}
