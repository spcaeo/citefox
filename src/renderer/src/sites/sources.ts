import type { AioBlock, AioOverview } from '@shared/aio-overview'
import { cleanHost, hostIsCompetitor, type CompetitorEntry } from '@shared/competitor-hosts'
import type { CitationClass, CitationSourceType } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import {
  customTypeId,
  NO_SITE_TYPE_SETTINGS,
  overrideFor,
  type CustomSiteType,
  type SiteTypeSettings
} from '@shared/site-overrides'
import { knownPlatform, platformLabel, type PlatformRole } from '@shared/site-role'
import { SITE_TYPE_LABELS, siteTypeOf, type SiteType } from '@shared/site-type'
import { hostOf } from '../ui/urlTextModel'

/**
 * The sources lists on Prompt detail (Google's sources tab and each engine's
 * sources): what kind of site each source is, who it is to you, and how often
 * the answer's text links to it. Pure, so the table and its tests share it.
 *
 * Who it is, first match wins: your own site; what you set for the domain; your
 * competitor list; a known platform (Reddit, YouTube, G2: never a competitor); else
 * Neutral. The type of site follows the same order.
 */

/** Who a source is to the project ("Who it is"). Never a bare "Other". */
export type SourceRelation =
  | { kind: 'target' }
  | { kind: 'own'; tracked: boolean }
  /** `id`: the saved competitor's, so "not a competitor" can remove it. Null: stored by the check. */
  | { kind: 'competitor'; name: string | null; id: string | null }
  | { kind: 'platform'; role: PlatformRole; name: string; detail: string | null }
  | { kind: 'neutral' }

/** A saved competitor as the sources match it. */
export interface SourceCompetitor extends CompetitorEntry {
  id?: string
}

/** One source as the check stored it: a Google reference or an engine source. */
export interface ScoredSourceInput {
  /** A stable key for the row. */
  key: string
  position: number
  url: string
  domain: string
  title: string | null
  classification: CitationClass
  /** On the own site and not a tracked page. False when not known. */
  untracked?: boolean
  /** The stored FR-17.1 source type. Absent for engine sources. */
  sourceType?: CitationSourceType | null
}

/** One row of a sources table. */
export interface SourceLine {
  key: string
  position: number
  url: string
  domain: string
  /** The bare host the user's choices are saved under (`reddit.com`). */
  site: string
  title: string | null
  type: SiteType
  /** The project's own type the user picked, shown instead of `type`. */
  customType: CustomSiteType | null
  relation: SourceRelation
  /** The user set the type / who it is for this domain (not automatic). */
  typeEdited: boolean
  roleEdited: boolean
  /** Times the answer's text links to it. Null when the answer's links are not stored. */
  cited: number | null
}

/** The host a source's choices are keyed by: its address's host, else its stored domain. */
export function sourceSite(source: Pick<ScoredSourceInput, 'url' | 'domain'>): string {
  return cleanHost(hostOf(source.url) ?? source.domain)
}

/**
 * Who a source is: the stored class for this page and own pages; then what the user
 * set for the domain; then a saved competitor (current list, so a site marked as a
 * competitor after the check reads as one at once); then a known platform; then a
 * competitor the check stored; else Neutral.
 */
export function sourceRelation(
  source: Pick<ScoredSourceInput, 'url' | 'domain' | 'classification' | 'untracked'>,
  competitors: readonly SourceCompetitor[],
  /** Pages tracked this visit, by {@link urlKey}. */
  tracked: ReadonlySet<string> = new Set(),
  settings: SiteTypeSettings = NO_SITE_TYPE_SETTINGS
): SourceRelation {
  if (source.classification === 'target') return { kind: 'target' }
  if (source.classification === 'own') {
    return { kind: 'own', tracked: !source.untracked || tracked.has(urlKey(source.url)) }
  }
  const host = sourceSite(source)
  const platform = knownPlatform(source.url)
  const role = overrideFor(host, settings.overrides)?.role ?? null
  if (role === 'neutral') return { kind: 'neutral' }
  if (role !== null) {
    return {
      kind: 'platform',
      role,
      name: platform?.name ?? host,
      detail: platform?.role === role ? platform.detail : null
    }
  }
  const saved = competitors.find((entry) => hostIsCompetitor(host, entry))
  if (saved) return { kind: 'competitor', name: saved.name, id: saved.id ?? null }
  if (platform) return { kind: 'platform', ...platform }
  if (source.classification === 'competitor') return { kind: 'competitor', name: null, id: null }
  return { kind: 'neutral' }
}

/** What "Who it is" says. A topic's target is its target page; a page's is the page itself. */
export function relationLabel(relation: SourceRelation, topic: boolean): string {
  switch (relation.kind) {
    case 'target':
      return topic ? 'Your target page' : 'This page'
    case 'own':
      return 'Your page'
    case 'competitor':
      return relation.name ? `Competitor · ${relation.name}` : 'Competitor'
    case 'platform':
      return platformLabel(relation)
    case 'neutral':
      return 'Neutral'
  }
}

