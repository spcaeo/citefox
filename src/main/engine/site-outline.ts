import type { PageAnchor } from '../pipeline/page-anchors'
import type { EngineHost } from './host'
import { readSitePage, type SitePageBody } from './site-page'

/**
 * The site's own pages beyond the fixed four, so the setup finds every offering a site
 * sells (a use case, an integration, a migration page). The home page's links pick the offering pages the site read opens next
 * (product, use-case, solution, integration, migration, industry pages) and give Claude
 * the site's menu, so an offering shows even when its page was not read. The last read
 * is kept per domain for the products section card. Pure except `siteOutlineFor`.
 */

/** One menu link: its words and its path on the site. */
export interface SiteLink {
  text: string
  path: string
}

/** One thing the site read found, with the page and the words that show it. */
export interface SiteFact {
  name: string
  path: string | null
  quote: string | null
}

/** What step 3's site read found on the pages, kept for the section prompts and checks. */
export interface SiteFacts {
  /** The names the site uses for itself, the main one first. */
  brands: readonly string[]
  /** Each product with the page and quote that show it. */
  products: readonly SiteFact[]
  /** Industries, roles, teams and use cases the pages say it is for. */
  audiences: readonly SiteFact[]
  /** Live products its pages compare it with or help buyers switch from. */
  comparedWith: readonly string[]
  switchingFrom: readonly SiteFact[]
  integrations: readonly SiteFact[]
}

/** What the setup sections are told about the site: the pages read, the menu, what the read found. */
export interface SiteOutline {
  pages: readonly { path: string; title: string }[]
  menu: readonly SiteLink[]
  /** The page text the site read saw (for the code checks); absent after a home-page-only read. */
  text?: string
  facts?: SiteFacts
}

/** The offering rule the site read and the products section card share. */
export const PRODUCT_RULE =
  'List each offering a buyer would look for on its own: a different job, a different buyer or a different situation, especially when the site gives it its own page (a use case, solution, integration or migration page). Plans, pricing tiers and features of one thing are one offering.'

/** Pages read after the home page and the fixed ones. */
export const EXTRA_PAGES_MAX = 8
/** Menu links shown to Claude. */
export const MENU_MAX = 40
/** Menu links under one first path segment (a long integrations list stays short). */
const MENU_PER_SECTION = 6

const SKIP_SEGMENT =
  /^(?:blogs?|news|articles?|posts?|press|media|events?|webinars?|podcasts?|stories|legal|privacy(?:-[a-z]+)?|terms(?:-of-(?:service|use))?|tos|cookies?(?:-policy)?|gdpr|dpa|imprint|impressum|security-policy|login|log-in|signin|sign-in|signup|sign-up|register|account|accounts|app|dashboard|portal|careers?|jobs|team|contact(?:-us)?|help|support|docs?|documentation|kb|knowledge-base|status|sitemap|feed|rss|tags?|category|categories|author|authors|page|search|cart|checkout|wp-content|wp-admin|wp-json|wp-includes|cdn-cgi|_next|assets?|static|images?|img|files?|uploads?|downloads?)$/u
const SKIP_FILE =
  /\.(?:pdf|png|jpe?g|gif|svg|webp|avif|ico|css|js|json|xml|txt|md|zip|mp4|mp3|webm|woff2?)$/iu

/**
 * First path segments that hold offerings, by how directly they name what is sold: the
 * score of a page under one, and how many pages under one the read may open.
 */
const OFFER_SECTIONS: readonly { pattern: RegExp; score: number; max: number }[] = [
  { pattern: /^(?:products?|solutions?|services?|platform|features?)$/u, score: 5, max: 4 },
  { pattern: /^(?:use-?cases?|integrations?|migrations?|migrate)$/u, score: 4, max: 2 },
  { pattern: /^(?:industr(?:y|ies)|for)$/u, score: 3, max: 2 }
]
/** A hub page (`/use-case/`) lists every offering under it: read it before its leaves. */
const HUB_SCORE = 6
/** Pricing and comparison pages: worth reading, after the offering pages. */
const PRICE_OR_COMPARE = /^(?:pricing|plans|compare|comparison|vs|alternatives?)$|-vs-|alternative/u
const OFFER_WORDS =
  /\b(?:products?|use cases?|solutions?|features?|integrations?|migrat\w*|industr(?:y|ies)|platform|services?|pricing|plans|compare|alternatives?)\b|\bvs\b/iu
