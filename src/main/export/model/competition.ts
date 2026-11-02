import { percent } from '@shared/report-copy'
import { bareDomain } from '../../engine/checks/url'
import type { DrillRegistry } from './drills'
import { mean, oneDecimal } from './format'
import type { ScopeData } from './rows'
import { buildKindRows, domainKind, previousCitations, type SiteKindFacts } from './site-kinds'
import type { CompetitionSection, DomainWho, LeaderboardRow, ReportReference } from './types'

const NO_KIND_FACTS: SiteKindFacts = { competitors: [], siteKinds: {} }

export const AUTHORITY_NOTE =
  'Authority is 0–100: round(100 × (0.5 × reach + 0.3 × prominence + 0.2 × market coverage)). ' +
  'Reach is prompts citing the domain ÷ prompts with an AI Overview. Prominence is 1 − (average position − 1) ÷ 9, kept between 0 and 1. ' +
  'Market coverage is markets citing the domain ÷ markets checked.'

interface DomainStats {
  domain: string
  who: DomainWho
  rows: Set<string>
  /** Best position per row. */
  positions: Map<string, number>
  markets: Set<string>
}

/** The leaderboard domain for a reference: own pages fold into the own domain. */
export function referenceDomain(reference: ReportReference, ownDomain: string): string {
  if (reference.classification === 'target' || reference.classification === 'own') {
    return bareDomain(ownDomain)
  }
  const domain = bareDomain(reference.domain)
  return DOMAIN_ALIASES[domain] ?? domain
}

/** Hosts that are the same site for counting: share links and mobile hosts. */
const DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  'youtu.be': 'youtube.com',
  'm.youtube.com': 'youtube.com',
  'music.youtube.com': 'youtube.com',
  'old.reddit.com': 'reddit.com',
  'new.reddit.com': 'reddit.com',
  'm.reddit.com': 'reddit.com'
}

export function referenceWho(reference: ReportReference): DomainWho {
  if (reference.classification === 'target' || reference.classification === 'own') return 'you'
  if (reference.classification === 'competitor') return 'competitor'
  return 'observed'
}

/** `round(100 × (0.5·reach + 0.3·prominence + 0.2·marketCoverage))`. */
export function authorityScore(input: {
  prompts: number
  promptsWithAio: number
  avgPosition: number | null
  markets: number
  marketsChecked: number
}): { authority: number; reach: number; prominence: number; marketCoverage: number } {
  const reach = input.promptsWithAio === 0 ? 0 : input.prompts / input.promptsWithAio
  const prominence =
    input.avgPosition === null ? 0 : Math.min(1, Math.max(0, 1 - (input.avgPosition - 1) / 9))
  const marketCoverage = input.marketsChecked === 0 ? 0 : input.markets / input.marketsChecked
  return {
    authority: Math.round(100 * (0.5 * reach + 0.3 * prominence + 0.2 * marketCoverage)),
    reach,
    prominence,
    marketCoverage
  }
}

