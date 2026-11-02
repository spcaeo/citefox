import type { CitationSourceType } from './domain'
import { builtInSiteKind } from './report/site-kinds'
import { hostMatches, sourceTypeOf } from './source-type'

/**
 * The type of a cited site, as the sources lists show it ("Type of site"). Who
 * owns it comes first: the own site, then a saved competitor. Everyone else is
 * sorted from the address alone, never by fetching the page:
 *
 * - communities and social networks, and reviews, from the FR-17.1 source type
 *   (`src/shared/source-type.ts`, stored with each Google reference), then the
 *   report's built-in video and social list (`report/site-kinds.ts`);
 * - news and media, docs and knowledge bases, directories and marketplaces from
 *   the host lists below (a subdomain matches its entry);
 * - `web` for any other website.
 */
export const SITE_TYPES = [
  'yours',
  'competitor',
  'community',
  'review',
  'news',
  'docs',
  'directory',
  'web'
] as const

export type SiteType = (typeof SITE_TYPES)[number]

export const SITE_TYPE_LABELS: Readonly<Record<SiteType, string>> = {
  yours: 'Your site',
  competitor: 'Competitor site',
  community: 'Community & social',
  review: 'Review site',
  news: 'News & media',
  docs: 'Docs & knowledge base',
  directory: 'Directory & marketplace',
  web: 'Other website'
}

/** One line on what each type means, for a tooltip. */
export const SITE_TYPE_HINTS: Readonly<Record<SiteType, string>> = {
  yours: 'A page on your own site.',
  competitor: 'A site of one of your saved competitors.',
  community: 'Forums, social networks and video sites, such as Reddit, Quora or YouTube.',
  review: 'Sites where buyers rate products, such as G2, Capterra or Trustpilot.',
  news: 'News sites, magazines and analysts.',
  docs: 'Encyclopedias, help centres and product documentation.',
  directory: 'Lists of companies and app stores, such as Clutch or the App Store.',
  web: 'A website that is none of the other types.'
}

/** News sites, magazines and analysts, with the name each goes by. */
const NEWS_SITES: Readonly<Record<string, string>> = {
  'forbes.com': 'Forbes',
  'techcrunch.com': 'TechCrunch',
  'theverge.com': 'The Verge',
  'wired.com': 'Wired',
  'zdnet.com': 'ZDNET',
  'techradar.com': 'TechRadar',
  'pcmag.com': 'PCMag',
  'cnet.com': 'CNET',
  'engadget.com': 'Engadget',
  'arstechnica.com': 'Ars Technica',
  'venturebeat.com': 'VentureBeat',
  'businessinsider.com': 'Business Insider',
  'nytimes.com': 'The New York Times',
  'wsj.com': 'The Wall Street Journal',
  'washingtonpost.com': 'The Washington Post',
  'usatoday.com': 'USA Today',
  'bloomberg.com': 'Bloomberg',
  'reuters.com': 'Reuters',
  'apnews.com': 'AP News',
  'axios.com': 'Axios',
  'cnn.com': 'CNN',
  'cnbc.com': 'CNBC',
  'nbcnews.com': 'NBC News',
  'cbsnews.com': 'CBS News',
  'abcnews.go.com': 'ABC News',
  'foxbusiness.com': 'Fox Business',
  'bbc.co.uk': 'BBC',
  'bbc.com': 'BBC',
  'theguardian.com': 'The Guardian',
  'ft.com': 'Financial Times',
  'economist.com': 'The Economist',
  'time.com': 'TIME',
  'theatlantic.com': 'The Atlantic',
  'marketwatch.com': 'MarketWatch',
  'news.yahoo.com': 'Yahoo News',
  'finance.yahoo.com': 'Yahoo Finance',
  'investopedia.com': 'Investopedia',
  'nerdwallet.com': 'NerdWallet',
  'hbr.org': 'Harvard Business Review',
  'inc.com': 'Inc.',
  'entrepreneur.com': 'Entrepreneur',
  'fastcompany.com': 'Fast Company',
  'techtarget.com': 'TechTarget',
  'computerworld.com': 'Computerworld',
  'infoworld.com': 'InfoWorld',
  'theregister.com': 'The Register',
  'mashable.com': 'Mashable',
  'gartner.com': 'Gartner',
  'forrester.com': 'Forrester',
  'idc.com': 'IDC',
  'mckinsey.com': 'McKinsey',
  'statista.com': 'Statista',
  'prnewswire.com': 'PR Newswire',
  'businesswire.com': 'Business Wire',
  'globenewswire.com': 'GlobeNewswire'
}

