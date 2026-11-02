import { newsSiteName } from './site-type'
import { forumSiteLabel, hostMatches, redditThreadOf } from './source-type'

/**
 * Who a cited site is to the project ("Who it is"), when it is neither the own site
 * nor a saved competitor. A known platform names its role and itself ("Community ·
 * Reddit r/msp"): Reddit, YouTube or G2 is where buyers talk, watch or compare, never
 * a product to beat, so it is never offered as a competitor. Any other site is
 * `neutral` until the user says otherwise. Read from the address alone, never by
 * fetching the page, so main and the renderer share one rule.
 */
export const SITE_ROLES = [
  'neutral',
  'community',
  'qa',
  'social',
  'video',
  'encyclopedia',
  'review',
  'media'
] as const

export type SiteRole = (typeof SITE_ROLES)[number]

/** The roles of a known platform: every role but `neutral`. */
export type PlatformRole = Exclude<SiteRole, 'neutral'>

export function isSiteRole(value: unknown): value is SiteRole {
  return typeof value === 'string' && (SITE_ROLES as readonly string[]).includes(value)
}

export const SITE_ROLE_LABELS: Readonly<Record<SiteRole, string>> = {
  neutral: 'Neutral',
  community: 'Community',
  qa: 'Q&A',
  social: 'Social',
  video: 'Video',
  encyclopedia: 'Encyclopedia',
  review: 'Review site',
  media: 'Media'
}

/** One line on what each role means, for a tooltip. */
export const SITE_ROLE_HINTS: Readonly<Record<SiteRole, string>> = {
  neutral: 'Not on your competitor list',
  community: 'A forum where buyers talk, such as Reddit.',
  qa: 'A question-and-answer site, such as Quora or Stack Overflow.',
  social: 'A social network, such as LinkedIn or X.',
  video: 'A video site, such as YouTube.',
  encyclopedia: 'An encyclopedia, such as Wikipedia.',
  review: 'A site where buyers rate products, such as G2 or Capterra.',
  media: 'A news site, magazine or analyst.'
}

/** A known platform a source is on: its role, its name and, when the address has it, where on it. */
export interface KnownPlatform {
  role: PlatformRole
  /** `Reddit`, `YouTube`, `G2`, `Forbes`. */
  name: string
  /** The subreddit (`r/msp`) or channel (`@acme`). Null when the address has none. */
  detail: string | null
}

interface PlatformEntry {
  domain: string
  role: PlatformRole
  name: string
}

/** Platforms by host; a subdomain matches its entry (`old.reddit.com`, `uk.linkedin.com`). */
const PLATFORMS: readonly PlatformEntry[] = [
  { domain: 'reddit.com', role: 'community', name: 'Reddit' },
  { domain: 'redd.it', role: 'community', name: 'Reddit' },
  { domain: 'youtube.com', role: 'video', name: 'YouTube' },
  { domain: 'youtu.be', role: 'video', name: 'YouTube' },
  { domain: 'youtube-nocookie.com', role: 'video', name: 'YouTube' },
  { domain: 'vimeo.com', role: 'video', name: 'Vimeo' },
  { domain: 'dailymotion.com', role: 'video', name: 'Dailymotion' },
  { domain: 'quora.com', role: 'qa', name: 'Quora' },
  { domain: 'stackoverflow.com', role: 'qa', name: 'Stack Overflow' },
  { domain: 'stackexchange.com', role: 'qa', name: 'Stack Exchange' },
  { domain: 'superuser.com', role: 'qa', name: 'Super User' },
  { domain: 'serverfault.com', role: 'qa', name: 'Server Fault' },
  { domain: 'askubuntu.com', role: 'qa', name: 'Ask Ubuntu' },
  { domain: 'mathoverflow.net', role: 'qa', name: 'MathOverflow' },
  { domain: 'answers.microsoft.com', role: 'qa', name: 'Microsoft Community' },
  { domain: 'linkedin.com', role: 'social', name: 'LinkedIn' },
  { domain: 'x.com', role: 'social', name: 'X' },
  { domain: 'twitter.com', role: 'social', name: 'X' },
  { domain: 'facebook.com', role: 'social', name: 'Facebook' },
  { domain: 'fb.com', role: 'social', name: 'Facebook' },
  { domain: 'instagram.com', role: 'social', name: 'Instagram' },
  { domain: 'threads.net', role: 'social', name: 'Threads' },
  { domain: 'tiktok.com', role: 'social', name: 'TikTok' },
  { domain: 'pinterest.com', role: 'social', name: 'Pinterest' },
  { domain: 'tumblr.com', role: 'social', name: 'Tumblr' },
  { domain: 'medium.com', role: 'social', name: 'Medium' },
  { domain: 'substack.com', role: 'social', name: 'Substack' },
  { domain: 'wikipedia.org', role: 'encyclopedia', name: 'Wikipedia' },
  { domain: 'britannica.com', role: 'encyclopedia', name: 'Britannica' },
  { domain: 'g2.com', role: 'review', name: 'G2' },
  { domain: 'trustpilot.com', role: 'review', name: 'Trustpilot' },
  { domain: 'trustradius.com', role: 'review', name: 'TrustRadius' },
  { domain: 'getapp.com', role: 'review', name: 'GetApp' },
  { domain: 'softwareadvice.com', role: 'review', name: 'Software Advice' },
  { domain: 'sitejabber.com', role: 'review', name: 'Sitejabber' },
  { domain: 'yelp.com', role: 'review', name: 'Yelp' },
  { domain: 'producthunt.com', role: 'review', name: 'Product Hunt' },
  { domain: 'peerspot.com', role: 'review', name: 'PeerSpot' },
  { domain: 'saasworthy.com', role: 'review', name: 'SaaSworthy' },
  { domain: 'crozdesk.com', role: 'review', name: 'Crozdesk' }
]