/** Pages under one first segment that is not an offering section. */
const OTHER_MAX = 2

function bareHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/u, '')
    .replace(/^www\./u, '')
}

/** The cache key and same-site test for a domain (`www.` and case folded). */
export function siteKey(domain: string): string {
  return bareHost(domain.replace(/^https?:\/\//iu, '').split('/')[0] ?? '')
}

/** A path compared without case or a trailing slash. */
function pathKey(path: string): string {
  const lower = path.toLowerCase()
  return lower.length > 1 ? lower.replace(/\/+$/u, '') || '/' : lower
}

function skipped(path: string): boolean {
  if (SKIP_FILE.test(path)) return true
  return path
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some((segment) => SKIP_SEGMENT.test(segment.replace(/\.(?:html?|php|aspx?)$/u, '')))
}

/**
 * The home page's links on the same site, in page order, one per path: no blog, legal,
 * login or sign-up, careers, help, asset or query links, and not the home page itself.
 */
export function siteLinks(
  domain: string,
  body: Pick<SitePageBody, 'links' | 'anchors'>
): SiteLink[] {
  const own = siteKey(domain)
  const anchors: readonly PageAnchor[] =
    body.anchors ?? (body.links ?? []).map((url) => ({ text: '', url }))
  const seen = new Set<string>()
  const out: SiteLink[] = []
  for (const anchor of anchors) {
    let url: URL
    try {
      url = new URL(anchor.url)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (bareHost(url.hostname) !== own || !onlyTracking(url.searchParams)) continue
    const path = url.pathname
    const key = pathKey(path)
    if (key === '/' || skipped(path)) continue
    const known = seen.has(key)
    seen.add(key)
    if (known) {
      // A later link to the same page may carry the words the first (an icon) lacked.
      const first = out.find((link) => pathKey(link.path) === key)
      if (first !== undefined && first.text.length === 0) first.text = anchor.text
      continue
    }
    out.push({ text: anchor.text, path })
  }
  return out
}

/** Query keys that only tag where a click came from ("?src=zindex", "utm_source"). */
const TRACKING_KEY =
  /^(?:src|source|ref|referrer|from|campaign|cid|trk|_gl|gclid|fbclid|msclkid|hs[a-z]*|ga_[a-z]+|utm_[a-z_]+)$/iu

/** True for no query, or one that only tracks clicks (the page is the same without it). */
function onlyTracking(params: URLSearchParams): boolean {
  for (const key of params.keys()) if (!TRACKING_KEY.test(key)) return false
  return true
}

function segmentsOf(path: string): string[] {
  return path.toLowerCase().split('/').filter(Boolean)
}

function offerSection(segment: string): { score: number; max: number } | null {
  return OFFER_SECTIONS.find((section) => section.pattern.test(segment)) ?? null
}

/** How much a link looks like an offering page; 0 is never read. */
function offerScore(link: SiteLink): number {
  const segments = segmentsOf(link.path)
  const section = offerSection(segments[0] ?? '')
  let score = 0
  if (section !== null) score = segments.length === 1 ? HUB_SCORE : section.score
  else if (segments.slice(1).some((segment) => offerSection(segment) !== null)) score = 3
  if (segments.some((segment) => PRICE_OR_COMPARE.test(segment))) score = Math.max(score, 2)
  // A link elsewhere that says what it is ("Our products", "Pricing") ranks as a leaf.
  if (score < 3 && OFFER_WORDS.test(link.text)) score = Math.max(score, 2.5)
  if (score === 0 && segments.length === 1) score = 1
  return score
}

/**
 * Up to `max` more pages to read after the home page: hub pages of offering sections
 * first (`/use-case/`, `/integration/`), then pages under them (products and solutions
 * before use cases, integrations and migration, then industries), then pricing and
 * comparison pages, then other top-level pages. A few per section, so every kind of
 * offering gets a page; never a path already read.
 */
export function chooseSitePages(
  links: readonly SiteLink[],
  alreadyRead: readonly string[],
  max = EXTRA_PAGES_MAX
): string[] {
  const read = new Set(alreadyRead.map(pathKey))
  const ranked = links
    .map((link, order) => ({ link, order, score: offerScore(link) }))
    .filter((item) => item.score > 0 && !read.has(pathKey(item.link.path)))
    .sort((left, right) => right.score - left.score || left.order - right.order)
  const perSection = new Map<string, number>()
  const chosen: string[] = []
  for (const { link } of ranked) {
    if (chosen.length >= max) break
    const first = segmentsOf(link.path)[0] ?? ''
    const limit = offerSection(first)?.max ?? OTHER_MAX
    const count = perSection.get(first) ?? 0
    // A hub page counts toward its section, so the section still gets a leaf or two.
    if (count >= limit + (segmentsOf(link.path).length === 1 ? 1 : 0)) continue
    perSection.set(first, count + 1)
    chosen.push(link.path)
  }
  return chosen
}

/** The home page's menu for Claude: a few links per section, at most `MENU_MAX`. */
export function siteMenu(links: readonly SiteLink[]): SiteLink[] {
  const perSection = new Map<string, number>()
  const menu: SiteLink[] = []
  for (const link of links) {
    if (menu.length >= MENU_MAX) break
    const first = segmentsOf(link.path)[0] ?? ''
    const count = perSection.get(first) ?? 0
    if (count >= MENU_PER_SECTION) continue
    perSection.set(first, count + 1)
    menu.push(link)
  }
  return menu
}

/** "Gmail to text: /integration/gmail-to-text/" lines, at most `MENU_MAX`. */
export function menuLines(menu: readonly SiteLink[]): string[] {
  return menu
    .slice(0, MENU_MAX)
    .map((link) => (link.text.length > 0 ? `- ${link.text}: ${link.path}` : `- ${link.path}`))
}

/** The prompt block for the menu, or nothing when the home page had no links. */
export function menuBlock(menu: readonly SiteLink[]): string[] {
  const lines = menuLines(menu)
  return lines.length === 0 ? [] : ['Site menu (link text and path):', ...lines]
}

/** Keeps the latest read of a site for the section cards. */
export function rememberOutline(host: EngineHost, domain: string, outline: SiteOutline): void {
  host.memory.siteOutlines.set(siteKey(domain), outline)
}

/** Adds what the site read found to the kept outline (no outline: nothing to add to). */
export function rememberFacts(host: EngineHost, domain: string, facts: Partial<SiteFacts>): void {
  const key = siteKey(domain)
  const known = host.memory.siteOutlines.get(key)
  if (known === undefined) return
  const base: SiteFacts = known.facts ?? {
    brands: [],
    products: [],
    audiences: [],
    comparedWith: [],
    switchingFrom: [],
    integrations: []
  }
  host.memory.siteOutlines.set(key, { ...known, facts: { ...base, ...facts } })
}

/** The kept outline of a site, without reading anything. */
export function knownOutline(host: EngineHost, domain: string): SiteOutline | null {
  return host.memory.siteOutlines.get(siteKey(domain)) ?? null
}

/**
 * The site's pages and menu: the latest site read when this run made one, else the home
 * page read now (one guarded fetch, no Claude call). Null when the home page cannot be read.
 */
export async function siteOutlineFor(
  host: EngineHost,
  domain: string
): Promise<SiteOutline | null> {
  const key = siteKey(domain)
  if (key.length === 0) return null
  const known = host.memory.siteOutlines.get(key)
  if (known !== undefined) return known
  const body = await readSitePage(host, `https://${key}/`)
  if (body === null || body.text.trim().length === 0) return null
  const outline: SiteOutline = {
    pages: [{ path: '/', title: body.title }],
    menu: siteMenu(siteLinks(key, body))
  }
  host.memory.siteOutlines.set(key, outline)
  return outline
}
