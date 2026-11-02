/**
 * Click ids and Google result parameters that never change the page.
 * `utm_*` is matched by prefix below.
 */
const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'twclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'yclid',
  'igshid',
  'si',
  'srsltid',
  'ved',
  'sa',
  'usg',
  'ei',
  'sca_esv',
  'sxsrf'
])

/**
 * FR-6.1. Unwrap a Google `/url?q=` redirect, then store the scheme as https so
 * http and https of the same page match. Lowercase the host, strip www, drop the
 * fragment, drop tracking params, drop a trailing slash except the root, and
 * sort the remaining query. Returns null when the value is not a URL.
 */
export function normalizeUrl(raw: string): string | null {
  const url = parseWebUrl(raw)
  if (url === null) return null
  const target = unwrapGoogleRedirect(url) ?? url
  target.protocol = 'https:'
  target.hostname = target.hostname.toLowerCase().replace(/^www\./, '')
  target.hash = ''
  const video = videoIdFromUrl(target)
  if (video !== null) return `${YOUTUBE_WATCH}${video}`
  const params = [...target.searchParams.entries()].filter(([key]) => {
    const name = key.toLowerCase()
    return !name.startsWith('utm_') && !TRACKING_PARAMS.has(name)
  })
  params.sort((left, right) => {
    if (left[0] === right[0]) return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0
    return left[0] < right[0] ? -1 : 1
  })
  target.search = ''
  for (const [key, value] of params) target.searchParams.append(key, value)
  if (target.pathname !== '/') target.pathname = target.pathname.replace(/\/+$/, '') || '/'
  return target.toString()
}

const YOUTUBE_WATCH = 'https://youtube.com/watch?v='
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_VIDEO_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com'
])
const YOUTUBE_PATH_PREFIXES = ['shorts', 'embed', 'live', 'v', 'e']

/**
 * REPORT-SPEC §8. A YouTube video is one URL however it was linked: `youtu.be/<id>`,
 * `/shorts/<id>`, `/embed/<id>`, `/live/<id>` and `m.` hosts become `watch?v=<id>`,
 * and `t`, `si`, `vl`, `feature`, `pp`, `list` and every other parameter are dropped,
 * so a video cited at two timestamps counts once. Null when it is not a video URL.
 */
function videoIdFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter((part) => part.length > 0)
  let candidate: string | null = null
  if (host === 'youtu.be') candidate = parts[0] ?? null
  else if (YOUTUBE_VIDEO_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') candidate = url.searchParams.get('v')
    else if (parts.length === 2 && YOUTUBE_PATH_PREFIXES.includes(parts[0] ?? '')) {
      candidate = parts[1] ?? null
    }
  }
  return candidate !== null && VIDEO_ID.test(candidate) ? candidate : null
}

/** The 11-character video id of a YouTube video URL, or null (channel pages, other sites). */
export function youtubeVideoId(raw: string): string | null {
  const url = parseWebUrl(raw)
  return url === null ? null : videoIdFromUrl(url)
}

/** `https://youtube.com/watch?v=<id>`, the one stored form of a video URL. */
export function youtubeWatchUrl(videoId: string): string {
  return `${YOUTUBE_WATCH}${videoId}`
}

function parseWebUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url
}

/** `https://www.google.com/url?q=<page>` (or `url=`) is the page it points to. */
function unwrapGoogleRedirect(url: URL): URL | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) || url.pathname !== '/url') return null
  const inner = url.searchParams.get('q') ?? url.searchParams.get('url')
  return inner === null ? null : parseWebUrl(inner)
}

/** Host without a leading www, or '' when the value is not a URL. */
export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// The own-site rule is shared with the renderer's brand marks (src/shared/own-site.ts).
export { bareDomain, hostMatchesDomain } from '@shared/own-site'