/** Review sites that run one site per country (`capterra.co.uk`, `trustpilot.de`). */
const REVIEW_BRANDS: Readonly<Record<string, string>> = {
  capterra: 'Capterra',
  getapp: 'GetApp',
  trustpilot: 'Trustpilot'
}

/** Hosts of a discussion forum: a known one, or a `forum.` / `community.` subdomain. */
const FORUM_HOSTS = [
  'spiceworks.com',
  'news.ycombinator.com',
  'indiehackers.com',
  'techcommunity.microsoft.com',
  'discussions.apple.com'
]

const FORUM_PREFIXES = [
  'forum.',
  'forums.',
  'community.',
  'communities.',
  'discuss.',
  'discussion.',
  'discussions.',
  'discourse.',
  'talk.'
]

/** The platform a cited address is on, or null for an ordinary website. */
export function knownPlatform(url: string): KnownPlatform | null {
  const parsed = parse(url)
  if (parsed === null) return null
  const { host, path, href } = parsed
  // Gartner's peer reviews are a review site; the rest of gartner.com is an analyst.
  if (hostMatches(host, 'gartner.com')) {
    return path.startsWith('/reviews')
      ? { role: 'review', name: 'Gartner Peer Insights', detail: null }
      : { role: 'media', name: 'Gartner', detail: null }
  }
  const entry = PLATFORMS.find((item) => hostMatches(host, item.domain))
  if (entry !== undefined) {
    return { role: entry.role, name: entry.name, detail: detailOf(entry, host, href, path) }
  }
  const brand = host.split('.').find((label) => REVIEW_BRANDS[label] !== undefined)
  if (brand !== undefined)
    return { role: 'review', name: REVIEW_BRANDS[brand] ?? brand, detail: null }
  if (
    FORUM_HOSTS.some((domain) => hostMatches(host, domain)) ||
    FORUM_PREFIXES.some((prefix) => host.startsWith(prefix))
  ) {
    return { role: 'community', name: forumSiteLabel(host), detail: null }
  }
  const news = newsSiteName(host)
  return news === null ? null : { role: 'media', name: news, detail: null }
}

/** The subreddit, YouTube channel or Stack Exchange site in the address. */
function detailOf(entry: PlatformEntry, host: string, href: string, path: string): string | null {
  if (entry.name === 'Reddit') return redditThreadOf(href)?.subreddit ?? null
  if (entry.name === 'YouTube') {
    const handle = /^\/(@[a-z0-9._-]{1,100})(\/|$)/i.exec(path)?.[1]
    return handle ?? null
  }
  if (entry.domain === 'stackexchange.com' && host !== 'stackexchange.com') {
    return host.split('.')[0] ?? null
  }
  return null
}

function parse(url: string): { href: string; host: string; path: string } | null {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`)
    return {
      href: parsed.href,
      host: parsed.hostname.toLowerCase().replace(/^www\./, ''),
      path: parsed.pathname
    }
  } catch {
    return null
  }
}

/** "Community · Reddit r/msp", "Video · YouTube", "Review site · G2". */
export function platformLabel(platform: Pick<KnownPlatform, 'role' | 'name' | 'detail'>): string {
  const detail = platform.detail ? ` ${platform.detail}` : ''
  return `${SITE_ROLE_LABELS[platform.role]} · ${platform.name}${detail}`
}
