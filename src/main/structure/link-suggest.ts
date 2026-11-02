import type { ClusterRole } from '@shared/domain'
import type { InternalLinkSuggestion } from '@shared/ipc'
import { pathSegments, splitWords, termLabel } from './cluster-rules'

/**
 * FR-19.8 "Suggest internal links" without Claude. CiteFox does not store
 * the site's links, so these are the links a cluster should have: from each
 * orphan and supporting page to the pillar, orphans first.
 */

export interface LinkPage {
  id: string
  url: string
  title: string | null
}

export interface LinkCluster {
  pillar: LinkPage | null
  pages: readonly (LinkPage & { role: ClusterRole })[]
}

const GENERIC = new Set(['guide', 'complete', 'ultimate', 'how', 'step', 'tip', 'blog', 'post'])
const MAX_ANCHOR_WORDS = 6

export function suggestInternalLinks(cluster: LinkCluster, max = 3): InternalLinkSuggestion[] {
  const pillar = cluster.pillar
  if (pillar === null || max <= 0) return []
  const rank = (role: ClusterRole): number =>
    role === 'orphan' ? 0 : role === 'supporting' ? 1 : 2
  const sources = cluster.pages
    .filter((page) => page.id !== pillar.id && page.role !== 'pillar')
    .sort((left, right) => rank(left.role) - rank(right.role) || left.id.localeCompare(right.id))
  const anchor = anchorFor(pillar)
  const topic = topicPhrase(pillar)
  const links: InternalLinkSuggestion[] = sources.slice(0, max).map((page) => ({
    fromPageId: page.id,
    fromUrl: page.url,
    toPageId: pillar.id,
    toUrl: pillar.url,
    anchor,
    where: `In the first paragraph that mentions "${topic}"`
  }))
  const orphan = sources.find((page) => page.role === 'orphan')
  if (links.length < max && orphan !== undefined) {
    links.push({
      fromPageId: pillar.id,
      fromUrl: pillar.url,
      toPageId: orphan.id,
      toUrl: orphan.url,
      anchor: anchorFor(orphan),
      where: `In the section closest to "${topicPhrase(orphan)}"`
    })
  }
  return links
}

/** The page's title without a brand suffix, or its slug in words. */
function anchorFor(page: LinkPage): string {
  const title = (page.title ?? '')
    .replace(/\s+/g, ' ')
    .split(/\s[|–—-]\s/)[0]
    ?.trim()
  if (title && title.length <= 60 && title.split(' ').length <= MAX_ANCHOR_WORDS + 1) return title
  const slug = pathSegments(page.url).at(-1) ?? ''
  const words = slug
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 0)
    .slice(0, MAX_ANCHOR_WORDS)
  const text = termLabel(words.join(' ').toLowerCase())
  if (text.length === 0) return page.url
  const first = text.split(' ')[0] ?? ''
  return first === first.toUpperCase() ? text : text.charAt(0).toLowerCase() + text.slice(1)
}

/** Two topic words, like "10DLC registration". */
function topicPhrase(page: LinkPage): string {
  const source = page.title ?? pathSegments(page.url).at(-1) ?? ''
  const words = splitWords(source).filter((word) => !GENERIC.has(word))
  if (words.length === 0) return anchorFor(page)
  return termLabel(words.slice(0, 2).join(' '))
}
