import {
  forumSiteLabel,
  redditThreadOf,
  sourceTypeOf,
  type RedditThreadRef
} from '@shared/source-type'
import { youtubeVideoId } from '../engine/checks/url'

/** The rules themselves are shared, so the renderer reads the same source types and names. */
export { forumSiteLabel, redditThreadOf, sourceTypeOf, youtubeVideoId, type RedditThreadRef }

export type LinkedinKind = 'post' | 'article' | 'newsletter' | 'profile' | 'other'

/** What a cited LinkedIn URL is. Author names are not read (FR-17.6: roles, never people). */
export function linkedinKind(normalizedUrl: string): LinkedinKind {
  let path: string
  try {
    path = new URL(normalizedUrl).pathname.toLowerCase()
  } catch {
    return 'other'
  }
  if (path.startsWith('/posts/') || path.startsWith('/feed/update/')) return 'post'
  if (path.startsWith('/pulse/')) return 'article'
  if (path.startsWith('/newsletters/')) return 'newsletter'
  if (/^\/(company|in|school|showcase)\//.test(path)) return 'profile'
  return 'other'
}
