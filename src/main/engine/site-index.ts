import {
  assertPublicPageUrl,
  MAX_DIRECT_REDIRECTS,
  systemAddressLookup
} from '../pipeline/fetch-guard'
import { sharedReadPool } from '../pipeline/read-pool'
import { CITEFOX_USER_AGENT, requestWithRetry } from '../providers/http'
import type { EngineHost } from './host'
import { siteLinks, type SiteLink } from './site-outline'

/**
 * The site's own page list when its home page gives too few links (prompt bench round 2:
 * freshworks.com's home page is a robot check, zoho.com tags every link with `?src=`).
 * Reads `/llms.txt` (a curated list many sites publish for AI tools), else the
 * `/sitemap.xml`, and keeps same-site links. Free and keyless: plain requests to the
 * site itself, through the same address guard and read pool as the page reads.
 */

const FETCH_TIMEOUT_MS = 15_000
/** An index file larger than this is cut (a huge sitemap only needs its first pages). */
const MAX_INDEX_CHARS = 1_000_000
/** Child sitemaps read from a sitemap index. */
const MAX_CHILD_SITEMAPS = 2

/** The links found, and where: `llms` lists are curated (main pages first), sitemaps are not. */
export interface SiteIndex {
  links: SiteLink[]
  source: 'llms' | 'sitemap' | null
}

export async function siteIndexLinks(host: EngineHost, domain: string): Promise<SiteIndex> {
  const llms = await readIndexFile(host, `https://${domain}/llms.txt`)
  const fromLlms = llms === null ? [] : siteLinks(domain, { anchors: llmsAnchors(llms) })
  if (fromLlms.length > 0) return { links: fromLlms, source: 'llms' }
  const sitemap = await readIndexFile(host, `https://${domain}/sitemap.xml`)
  if (sitemap === null) return { links: [], source: null }
  let locs = sitemapLocs(sitemap)
  if (/<sitemapindex[\s>]/iu.test(sitemap)) {
    const children = locs.filter((url) => /\.xml(?:\.gz)?$/iu.test(url) && !url.endsWith('.gz'))
    // Page and product sitemaps before blog ones.
    children.sort((left, right) => childRank(left) - childRank(right))
    locs = []
    for (const child of children.slice(0, MAX_CHILD_SITEMAPS)) {
      const body = await readIndexFile(host, child)
      if (body !== null) locs.push(...sitemapLocs(body))
    }
  }
  const links = siteLinks(domain, { anchors: locs.map((url) => ({ text: '', url })) })
  return { links, source: links.length > 0 ? 'sitemap' : null }
}

/** `[words](url)` links and bare URLs of an llms.txt file, in file order. */
export function llmsAnchors(text: string): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = []
  for (const match of text.matchAll(
    /\[([^\]]{0,200})\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<>"']+)/gu
  )) {
    const url = match[2] ?? match[3]
    if (url !== undefined) out.push({ text: (match[1] ?? '').trim(), url })
  }
  return out
}

/** The `<loc>` URLs of a sitemap or sitemap index. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/giu)]
    .map((match) => (match[1] ?? '').replace(/&amp;/gu, '&'))
    .filter((url) => url.length > 0)
}

function childRank(url: string): number {
  if (/page|product|solution|feature|main|site/iu.test(url)) return 0
  if (/blog|post|news|article|author|tag|categor/iu.test(url)) return 2
  return 1
}

/** One index file's text, or null when it is missing, not text, or blocked. */
async function readIndexFile(host: EngineHost, url: string): Promise<string | null> {
  return sharedReadPool().run(url, async () => {
    if (host.readWebsitePage !== undefined) {
      // Tests and e2e: the host's reader stands in for the network.
      try {
        const body = await host.readWebsitePage(url)
        return body === null || body.text.trim().length === 0 ? null : body.text
      } catch {
        return null
      }
    }
    try {
      return await fetchText(host, url)
    } catch {
      return null
    }
  })
}

async function fetchText(host: EngineHost, start: string): Promise<string | null> {
  const resolve = host.pageDns ?? systemAddressLookup()
  let current = start
  for (let hop = 0; hop <= MAX_DIRECT_REDIRECTS; hop += 1) {
    await assertPublicPageUrl(current, resolve)
    const response = await requestWithRetry(
      host.http,
      {
        method: 'GET',
        url: current,
        headers: {
          accept: 'text/plain, text/markdown, application/xml, text/xml;q=0.9, */*;q=0.5',
          'user-agent': CITEFOX_USER_AGENT
        }
      },
      { timeoutMs: FETCH_TIMEOUT_MS, label: 'Site index fetch', secrets: host.knownSecrets() }
    )
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = Object.entries(response.headers ?? {}).find(
        ([key]) => key.toLowerCase() === 'location'
      )?.[1]
      if (location === undefined) return null
      current = new URL(location, current).href
      continue
    }
    if (response.status < 200 || response.status >= 300) return null
    const body = response.body.slice(0, MAX_INDEX_CHARS)
    // An HTML page (a soft 404, a robot check) is not an index file.
    if (/^\s*(?:<!doctype html|<html)/iu.test(body)) return null
    return body.trim().length === 0 ? null : body
  }
  return null
}
