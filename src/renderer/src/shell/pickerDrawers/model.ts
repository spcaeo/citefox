import { isApiKeyProvider, type ApiKeyProvider } from '@shared/domain'
import { addressOf } from '../../projects/addPageModel'
import { openDrawer, type OpenDrawerOptions } from '../drawers'

/**
 * The address the Track a page drawer saves: a path (`/pricing`), a bare
 * host path (`example.com/pricing`) or a full address, on the project's site.
 */
export function readTrackUrl(
  typed: string,
  domain: string,
  includeSubdomains: boolean
): { url: string | null; error: string | null } {
  if (typed.trim().length === 0) return { url: null, error: 'Enter the page’s address.' }
  let parsed: URL
  try {
    parsed = new URL(addressOf(typed, domain))
  } catch {
    return { url: null, error: 'Enter a path such as /pricing, or the page’s full address.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: null, error: 'Enter an http or https address.' }
  }
  const host = parsed.hostname.toLowerCase()
  const site = domain.toLowerCase()
  const own =
    host === site || host === `www.${site}` || (includeSubdomains && host.endsWith(`.${site}`))
  if (!own) return { url: null, error: `Only pages on ${domain} can be tracked here.` }
  return { url: parsed.toString(), error: null }
}

/** True for text the top bar can offer to track: a path, a host path or a full address. */
export function looksLikePageAddress(text: string): boolean {
  const value = text.trim()
  if (value.length < 2 || /\s/u.test(value)) return false
  if (value.startsWith('/')) return true
  return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/iu.test(value)
}

// The address typed in the top bar travels to the drawer here, not on the
// URL: drawer values are opaque ids only (drawerUrl.ts).
let pendingAddress: string | null = null

/** Opens Track a page, with an address to start from. */
export function openTrackPage(address?: string, options: OpenDrawerOptions = {}): void {
  pendingAddress = address?.trim() || null
  openDrawer('track-page', {}, options)
}

/** The address handed over by {@link openTrackPage}, once. */
export function takeTrackAddress(): string {
  const address = pendingAddress ?? ''
  pendingAddress = null
  return address
}

export const PROVIDER_LABEL: Readonly<Record<ApiKeyProvider, string>> = {
  serpapi: 'SerpApi',
  cloro: 'cloro',
  anthropic: 'Anthropic',
  jina: 'Jina',
  youtube: 'YouTube'
}

/** `key.provider` from the URL, or SerpApi. */
export function keyProviderOf(value: string | undefined): ApiKeyProvider {
  return value !== undefined && isApiKeyProvider(value) ? value : 'serpapi'
}
