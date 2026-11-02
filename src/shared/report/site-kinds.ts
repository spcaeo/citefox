import { cleanHost } from '../competitor-hosts'

/**
 * Kinds of cited site (Docs/REPORT-SPEC.md "Who else the AI answers cite"). Every
 * cited domain other than your own falls in one kind:
 *
 * - `competitors`: your product's competitors from project settings (decided at read
 *   time, never stored, because the list can change);
 * - `video_social`, `analysts_media`, `big_tech`: well-known hosts from the built-in
 *   list below, else what Claude said once for that domain (cached per domain);
 * - `services`: agencies, consultancies and service firms (Claude only);
 * - `other`: everything else, and any domain not sorted yet.
 */

export const SITE_KINDS = [
  'video_social',
  'competitors',
  'analysts_media',
  'big_tech',
  'services',
  'other'
] as const

export type SiteKind = (typeof SITE_KINDS)[number]

/** The kinds Claude may give a domain. `competitors` comes from project settings only. */
export const SORTABLE_SITE_KINDS = [
  'video_social',
  'analysts_media',
  'big_tech',
  'services',
  'other'
] as const satisfies readonly SiteKind[]

export type SortableSiteKind = (typeof SORTABLE_SITE_KINDS)[number]

export function isSiteKind(value: unknown): value is SiteKind {
  return typeof value === 'string' && (SITE_KINDS as readonly string[]).includes(value)
}

export function isSortableSiteKind(value: unknown): value is SortableSiteKind {
  return typeof value === 'string' && (SORTABLE_SITE_KINDS as readonly string[]).includes(value)
}

export const SITE_KIND_LABELS: Readonly<Record<SiteKind, string>> = {
  video_social: 'Video, social & forums',
  competitors: 'Competitors',
  analysts_media: 'Analysts, reviews & media',
  big_tech: 'Big tech & cloud',
  services: 'Services & agencies',
  other: 'Neutral'
}

/**
 * Well-known hosts, so the common ones never need Claude. A host matches its entry or
 * any subdomain of it (`m.youtube.com`, `uk.linkedin.com`).
 */
const BUILT_IN: Readonly<
  Record<Exclude<SortableSiteKind, 'services' | 'other'>, readonly string[]>
> = {
  video_social: [
    'youtube.com',
    'youtu.be',
    'vimeo.com',
    'tiktok.com',
    'reddit.com',
    'quora.com',
    'linkedin.com',
    'facebook.com',
    'instagram.com',
    'x.com',
    'twitter.com',
    'medium.com',
    'substack.com',
    'pinterest.com',
    'stackexchange.com',
    'stackoverflow.com',
    'dev.to',
    'hashnode.com',
    'producthunt.com',
    'news.ycombinator.com',
    'tumblr.com',
    'discord.com',
    'threads.net'
  ],
  analysts_media: [
    'g2.com',
    'capterra.com',
    'getapp.com',
    'softwareadvice.com',
    'trustradius.com',
    'trustpilot.com',
    'gartner.com',
    'forrester.com',
    'idc.com',
    'forbes.com',
    'techcrunch.com',
    'theverge.com',
    'wired.com',
    'zdnet.com',
    'techradar.com',
    'pcmag.com',
    'cnet.com',
    'businessinsider.com',
    'nytimes.com',
    'wsj.com',
    'bloomberg.com',
    'reuters.com',
    'bbc.co.uk',
    'bbc.com',
    'theguardian.com',
    'cnbc.com',
    'investopedia.com',
    'nerdwallet.com',
    'wikipedia.org',
    'hbr.org',
    'inc.com',
    'entrepreneur.com',
    'fastcompany.com',
    'mckinsey.com',
    'statista.com',
    'clutch.co',
    'sourceforge.net',
    'alternativeto.net',
    'crozdesk.com',
    'saasworthy.com'
  ],
  big_tech: [
    'google.com',
    'support.google.com',
    'cloud.google.com',
    'microsoft.com',
    'learn.microsoft.com',
    'azure.microsoft.com',
    'amazon.com',
    'aws.amazon.com',
    'apple.com',
    'ibm.com',
    'oracle.com',
    'salesforce.com',
    'sap.com',
    'meta.com',
    'adobe.com',
    'cisco.com',
    'nvidia.com',
    'intel.com',
    'openai.com',
    'anthropic.com'
  ]
}

const BUILT_IN_ENTRIES: readonly (readonly [string, SortableSiteKind])[] = Object.entries(
  BUILT_IN
).flatMap(([kind, hosts]) => hosts.map((host) => [host, kind as SortableSiteKind] as const))

/** The built-in kind of a host, or null when the list does not know it. */
export function builtInSiteKind(host: string): SortableSiteKind | null {
  const site = cleanHost(host)
  if (site.length === 0) return null
  let best: { length: number; kind: SortableSiteKind } | null = null
  for (const [entry, kind] of BUILT_IN_ENTRIES) {
    if (site !== entry && !site.endsWith(`.${entry}`)) continue
    // The longest entry wins: cloud.google.com is big tech even if google.com were not.
    if (best === null || entry.length > best.length) best = { length: entry.length, kind }
  }
  return best?.kind ?? null
}

/**
 * The kind of one cited site: a saved competitor first, then the built-in list, then
 * Claude's stored answer for the domain, else `other`.
 */
export function siteKindOf(input: {
  host: string
  competitor: boolean
  sorted?: SortableSiteKind | null
}): SiteKind {
  if (input.competitor) return 'competitors'
  return builtInSiteKind(input.host) ?? input.sorted ?? 'other'
}

/** One cited site for {@link kindTable}: its kind and its citations in each check. */
export interface KindTableSite {
  kind: SiteKind
  /** Citations in the earlier check. Null when there is no earlier check. */
  before: number | null
  now: number
}

export interface KindTableRow {
  kind: SiteKind
  label: string
  /** Sites cited in either check. */
  sites: number
  /** Null when there is no earlier check. */
  before: number | null
  now: number
  /** `now − before`. Null without an earlier check. */
  change: number | null
}

/**
 * "Who else the AI answers cite", by kind: sites cited in either check, citations
 * summed across them, most cited now first. Kinds with no cited site are left out.
 */
export function kindTable(sites: readonly KindTableSite[]): KindTableRow[] {
  const rows = new Map<SiteKind, KindTableRow>()
  const hasBefore = sites.some((site) => site.before !== null)
  for (const site of sites) {
    const before = site.before ?? 0
    if (site.now === 0 && before === 0) continue
    const row = rows.get(site.kind) ?? {
      kind: site.kind,
      label: SITE_KIND_LABELS[site.kind],
      sites: 0,
      before: hasBefore ? 0 : null,
      now: 0,
      change: hasBefore ? 0 : null
    }
    row.sites += 1
    row.now += site.now
    if (row.before !== null) row.before += before
    row.change = row.before === null ? null : row.now - row.before
    rows.set(site.kind, row)
  }
  return [...rows.values()].sort(
    (left, right) =>
      right.now - left.now ||
      (right.before ?? 0) - (left.before ?? 0) ||
      SITE_KINDS.indexOf(left.kind) - SITE_KINDS.indexOf(right.kind)
  )
}
