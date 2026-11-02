import type { CompetitorCandidate, CompetitorFindings, CompetitorOverviewRef } from '@shared/domain'
import type { SqliteDatabase } from '../../storage/database'
import { readProjectProfile } from '../../storage/project-profile'
import { isCompetitorHost } from '../checks/competitor-match'
import { hostMatchesDomain } from '../checks/url'
import type { EngineHost } from '../host'
import { withProject } from '../project-db'

/** Captures from this many days before the latest one are read (the current round of checks). */
export const COMPETITOR_WINDOW_DAYS = 30

/** FR-10.9. At most this many domains are listed. */
export const MAX_COMPETITOR_CANDIDATES = 12

/** Mobile carriers. Their help pages answer SMS questions but do not sell the same thing. */
const CARRIERS = [
  'verizon.com',
  'verizonwireless.com',
  'att.com',
  't-mobile.com',
  'sprint.com',
  'uscellular.com',
  'cricketwireless.com',
  'boostmobile.com',
  'metrobyt-mobile.com',
  'vtext.com',
  'bell.ca',
  'rogers.com',
  'telus.com',
  'vodafone.com',
  'vodafone.co.uk',
  'ee.co.uk',
  'o2.co.uk',
  'three.co.uk',
  'telstra.com.au',
  'optus.com.au',
  'airtel.in',
  'jio.com'
]

const REFERENCE = ['wikipedia.org', 'wikihow.com', 'investopedia.com', 'britannica.com']
const COMMUNITY = [
  'reddit.com',
  'quora.com',
  'youtube.com',
  'linkedin.com',
  'medium.com',
  'stackexchange.com',
  'stackoverflow.com',
  'facebook.com',
  'x.com',
  'twitter.com'
]
const REVIEW = [
  'g2.com',
  'capterra.com',
  'trustpilot.com',
  'getapp.com',
  'softwareadvice.com',
  'trustradius.com'
]
const HELP_PREFIX = /^(help|support|docs|kb|community|developers?|faq|answers)\./
const HELP_PATH = /\/(help|support|kb|knowledge-?base|faq|docs)(\/|$)/i

export interface CitedReference {
  /** Host as stored on `aio_references.domain`. */
  domain: string
  url: string
  /** `serp_results.id`: one overview. */
  overviewId: string
  sourceType: string
  /** Where the overview comes from, for the drill-down. Absent in unit fixtures. */
  context?: Omit<CompetitorOverviewRef, 'overviewId' | 'url' | 'citations'>
}

/**
 * FR-10.9. Ranks domains cited instead of the own domain, most overviews first.
 * The own domain and its subdomains are left out. Carrier, help, reference, community,
 * review, and public-sector hosts are kept but marked as probably not competitors.
 */
export function rankCompetitors(input: {
  ownDomain: string
  competitors: readonly string[]
  references: readonly CitedReference[]
}): CompetitorCandidate[] {
  const byDomain = new Map<
    string,
    {
      overviews: Set<string>
      citations: number
      urls: string[]
      sourceTypes: Set<string>
      refs: Map<string, CompetitorOverviewRef>
    }
  >()
  for (const reference of input.references) {
    const domain = reference.domain.toLowerCase().replace(/^www\./, '')
    if (domain.length === 0) continue
    if (hostMatchesDomain(domain, input.ownDomain, true)) continue
    const entry = byDomain.get(domain) ?? {
      overviews: new Set<string>(),
      citations: 0,
      urls: [],
      sourceTypes: new Set<string>(),
      refs: new Map<string, CompetitorOverviewRef>()
    }
    entry.overviews.add(reference.overviewId)
    if (reference.context) {
      const ref = entry.refs.get(reference.overviewId)
      if (ref) ref.citations += 1
      else {
        entry.refs.set(reference.overviewId, {
          ...reference.context,
          overviewId: reference.overviewId,
          url: reference.url,
          citations: 1
        })
      }
    }
    entry.citations += 1
    entry.urls.push(reference.url)
    entry.sourceTypes.add(reference.sourceType)
    byDomain.set(domain, entry)
  }
  const candidates = [...byDomain.entries()].map(([domain, entry]): CompetitorCandidate => {
    const why = notCompetitorReason(domain, entry.urls, entry.sourceTypes)
    return {
      domain,
      overviews: entry.overviews.size,
      citations: entry.citations,
      likelyCompetitor: why === null,
      reason: why ?? competitorReason(entry.overviews.size),
      // A listed competitor may be a domain or a bare name ("Twilio"), as FR-6.5 matches it.
      listed: isCompetitorHost(domain, input.competitors),
      // Every overview has a context when read from the database, so the list matches `overviews`.
      ...(entry.refs.size === entry.overviews.size && entry.refs.size > 0
        ? { overviewRefs: [...entry.refs.values()] }
        : {})
    }
  })
  return candidates
    .sort(
      (a, b) =>
        b.overviews - a.overviews ||
        b.citations - a.citations ||
        Number(b.likelyCompetitor) - Number(a.likelyCompetitor) ||
        a.domain.localeCompare(b.domain)
    )
    .slice(0, MAX_COMPETITOR_CANDIDATES)
}