/** Section 4, Competition. */
export function buildCompetition(
  scope: ScopeData,
  ownDomain: string,
  drills: DrillRegistry,
  kindFacts: SiteKindFacts = NO_KIND_FACTS
): CompetitionSection {
  const own = bareDomain(ownDomain)
  const domainOf = (reference: ReportReference): string => referenceDomain(reference, own)
  const isOwn = (reference: ReportReference): boolean => referenceWho(reference) === 'you'
  const previous = previousCitations(scope, domainOf, isOwn)
  const aioRows = scope.rows.filter((row) => row.aio)
  const aioIds = new Set(aioRows.map((row) => row.id))
  const marketOf = new Map(scope.rows.map((row) => [row.id, row.marketId]))
  const citedYou = new Set(aioRows.filter((row) => row.cited).map((row) => row.id))
  const stats = new Map<string, DomainStats>()
  stats.set(own, {
    domain: own,
    who: 'you',
    rows: new Set(),
    positions: new Map(),
    markets: new Set()
  })
  for (const reference of scope.references) {
    if (!aioIds.has(reference.rowId)) continue
    const domain = referenceDomain(reference, own)
    let entry = stats.get(domain)
    if (entry === undefined) {
      entry = {
        domain,
        who: referenceWho(reference),
        rows: new Set(),
        positions: new Map(),
        markets: new Set()
      }
      stats.set(domain, entry)
    } else if (entry.who === 'observed' && referenceWho(reference) === 'competitor') {
      entry.who = 'competitor'
    }
    entry.rows.add(reference.rowId)
    const best = entry.positions.get(reference.rowId)
    if (best === undefined || reference.position < best) {
      entry.positions.set(reference.rowId, reference.position)
    }
    entry.markets.add(marketOf.get(reference.rowId) ?? '')
  }
  // Your row counts the same prompts as the overview's "You are cited".
  const youStats = stats.get(own)
  if (youStats !== undefined) {
    youStats.rows = new Set(citedYou)
    for (const id of [...youStats.positions.keys()]) {
      if (!citedYou.has(id)) youStats.positions.delete(id)
    }
  }

  const marketsChecked = new Set(scope.rows.map((row) => row.marketId)).size
  const leaderboard: LeaderboardRow[] = [...stats.values()]
    .filter((entry) => entry.who === 'you' || entry.rows.size > 0)
    .map((entry) => {
      const ids = aioRows.filter((row) => entry.rows.has(row.id)).map((row) => row.id)
      const avg = mean([...entry.positions.values()])
      const markets = new Set(ids.map((id) => marketOf.get(id) ?? '')).size
      const score = authorityScore({
        prompts: ids.length,
        promptsWithAio: aioRows.length,
        avgPosition: avg,
        markets,
        marketsChecked
      })
      const isYou = entry.who === 'you'
      return {
        domain: entry.domain,
        who: entry.who,
        kind: isYou
          ? null
          : domainKind(
              entry.domain,
              entry.who === 'competitor' || previous.competitors.has(entry.domain),
              kindFacts
            ),
        prompts: drills.count(isYou ? 'aio:cited' : `host:${entry.domain}`, ids),
        overlap: isYou
          ? null
          : drills.count(
              `host:${entry.domain}:overlap`,
              ids.filter((id) => citedYou.has(id))
            ),
        gap: isYou
          ? null
          : drills.count(
              `host:${entry.domain}:gap`,
              ids.filter((id) => !citedYou.has(id))
            ),
        avgPosition: avg === null ? null : oneDecimal(avg),
        ...score
      }
    })
    .sort(
      (left, right) =>
        right.prompts.n - left.prompts.n ||
        right.authority - left.authority ||
        left.domain.localeCompare(right.domain)
    )

  const rivals = leaderboard.filter((row) => row.who !== 'you')
  const rival = rivals[0] ?? null
  const reach = drills.count('aio:cited', [...citedYou])
  const competitorDomains = new Set(
    leaderboard.filter((row) => row.who === 'competitor').map((row) => row.domain)
  )
  const sovYou: string[] = []
  const sovCompetitor: string[] = []
  const sovOthers: string[] = []
  const sovNone: string[] = []
  const gapIds: string[] = []
  for (const row of aioRows) {
    if (citedYou.has(row.id)) {
      sovYou.push(row.id)
      continue
    }
    const domains = new Set(
      scope.references
        .filter((reference) => reference.rowId === row.id)
        .map((reference) => referenceDomain(reference, own))
    )
    if (domains.size === 0) {
      sovNone.push(row.id)
      continue
    }
    gapIds.push(row.id)
    if ([...domains].some((domain) => competitorDomains.has(domain))) sovCompetitor.push(row.id)
    else sovOthers.push(row.id)
  }
  const measured = scope.rows.filter((row) => row.status !== 'error').length
  return {
    empty:
      aioRows.length === 0
        ? {
            title: 'No AI Overviews to compare yet',
            message: 'Competition is measured on prompts where Google shows an AI Overview.',
            nextStep: 'Run a check, or add prompts that trigger an AI Overview.'
          }
        : null,
    domainsCited: leaderboard.filter((row) => row.prompts.n > 0).length,
    reach,
    reachPct: percent(reach.n, measured),
    rival: rival === null ? null : { domain: rival.domain, prompts: rival.prompts },
    rivalLead: rival === null ? null : rival.prompts.n - reach.n,
    gapPrompts: drills.count('gap', gapIds),
    sov: {
      total: drills.count(
        'aio:shown',
        aioRows.map((row) => row.id)
      ),
      you: drills.count('aio:cited', sovYou),
      competitor: drills.count('sov:competitor', sovCompetitor),
      others: drills.count('sov:others', sovOthers),
      none: drills.count('sov:none', sovNone)
    },
    mostCited: leaderboard
      .filter((row) => row.prompts.n > 0)
      .slice(0, 10)
      .map((row) => ({
        domain: row.domain,
        who: row.who,
        prompts: row.prompts,
        before: !previous.any
          ? null
          : row.who === 'you'
            ? previous.you
            : (previous.prompts.get(row.domain) ?? 0)
      })),
    leaderboard,
    byKind: buildKindRows({
      scope,
      ownDomain: own,
      domainOf,
      isOwn,
      previous,
      facts: kindFacts,
      drills
    }),
    authorityNote: AUTHORITY_NOTE
  }
}