/** The rows of a sources table, in the order given. */
export function sourceLines(
  sources: readonly ScoredSourceInput[],
  competitors: readonly SourceCompetitor[],
  cited: ReadonlyMap<string, number> | null,
  tracked: ReadonlySet<string> = new Set(),
  settings: SiteTypeSettings = NO_SITE_TYPE_SETTINGS
): SourceLine[] {
  return sources.map((source) => {
    const relation = sourceRelation(source, competitors, tracked, settings)
    const own = relation.kind === 'target' || relation.kind === 'own'
    const site = sourceSite(source)
    const override = own ? null : overrideFor(site, settings.overrides)
    const choice = override?.type ?? null
    const customId = choice === null ? null : customTypeId(choice)
    const customType =
      customId === null ? null : (settings.customTypes.find((item) => item.id === customId) ?? null)
    const automatic = siteTypeOf({
      url: source.url,
      own,
      competitor: relation.kind === 'competitor',
      sourceType: source.sourceType ?? null
    })
    return {
      key: source.key,
      position: source.position,
      url: source.url,
      domain: source.domain,
      site,
      title: source.title,
      relation,
      type: choice !== null && customId === null ? (choice as SiteType) : automatic,
      customType,
      typeEdited: choice !== null && (customId === null || customType !== null),
      roleEdited: !own && (override?.role ?? null) !== null,
      cited: cited === null ? null : (cited.get(urlKey(source.url)) ?? 0)
    }
  })
}

/** "3 times", "Once", "Listed only"; a dash when the answer's links are not stored. */
export function citedLabel(cited: number | null): string {
  if (cited === null) return '—'
  if (cited === 0) return 'Listed only'
  return cited === 1 ? 'Once' : `${cited} times`
}

const COMMUNITY_ROLES: readonly PlatformRole[] = ['community', 'qa', 'social', 'video']

/**
 * The chips over a sources table, by who each source is: your pages, competitors,
 * communities (forums, Q&A, social and video) and neutral sites; review sites, media
 * and encyclopedias only when there are some.
 */
export function sourceSummary(lines: readonly SourceLine[]): string[] {
  const count = (test: (relation: SourceRelation) => boolean): number =>
    lines.filter((line) => test(line.relation)).length
  const yours = count((relation) => relation.kind === 'target' || relation.kind === 'own')
  const others = count(
    (relation) => relation.kind === 'platform' && !COMMUNITY_ROLES.includes(relation.role)
  )
  return [
    `Your site: ${pluralize(yours, 'page')}`,
    `Competitors: ${count((relation) => relation.kind === 'competitor')}`,
    `Communities: ${count(
      (relation) => relation.kind === 'platform' && COMMUNITY_ROLES.includes(relation.role)
    )}`,
    `Neutral: ${count((relation) => relation.kind === 'neutral')}`,
    ...(others > 0 ? [`Reviews & media: ${others}`] : [])
  ]
}

/** The type's label: the user's own type's name, else the built-in type's. */
export function siteTypeLabel(line: Pick<SourceLine, 'type' | 'customType'>): string {
  return line.customType?.name ?? SITE_TYPE_LABELS[line.type]
}

/**
 * Links in the answer's text per source address, from Google's laid-out overview:
 * each paragraph, list item or table that cites a source counts once.
 */
export function overviewCitations(overview: AioOverview): Map<string, number> {
  const byIndex = new Map<number, number>()
  const add = (refs: readonly number[]): void => {
    for (const ref of new Set(refs)) byIndex.set(ref, (byIndex.get(ref) ?? 0) + 1)
  }
  const walk = (blocks: readonly AioBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph' || block.kind === 'table') add(block.refs)
      else if (block.kind === 'list') {
        for (const item of block.items) {
          add(item.refs)
          walk(item.children)
        }
      } else if (block.kind === 'expandable') walk(block.blocks)
    }
  }
  walk(overview.blocks)
  const counts = new Map<string, number>()
  for (const source of overview.sources) {
    if (!source.url) continue
    const key = urlKey(source.url)
    counts.set(key, (counts.get(key) ?? 0) + (byIndex.get(source.index) ?? 0))
  }
  return counts
}

const MARKDOWN_LINK = /\]\((https?:\/\/[^)\s]+)\)/g

/** Links in a markdown answer (cloro, ChatGPT and the other engines) per source address. */
export function markdownCitations(markdown: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const key = urlKey(match[1] ?? '')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** An address for matching: no scheme, `www.`, fragment, `utm_` tags or trailing slash. */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url)
    for (const name of [...parsed.searchParams.keys()]) {
      if (name.startsWith('utm_')) parsed.searchParams.delete(name)
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  } catch {
    return url
  }
}