const DOCS_HOSTS = [
  'wikipedia.org',
  'wikihow.com',
  'britannica.com',
  'developer.mozilla.org',
  'readthedocs.io',
  'gitbook.io',
  'learn.microsoft.com',
  'github.com'
]

/** A subdomain that almost always holds documentation or a help centre. */
const DOCS_PREFIXES = [
  'docs.',
  'doc.',
  'developer.',
  'developers.',
  'help.',
  'support.',
  'kb.',
  'knowledge.',
  'learn.',
  'wiki.'
]

/** A first path part that holds documentation or a help centre on any site. */
const DOCS_PATHS = [
  'docs',
  'documentation',
  'help',
  'support',
  'kb',
  'knowledge-base',
  'knowledgebase',
  'help-center',
  'api-reference'
]

const DIRECTORY_HOSTS = [
  'clutch.co',
  'goodfirms.co',
  'designrush.com',
  'sourceforge.net',
  'alternativeto.net',
  'crunchbase.com',
  'wellfound.com',
  'f6s.com',
  'yellowpages.com',
  'bbb.org',
  'apps.apple.com',
  'play.google.com',
  'chromewebstore.google.com',
  'appexchange.salesforce.com',
  'marketplace.atlassian.com',
  'apps.shopify.com',
  'zapier.com',
  'wordpress.org',
  'upwork.com',
  'fiverr.com',
  'ebay.com',
  'etsy.com'
]

/** Amazon runs one store per country (`amazon.co.uk`, `amazon.de`). */
const DIRECTORY_BRANDS = ['amazon']

export interface SiteTypeInput {
  /** The cited address. */
  url: string
  /** On the project's own site (this page or another own page). */
  own: boolean
  /** A saved competitor's site. */
  competitor: boolean
  /** The stored FR-17.1 source type. Absent: read from the address. */
  sourceType?: CitationSourceType | null
}

/** The type of one cited site. */
export function siteTypeOf(input: SiteTypeInput): SiteType {
  if (input.own) return 'yours'
  if (input.competitor) return 'competitor'
  const parsed = parse(input.url)
  const source = input.sourceType ?? (parsed ? sourceTypeOf(parsed.href) : 'web')
  switch (source) {
    case 'reddit':
    case 'youtube':
    case 'linkedin':
    case 'forum':
    case 'other':
      return 'community'
    case 'review':
      return 'review'
    case 'web':
      return parsed ? webType(parsed.host, parsed.path) : 'web'
  }
}

/** The name of a news site, magazine or analyst (`Forbes`), or null for any other host. */
export function newsSiteName(host: string): string | null {
  const bare = host.toLowerCase().replace(/^www\./, '')
  const domain = Object.keys(NEWS_SITES).find((entry) => hostMatches(bare, entry))
  return domain === undefined ? null : (NEWS_SITES[domain] ?? null)
}

function webType(host: string, path: string): SiteType {
  if (builtInSiteKind(host) === 'video_social') return 'community'
  if (newsSiteName(host) !== null) return 'news'
  // Before docs: `zapier.com/apps` and app stores are listings, not help pages.
  if (isDirectory(host)) return 'directory'
  if (isDocs(host, path)) return 'docs'
  return 'web'
}

function isDirectory(host: string): boolean {
  if (DIRECTORY_HOSTS.some((domain) => hostMatches(host, domain))) return true
  const labels = host.split('.')
  return DIRECTORY_BRANDS.some((brand) => labels.slice(0, -1).includes(brand))
}

function isDocs(host: string, path: string): boolean {
  if (DOCS_HOSTS.some((domain) => hostMatches(host, domain))) return true
  if (DOCS_PREFIXES.some((prefix) => host.startsWith(prefix))) return true
  const first = path.split('/').find((part) => part.length > 0) ?? ''
  return DOCS_PATHS.includes(first)
}

function parse(url: string): { href: string; host: string; path: string } | null {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`)
    return {
      href: parsed.href,
      host: parsed.hostname.toLowerCase().replace(/^www\./, ''),
      path: parsed.pathname.toLowerCase()
    }
  } catch {
    return null
  }
}
