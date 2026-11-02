import type { Market } from '@shared/domain'
import type { QuestionTarget, QuestionTargets } from '@shared/ipc'

/** A tracked page a row can name, labelled by its path. */
export interface TargetPageOption {
  value: string
  label: string
  title: string
}

/** Every page (not topics) as a "page to be cited" choice, by path. */
export function pageOptions(data: QuestionTargets | null): TargetPageOption[] {
  if (data === null) return []
  return data.targets
    .filter(
      (item): item is QuestionTarget & { url: string } => item.kind === 'page' && item.url !== null
    )
    .map((item) => ({ value: item.url, label: pathOf(item.url), title: item.name }))
}

/** The markets the picked page or topic is checked in, in its own order. */
export function targetMarkets(
  data: QuestionTargets | null,
  target: QuestionTarget | null
): Market[] {
  if (data === null || target === null) return []
  return target.marketIds.flatMap((id) => data.markets.filter((market) => market.id === id))
}

/** The site's address from its tracked pages (`https://example.com`), or null. */
export function siteOf(data: QuestionTargets | null): string | null {
  const url = data?.targets.find((item) => item.url !== null)?.url ?? null
  if (url === null) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** A page's path and query (`/pricing/`), or the value as given when it is not a URL. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/** The typed address as a full URL: a path is put on the site's address. Null when empty. */
export function fullUrl(typed: string, site: string | null): string | null {
  const value = typed.trim()
  if (value === '') return null
  if (value.startsWith('/') && site !== null) return `${site.replace(/\/+$/u, '')}${value}`
  if (/^https?:\/\//iu.test(value)) return value
  if (/^[\w-]+(\.[\w-]+)+/u.test(value)) return `https://${value}`
  return value
}

/** Why the typed address cannot be added, or null. */
export function urlProblem(full: string | null, site: string | null): string | null {
  if (full === null) return null
  let parsed: URL
  try {
    parsed = new URL(full)
  } catch {
    return 'Not a web address. Type a full address or a path such as /pricing/.'
  }
  if (site !== null) {
    try {
      const own = new URL(site).hostname.replace(/^www\./u, '')
      const host = parsed.hostname.replace(/^www\./u, '')
      if (host !== own && !host.endsWith(`.${own}`)) {
        return `That page is on ${host}, not your site (${own}).`
      }
    } catch {
      return null
    }
  }
  return null
}
