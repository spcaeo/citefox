import { readFileSync } from 'node:fs'
import type { WebsitePageBody } from '../engine/host'
import type { AddressLookup } from '../pipeline/fetch-guard'

/**
 * E2E stand-in for site reads in the topic wizard (Discover, profile, terms,
 * competitor page), so the wizard runs with no network. Used only by an
 * unpackaged build started with `CITEFOX_E2E_TOPICS=1`. The pages live outside
 * src, in the JSON file `CITEFOX_E2E_TOPIC_SITE` names (tests/e2e/launch.ts sets
 * it to tests/e2e/fixtures/topic-site.json), so a release bundle carries no demo
 * site. Claude is the `tests/e2e/claude-shim.mjs` stand-in.
 */
export interface E2eTopicSite {
  /** The site's host, such as `example.com`. */
  host: string
  /** The brand name that wide reads put in page titles. */
  name: string
  /** Path → page, such as `/pricing`. */
  pages: Readonly<Record<string, WebsitePageBody>>
}

/** Reads the stand-in site file; null when it is missing or not the expected shape. */
export function readE2eTopicSite(file: string | undefined): E2eTopicSite | null {
  if (file === undefined || file.length === 0) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<E2eTopicSite>
    if (typeof parsed.host !== 'string' || typeof parsed.name !== 'string') return null
    if (parsed.pages === null || typeof parsed.pages !== 'object') return null
    return { host: parsed.host, name: parsed.name, pages: parsed.pages }
  } catch {
    return null
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function e2eTopicSiteReader(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv
): ((url: string) => Promise<WebsitePageBody | null>) | undefined {
  if (isPackaged || env.CITEFOX_E2E_TOPICS !== '1') return undefined
  const site = readE2eTopicSite(env.CITEFOX_E2E_TOPIC_SITE)
  if (site === null) return undefined
  // CITEFOX_E2E_READ_DELAY_MS slows each read so a spec can watch the live progress panel.
  const delay = Number(env.CITEFOX_E2E_READ_DELAY_MS ?? '0')
  const wait = (): Promise<void> =>
    Number.isFinite(delay) && delay > 0
      ? new Promise((resolve) => setTimeout(resolve, Math.min(delay, 10_000)))
      : Promise.resolve()
  // CITEFOX_E2E_SITE_WIDE=1 (the first-run spec) reads more of the site: any
  // page on it reads as a short page named from its slug, the first read of an
  // integration page fails (so the retry shows) and help pages never read (so a
  // skip shows). Other specs keep the fixed pages only.
  const wide = env.CITEFOX_E2E_SITE_WIDE === '1'
  const onSite = new RegExp(`(^|\\.)${escapeRegExp(site.host)}$`, 'u')
  const failedOnce = new Set<string>()
  return async (url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    const path = parsed.pathname
    await wait()
    const known = site.pages[path] ?? site.pages[path.replace(/\/$/u, '')]
    if (known !== undefined) return known
    if (!wide || !onSite.test(parsed.hostname)) return null
    if (path.startsWith('/help/')) return null
    if (path.startsWith('/integrations/') && !failedOnce.has(path)) {
      failedOnce.add(path)
      return null
    }
    const slug = path.split('/').filter(Boolean).at(-1) ?? 'page'
    const title = slug.replace(/-/gu, ' ').replace(/^./u, (first) => first.toUpperCase())
    return {
      title: `${title} · ${site.name}`,
      text: `# ${title}
## How it works
## Questions buyers ask
${site.name} sends alerts from email as texts. This page covers ${title.toLowerCase()}.`
    }
  }
}

/**
 * E2E stand-in for the DNS check of suggested competitor domains: every name
 * resolves to a public documentation address except `textemall.com` (the live
 * run's misspelling), so the check is exercised with no network.
 */
export function e2eTopicDns(
  isPackaged: boolean,
  env: NodeJS.ProcessEnv
): AddressLookup | undefined {
  if (isPackaged || env.CITEFOX_E2E_TOPICS !== '1') return undefined
  return {
    async lookup(hostname: string) {
      if (hostname === 'textemall.com') throw new Error('ENOTFOUND')
      return ['93.184.216.34']
    }
  }
}
