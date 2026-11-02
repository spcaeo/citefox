import type { CitationClass, LeaderboardBadge } from '@shared/domain'
import { cleanHost } from '@shared/competitor-hosts'
import { NO_SITE_TYPE_SETTINGS, type SiteTypeSettings } from '@shared/site-overrides'
import { knownPlatform, SITE_ROLE_HINTS, SITE_ROLE_LABELS } from '@shared/site-role'
import { sourceLines, type SourceCompetitor, type SourceLine } from './sources'

/**
 * Every list of cited sites (Competitors, Who gets cited, Cited instead of you, the
 * sources a check listed) shows a site the same way, one line per row: its icon, its
 * name, its website (with Copy and Open) and its type. Pure, so the lists and their
 * tests share it.
 *
 * The type is who the site is to you, the order the Sources tab follows: your site;
 * a saved competitor; a type of your own; a known platform by its role (Community,
 * Video, Review site…); else Neutral. Never a bare "Other" or "Site".
 */

/** Which tab of a site list a row is on. */
export type SiteGroup = 'yours' | 'competitor' | 'platform' | 'neutral'

/** One cited site, as a list knows it. */
export interface SiteInput {
  /** A stable key for the row. */
  key: string
  /** The site's host (`clicksend.com`). Null when not known. */
  domain: string | null
  /** How the check sorted it: this page, your site, a competitor, else other. */
  classification: CitationClass
  /** A saved competitor's id: the row is that competitor, whatever else says. */
  competitorId?: string | null
  /** The saved competitor's name. */
  competitorName?: string | null
}

/** The full address for a host, for Copy and Open (its home page). */
export function siteUrl(domain: string): string {
  return `https://${cleanHost(domain)}/`
}

/**
 * The rows' types with the user's choices and saved competitors applied, as the
 * Sources tab works them out. A row with `competitorId` is that competitor.
 */
export function siteLines(
  inputs: readonly SiteInput[],
  competitors: readonly SourceCompetitor[] = [],
  settings: SiteTypeSettings = NO_SITE_TYPE_SETTINGS
): SourceLine[] {
  const lines = sourceLines(
    inputs.map((input, index) => ({
      key: input.key,
      position: index + 1,
      url: siteUrl(input.domain ?? input.key),
      domain: input.domain ?? '',
      title: null,
      classification: input.classification
    })),
    competitors,
    null,
    new Set(),
    settings
  )
  return lines.map((line, index) => {
    const input = inputs[index]
    if (!input?.competitorId) return line
    return {
      ...line,
      relation: {
        kind: 'competitor',
        name: input.competitorName ?? null,
        id: input.competitorId
      },
      type: 'competitor',
      customType: null,
      typeEdited: false,
      roleEdited: false
    }
  })
}

/** The tab a row is on. */
export function siteGroup(line: Pick<SourceLine, 'relation'>): SiteGroup {
  switch (line.relation.kind) {
    case 'target':
    case 'own':
      return 'yours'
    case 'competitor':
      return 'competitor'
    case 'platform':
      return 'platform'
    case 'neutral':
      return 'neutral'
  }
}

/**
 * What the Type column says: "Your site" ("This page" for the page checked), "Competitor",
 * a type of your own, a platform's role ("Community"), else "Neutral".
 */
export function siteTypeName(
  line: Pick<SourceLine, 'relation' | 'customType'>,
  topic = false
): string {
  const { relation } = line
  if (relation.kind === 'target') return topic ? 'Your target page' : 'This page'
  if (relation.kind === 'own') return 'Your site'
  if (relation.kind === 'competitor') return 'Competitor'
  if (line.customType) return line.customType.name
  if (relation.kind === 'platform') return SITE_ROLE_LABELS[relation.role]
  return SITE_ROLE_LABELS.neutral
}

/** One line on what the type means, for its tooltip. */
export function siteTypeHint(line: Pick<SourceLine, 'relation' | 'customType'>): string {
  const { relation } = line
  if (relation.kind === 'target') return 'The page this check is for.'
  if (relation.kind === 'own') return 'A page on your own site.'
  if (relation.kind === 'competitor') return 'One of your saved competitors.'
  if (line.customType) return 'A type of your own.'
  if (relation.kind === 'platform') {
    return `${relation.name}. ${SITE_ROLE_HINTS[relation.role]}`
  }
  return 'Not a competitor and not a known platform such as Reddit or YouTube.'
}

/**
 * The name a site goes by, when it has one: a saved name or brand (not just the host),
 * else a known platform's (`Reddit`, `Forbes`). Null for a site known only by its host,
 * which then shows its domain once, in the name's place.
 */
export function siteBrand(domain: string | null, name?: string | null): string | null {
  const host = domain === null ? null : cleanHost(domain)
  const given = name?.trim() ?? ''
  if (given !== '' && (host === null || cleanHost(given) !== host)) return given
  if (host === null) return null
  return knownPlatform(siteUrl(host))?.name ?? null
}

/** A site list's type filter: every site, then one option per group. */
export type SiteGroupFilter = 'all' | SiteGroup

export const SITE_GROUP_FILTERS: readonly { id: SiteGroupFilter; label: string }[] = [
  { id: 'all', label: 'All types' },
  { id: 'yours', label: 'Your site' },
  { id: 'competitor', label: 'Competitors' },
  { id: 'platform', label: 'Platforms' },
  { id: 'neutral', label: 'Neutral sites' }
]

/** A Results leaderboard row: `you`, a `tracked` competitor, or `observed`. */
export interface LeaderSite {
  domain: string
  badge: LeaderboardBadge
}

function leaderInput(row: LeaderSite): SiteInput {
  return {
    key: row.domain,
    domain: row.domain,
    classification: row.badge === 'you' ? 'own' : row.badge === 'tracked' ? 'competitor' : 'other'
  }
}

/** The type of each leaderboard row, by domain, with the project's own choices when given. */
export function leaderLines(
  rows: readonly LeaderSite[],
  competitors: readonly SourceCompetitor[] = [],
  settings: SiteTypeSettings = NO_SITE_TYPE_SETTINGS
): Map<string, SourceLine> {
  const lines = siteLines(rows.map(leaderInput), competitors, settings)
  return new Map(lines.map((line) => [line.key, line]))
}

/** One leaderboard row's type, from the map or worked out on its own. */
export function leaderLine(lines: ReadonlyMap<string, SourceLine>, row: LeaderSite): SourceLine {
  return lines.get(row.domain) ?? siteLine(leaderInput(row))
}

/** One site's type. */
export function siteLine(input: SiteInput): SourceLine {
  const [line] = siteLines([input])
  if (!line) throw new Error('No line for a site.')
  return line
}

/** What a site list shows of one row's site. */
export interface SiteCellData {
  /** The site's host. Null when not known. */
  domain: string | null
  /** A saved name or brand. Null or the host itself: a known platform's name, else the domain once. */
  name?: string | null
  /** Your own site: the name keeps the highlighter. */
  own?: boolean
  /** First cited in this period: a small "New" chip after the name. */
  isNew?: boolean
}

/** The name shown: the brand, else the domain, else "Unknown site". */
export function shownName(site: SiteCellData): string {
  return siteBrand(site.domain, site.name) ?? site.domain ?? site.name ?? 'Unknown site'
}

/** Chip tones by who a site is, as the Sources tab draws them. */
export const RELATION_TONE = {
  target: 'fox',
  own: 'info',
  competitor: 'warn',
  platform: 'neutral'
} as const