function competitorReason(overviews: number): string {
  return overviews === 1
    ? 'Cited in 1 overview instead of you'
    : `Cited in ${overviews} overviews instead of you`
}

/** Null when the host looks like a real competitor. */
export function notCompetitorReason(
  domain: string,
  urls: readonly string[],
  sourceTypes: ReadonlySet<string>
): string | null {
  const is = (list: readonly string[]): boolean =>
    list.some((item) => domain === item || domain.endsWith(`.${item}`))
  if (is(CARRIERS)) return 'Carrier help page, probably not a competitor'
  if (HELP_PREFIX.test(domain)) return 'Help or docs site, probably not a competitor'
  if (is(REVIEW) || sourceTypes.has('review')) {
    return 'Review site, not a competitor (worth being listed there)'
  }
  if (is(REFERENCE)) return 'Reference site, probably not a competitor'
  if (
    is(COMMUNITY) ||
    sourceTypes.has('reddit') ||
    sourceTypes.has('youtube') ||
    sourceTypes.has('linkedin') ||
    sourceTypes.has('forum')
  ) {
    return 'Community site, probably not a competitor'
  }
  if (/\.(gov|edu|mil)(\.[a-z]{2})?$/.test(domain) || /\.gov\.[a-z]{2}$/.test(domain)) {
    return 'Public-sector site, probably not a competitor'
  }
  if (urls.length > 0 && urls.every((url) => HELP_PATH.test(pathOf(url)))) {
    return 'Help page, probably not a competitor'
  }
  return null
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/** FR-10.9 from stored captures. No Claude call and no search is made. */
export function findCompetitors(host: EngineHost, projectId: string): Promise<CompetitorFindings> {
  return withProject(host, projectId, 'projectSettings:findCompetitors', (opened) => {
    const profile = readProjectProfile(opened.db)
    const read = readRecentReferences(opened.db)
    const candidates = rankCompetitors({
      ownDomain: opened.project.domain,
      competitors: profile?.competitors ?? [],
      references: read.references
    })
    return {
      projectId: opened.project.id,
      domain: opened.project.domain,
      overviewsRead: read.overviews,
      latestCheckAt: read.latest,
      candidates,
      nextStep:
        read.overviews === 0
          ? 'Press Check now first. CiteFox lists the domains AI Overviews cite instead of yours.'
          : candidates.length === 0
            ? 'No other domains were cited in the latest checks.'
            : null
    }
  })
}

interface ReferenceRow {
  domain: string
  url: string
  serp_result_id: string
  source_type: string
  page_id: string
  market_id: string
  run_id: string
  started_at: string
  prompt_id: string
  prompt_label: string | null
  prompt_position: number | null
  page_label: string
}

function readRecentReferences(db: SqliteDatabase): {
  references: CitedReference[]
  overviews: number
  latest: string | null
} {
  const latest =
    db
      .prepare<unknown[], { at: string | null }>(
        `SELECT MAX(runs.started_at) AS at FROM serp_results s
         JOIN runs ON runs.id = s.run_id WHERE s.has_aio = 1`
      )
      .get()?.at ?? null
  if (latest === null) return { references: [], overviews: 0, latest: null }
  const from = new Date(Date.parse(latest) - COMPETITOR_WINDOW_DAYS * 86_400_000).toISOString()
  const overviews =
    db
      .prepare<unknown[], { total: number }>(
        `SELECT COUNT(*) AS total FROM serp_results s
         JOIN runs ON runs.id = s.run_id WHERE s.has_aio = 1 AND runs.started_at >= ?`
      )
      .get(from)?.total ?? 0
  const references = db
    .prepare<unknown[], ReferenceRow>(
      `SELECT r.domain, r.url, r.serp_result_id, r.source_type,
              runs.page_id, runs.market_id, runs.id AS run_id, runs.started_at,
              s.prompt_id, p.label AS prompt_label, p.position AS prompt_position,
              COALESCE(NULLIF(pg.label, ''), NULLIF(pg.title, ''), pg.url, runs.page_id) AS page_label
       FROM aio_references r
       JOIN serp_results s ON s.id = r.serp_result_id
       JOIN runs ON runs.id = s.run_id
       LEFT JOIN prompts p ON p.id = s.prompt_id
       LEFT JOIN pages pg ON pg.id = runs.page_id
       WHERE runs.started_at >= ? AND r.classification IN ('competitor', 'other')
       ORDER BY runs.started_at DESC, p.position, r.rowid`
    )
    .all(from)
    .map((row): CitedReference => ({
      domain: row.domain,
      url: row.url,
      overviewId: row.serp_result_id,
      sourceType: row.source_type,
      context: {
        pageId: row.page_id,
        pageLabel: row.page_label,
        promptId: row.prompt_id,
        promptLabel: row.prompt_label ?? 'Prompt',
        promptPosition: row.prompt_position ?? 0,
        marketId: row.market_id,
        runId: row.run_id,
        checkedAt: row.started_at
      }
    }))
  return { references, overviews, latest }
}
