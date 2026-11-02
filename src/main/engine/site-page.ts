import type { PageAnchor } from '../pipeline/page-anchors'
import { fetchPlaygroundPage } from '../pipeline/playground'
import { sharedReadPool } from '../pipeline/read-pool'
import type { HomepageReader } from './company-domain-lookup'
import type { EngineHost } from './host'

/** One page of the business's site (or a competitor's homepage), as text. */
export interface SitePageBody {
  title: string
  text: string
  links?: readonly string[]
  anchors?: readonly PageAnchor[]
  /** `direct`: fetched from the site. `reader`: the host's reader (tests and e2e). */
  method: 'direct' | 'reader'
}

/** "Read directly · 1,240 words": how the page was read and its size, never its text. */
export function readDetail(body: SitePageBody): string {
  const words = body.text.split(/\s+/u).filter(Boolean).length
  const size = `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'}`
  return body.method === 'direct' ? `Read directly · ${size}` : `Read · ${size}`
}

/** Reads a competitor's homepage (no search) to confirm it names the brand. */
export function homepageReader(host: EngineHost): HomepageReader {
  return async (domain) => {
    const body = await readSitePage(host, `https://${domain}/`)
    return body === null ? null : { title: body.title, text: body.text }
  }
}

/**
 * The page through the host's reader when set (tests, e2e), else a guarded fetch. It
 * waits its turn in the app's read pool (a few at once, two per site).
 */
export function readSitePage(host: EngineHost, url: string): Promise<SitePageBody | null> {
  return sharedReadPool().run(url, () => readNow(host, url))
}

async function readNow(host: EngineHost, url: string): Promise<SitePageBody | null> {
  if (host.readWebsitePage !== undefined) {
    try {
      const body = await host.readWebsitePage(url)
      return body === null ? null : { ...body, method: 'reader' }
    } catch {
      return null
    }
  }
  try {
    const page = await fetchPlaygroundPage({
      url,
      transport: host.http,
      logger: host.logger,
      ...(host.pageDns !== undefined ? { dns: host.pageDns } : {}),
      secrets: host.knownSecrets()
    })
    return {
      title: page.title,
      text: page.pageText,
      method: 'direct',
      ...(page.links ? { links: page.links } : {}),
      ...(page.anchors ? { anchors: page.anchors } : {})
    }
  } catch {
    return null
  }
}
