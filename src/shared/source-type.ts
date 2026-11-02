import type { CitationSourceType } from './domain'

/**
 * FR-17.1. Source type of one cited reference, from its normalized URL alone.
 * No page is fetched and no search is made. `web` is an ordinary page; `other`
 * is a social network or video site that is not YouTube. Pure, so main (stored
 * with each reference) and the renderer (engine sources store none) read one rule.
 */
export function sourceTypeOf(normalizedUrl: string): CitationSourceType {
  let url: URL
  try {
    url = new URL(normalizedUrl)
  } catch {
    return 'other'
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname.toLowerCase()
  if (hostMatches(host, 'reddit.com') || host === 'redd.it') return 'reddit'
  if (YOUTUBE_HOSTS.some((domain) => hostMatches(host, domain))) return 'youtube'
  if (hostMatches(host, 'linkedin.com')) return 'linkedin'
  if (isReviewSite(host, path)) return 'review'
  if (isForum(host, path)) return 'forum'
  if (OTHER_HOSTS.some((domain) => hostMatches(host, domain))) return 'other'
  return 'web'
}

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

const REVIEW_HOSTS = [
  'g2.com',
  'trustpilot.com',
  'trustradius.com',
  'getapp.com',
  'softwareadvice.com',
  'sitejabber.com',
  'yelp.com',
  'producthunt.com',
  'peerspot.com',
  'saasworthy.com',
  'crozdesk.com'
]

/** Capterra and GetApp run one site per country (`capterra.co.uk`, `capterra.de`). */
const REVIEW_BRANDS = ['capterra', 'getapp', 'trustpilot']

const FORUM_HOSTS = [
  'quora.com',
  'stackexchange.com',
  'stackoverflow.com',
  'superuser.com',
  'serverfault.com',
  'askubuntu.com',
  'mathoverflow.net',
  'spiceworks.com',
  'news.ycombinator.com',
  'indiehackers.com',
  'answers.microsoft.com',
  'techcommunity.microsoft.com',
  'discussions.apple.com',
  'warriorforum.com',
  'blackhatworld.com'
]

/** A subdomain that almost always hosts a discussion forum (Discourse, Khoros, Vanilla). */
const FORUM_PREFIXES = [
  'forum.',
  'forums.',
  'community.',
  'communities.',
  'discuss.',
  'discussion.',
  'discussions.',
  'discourse.',
  'answers.',
  'talk.'
]

const OTHER_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'threads.net',
  'tiktok.com',
  'pinterest.com',
  'tumblr.com',
  'vimeo.com',
  'dailymotion.com'
]

function isReviewSite(host: string, path: string): boolean {
  if (REVIEW_HOSTS.some((domain) => hostMatches(host, domain))) return true
  const labels = host.split('.')
  if (REVIEW_BRANDS.some((brand) => labels.includes(brand))) return true
  return hostMatches(host, 'gartner.com') && path.startsWith('/reviews')
}

function isForum(host: string, path: string): boolean {
  if (FORUM_HOSTS.some((domain) => hostMatches(host, domain))) return true
  if (FORUM_PREFIXES.some((prefix) => host.startsWith(prefix))) return true
  if (hostMatches(host, 'github.com') && /^\/[^/]+\/[^/]+\/discussions(\/|$)/.test(path))
    return true
  return hostMatches(host, 'google.com') && host.startsWith('support.') && path.includes('/thread/')
}

/** True when `host` is `domain` or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export interface RedditThreadRef {
  /** `r/sysadmin`, or null for a short `redd.it` link. */
  subreddit: string | null
  /** The base-36 post id after `/comments/`. Null for a subreddit page. */
  threadId: string | null
}

/** Subreddit and post id of a Reddit URL. Null when the URL is not on Reddit. */
export function redditThreadOf(normalizedUrl: string): RedditThreadRef | null {
  let url: URL
  try {
    url = new URL(normalizedUrl)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'redd.it') {
    const id = url.pathname.split('/')[1] ?? ''
    return { subreddit: null, threadId: /^[a-z0-9]{1,12}$/i.test(id) ? id : null }
  }
  if (!hostMatches(host, 'reddit.com')) return null
  const parts = url.pathname.split('/').filter((part) => part.length > 0)
  const subIndex = parts.findIndex((part) => part.toLowerCase() === 'r')
  const sub = subIndex >= 0 ? parts[subIndex + 1] : undefined
  const commentsIndex = parts.findIndex((part) => part.toLowerCase() === 'comments')
  const id = commentsIndex >= 0 ? parts[commentsIndex + 1] : undefined
  return {
    subreddit: sub !== undefined && /^[A-Za-z0-9_]{2,32}$/.test(sub) ? `r/${sub}` : null,
    threadId: id !== undefined && /^[a-z0-9]{1,12}$/i.test(id) ? id : null
  }
}

const SITE_NAMES: Readonly<Record<string, string>> = {
  'community.spiceworks.com': 'Spiceworks Community',
  'spiceworks.com': 'Spiceworks',
  'quora.com': 'Quora',
  'stackoverflow.com': 'Stack Overflow',
  'superuser.com': 'Super User',
  'serverfault.com': 'Server Fault',
  'askubuntu.com': 'Ask Ubuntu',
  'news.ycombinator.com': 'Hacker News',
  'techcommunity.microsoft.com': 'Microsoft Tech Community',
  'answers.microsoft.com': 'Microsoft Community',
  'discussions.apple.com': 'Apple Community',
  'g2.com': 'G2',
  'capterra.com': 'Capterra',
  'trustpilot.com': 'Trustpilot',
  'trustradius.com': 'TrustRadius',
  'getapp.com': 'GetApp',
  'producthunt.com': 'Product Hunt',
  'github.com': 'GitHub Discussions'
}

/** A readable name for a forum or review site host. Unknown hosts are shown as the host. */
export function forumSiteLabel(host: string): string {
  const bare = host.toLowerCase().replace(/^www\./, '')
  const known = SITE_NAMES[bare]
  if (known !== undefined) return known
  if (bare.endsWith('.stackexchange.com')) return `Stack Exchange · ${bare.split('.')[0] ?? ''}`
  return bare
}
