import { decodeEntities } from './html-scan'

/** One link on a page: the words a reader clicks and its absolute http(s) URL. */
export interface PageAnchor {
  text: string
  url: string
}

const MAX_PAGE_ANCHORS = 400
const MAX_ANCHOR_CHARS = 80

/**
 * The `<a href>` links on a page with their visible words (the `aria-label` or `title`
 * when the link holds only an icon), in page order, first one per URL, at most
 * `MAX_PAGE_ANCHORS`. The site read uses them to pick a site's own offering pages and
 * to show Claude the site's menu. Pure.
 */
export function pageAnchors(html: string, base: string): PageAnchor[] {
  const seen = new Set<string>()
  const anchors: PageAnchor[] = []
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)) {
    if (anchors.length >= MAX_PAGE_ANCHORS) break
    const attributes = match[1] ?? ''
    const href = attributeOf(attributes, 'href')
    if (href === null || href.startsWith('#')) continue
    let url: URL
    try {
      url = new URL(decodeEntities(href), base)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    url.hash = ''
    if (seen.has(url.href)) continue
    seen.add(url.href)
    const words =
      tidy((match[2] ?? '').replace(/<[^>]*>/gu, ' ')) ||
      tidy(attributeOf(attributes, 'aria-label') ?? '') ||
      tidy(attributeOf(attributes, 'title') ?? '')
    anchors.push({ text: words, url: url.href })
  }
  return anchors
}

function attributeOf(attributes: string, name: string): string | null {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu').exec(
    attributes
  )
  const value = (found?.[1] ?? found?.[2] ?? '').trim()
  return value.length > 0 ? value : null
}

function tidy(text: string): string {
  const flat = decodeEntities(text).replace(/\s+/gu, ' ').trim()
  return flat.length <= MAX_ANCHOR_CHARS ? flat : `${flat.slice(0, MAX_ANCHOR_CHARS - 1)}…`
}
