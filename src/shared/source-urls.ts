/**
 * URL facts for the sources section: YouTube video ids, subreddits and LinkedIn post kinds.
 * Pure parsing of the cited URL; nothing is fetched.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/

/** Query parameters that only change where a video starts or how it was shared. */
const VIDEO_NOISE_PARAMS = ['t', 'si', 'vl', 'feature', 'pp', 'start', 'ab_channel']

/**
 * The YouTube video id for a watch, `youtu.be`, `shorts`, `embed` or `live` URL, so
 * `?t=49` and share links count as the same video. Null for channels, playlists and
 * anything that is not a video.
 */
export function youtubeVideoId(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') id = url.searchParams.get('v')
    else if (
      parts[0] === 'shorts' ||
      parts[0] === 'embed' ||
      parts[0] === 'live' ||
      parts[0] === 'v'
    ) {
      id = parts[1] ?? null
    }
  }
  return id !== null && VIDEO_ID.test(id) ? id : null
}

/** `https://www.youtube.com/watch?v=<id>` for a video URL, the URL without noise params otherwise. */
export function normalizeVideoUrl(raw: string): string {
  const id = youtubeVideoId(raw)
  if (id !== null) return `https://www.youtube.com/watch?v=${id}`
  try {
    const url = new URL(raw)
    for (const name of VIDEO_NOISE_PARAMS) url.searchParams.delete(name)
    return url.toString()
  } catch {
    return raw
  }
}

/** The subreddit of a Reddit URL in its canonical case-folded form, `r/sysadmin`. Null otherwise. */
export function subredditOf(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0]?.toLowerCase() !== 'r' || parts[1] === undefined) return null
    return `r/${parts[1].toLowerCase()}`
  } catch {
    return null
  }
}

/** A Reddit thread URL without the comment slug and query, so one thread counts once. */
export function redditThreadUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const parts = url.pathname.split('/').filter(Boolean)
    const at = parts.findIndex((part) => part.toLowerCase() === 'comments')
    if (at === -1 || parts[at + 1] === undefined) return `${url.origin}${url.pathname}`
    return `https://www.reddit.com/${parts.slice(0, at + 2).join('/')}/`
  } catch {
    return raw
  }
}

/** LinkedIn `/posts/` and `/feed/update/` are posts; `/pulse/` is an article. */
export function linkedinKind(raw: string): 'post' | 'article' | 'other' {
  try {
    const path = new URL(raw).pathname.toLowerCase()
    if (path.startsWith('/pulse/')) return 'article'
    if (path.startsWith('/posts/') || path.startsWith('/feed/update/')) return 'post'
    return 'other'
  } catch {
    return 'other'
  }
}
