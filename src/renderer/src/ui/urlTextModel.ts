import { urlTextHref } from './componentModels'

/**
 * Pure helpers for UrlText (ui/UrlText.tsx): what is shown, what Copy and Open
 * use, which site's icon goes in front, and where a long label is cut.
 */

export type UrlTextVariant = 'url' | 'domain' | 'path'

export interface UrlTextTarget {
  /** What Copy copies, the tooltip shows and Open opens: always the full address when known. */
  href: string
  /** What is shown. */
  label: string
  /** The site whose icon goes in front, or null for none (a path with no site). */
  iconDomain: string | null
  /** False for a value Open cannot open (a path with no site, or not a web address). */
  openable: boolean
  variant: UrlTextVariant
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i
const WEB = /^https?:\/\//i

/** `https://www.example.com/a/` → `example.com/a/`. Other schemes are kept. */
export function displayAddress(url: string): string {
  if (!WEB.test(url)) return url
  const shown = url.replace(WEB, '').replace(/^www\./i, '')
  // A bare origin reads as a domain: `example.com/` → `example.com`.
  return /^[^/]+\/$/.test(shown) ? shown.slice(0, -1) : shown
}

/** The host of a web address, without `www.`; null when it is not one. */
export function hostOf(url: string): string | null {
  if (!WEB.test(url)) return null
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

/** A bare domain, a domain with a path, or a web address as typed: the full https URL. */
export function domainHref(domain: string): string {
  const trimmed = domain.trim()
  if (SCHEME.test(trimmed)) return trimmed
  return `https://${trimmed.replace(/^\/+/, '')}`
}

export interface ResolveInput {
  url?: string | undefined
  domain?: string | undefined
  path?: string | undefined
  site?: string | null | undefined
  label?: string | undefined
  variant?: UrlTextVariant | undefined
}

/**
 * Works out the href, label and icon for one value. `domain` wins over
 * `path`, which wins over `url`; `variant` only changes the look when given.
 */
export function resolveUrlText(input: ResolveInput): UrlTextTarget {
  const site = input.site ?? null
  if (input.domain !== undefined) {
    const href = domainHref(input.domain)
    const host = hostOf(href)
    return {
      href,
      label: input.label ?? displayAddress(input.domain.trim()),
      iconDomain: host,
      openable: host !== null,
      variant: input.variant ?? 'domain'
    }
  }
  const raw = (input.path ?? input.url ?? '').trim()
  const href = urlTextHref(raw, site)
  const host = hostOf(href)
  const isPath = input.path !== undefined || (!SCHEME.test(raw) && raw.startsWith('/'))
  const label = input.label ?? (isPath ? raw : displayAddress(raw))
  return {
    href,
    label,
    iconDomain: host,
    openable: host !== null,
    // A full URL shown as its path (`/pricing/`) reads as a path on the site.
    variant: input.variant ?? (isPath || label.startsWith('/') ? 'path' : 'url')
  }
}

/**
 * Labels at most this long are shown whole (one text node); longer ones are cut in the
 * middle, so a narrow cell keeps the end of the path (audit2 #5).
 */
export const MIDDLE_CUT_FROM = 20

export interface LabelParts {
  /** The domain, never cut while the path can give room. Empty for a path. */
  head: string
  /** The middle of the path: this part gives way first, with an ellipsis. */
  middle: string
  /** The last path segment, kept so the end of the address stays readable. */
  tail: string
}

/**
 * Where a long address is cut: `simpletexting.com/blog/a-long-slug/carriers/`
 * keeps the domain and the last segment and lets the middle shrink. Short
 * labels, and labels that are not addresses (a page title), return null.
 */
export function splitLabel(label: string): LabelParts | null {
  if (label.length <= MIDDLE_CUT_FROM) return null
  const isPath = label.startsWith('/')
  const domainLike = /^[a-z\d.-]+\.[a-z]{2,}(?::\d+)?\//i.test(label)
  if (!isPath && !domainLike) return null
  const slash = isPath ? 0 : label.indexOf('/')
  const head = label.slice(0, slash)
  const path = label.slice(slash)
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const lastSlash = trimmed.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const middle = path.slice(0, lastSlash)
  const tail = path.slice(lastSlash)
  return middle.length > 0 ? { head, middle, tail } : null
}

/** "Show in Finder" on a Mac, "Show in Explorer" on Windows, "Show in folder" elsewhere. */
export function revealLabel(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent
): string {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'Show in Finder'
  if (/Windows/i.test(userAgent)) return 'Show in Explorer'
  return 'Show in folder'
}
