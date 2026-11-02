import type { PageSummary } from '@shared/domain'
import type { OverviewShareLink } from '@shared/ipc'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { readProjectProfile } from '../../storage/project-profile'
import { isFullRun } from '../checks/results'
import { competitorContext } from '../competitor-context'
import { emptyTallies, tallyRun, YOU_KEY, type SiteLens, type Tallies } from './tally'

/**
 * The one scope "share of citations" uses on every screen (Overview and Competitors):
 * the latest full check of each page and topic in each market (one market when picked),
 * every link of each overview once per question. Own links ÷ all links.
 */

/** Per page and market: the latest full check, and the latest one finished by `cutoff`. */
export function pickRuns(
  db: SqliteDatabase,
  projectId: string,
  pages: readonly PageSummary[],
  marketId: string | null,
  cutoff: string
): { current: StoredCheckRun[]; start: StoredCheckRun[] } {
  const { latest, atCutoff } = runsByKey(db, projectId, pages, marketId, cutoff)
  return { current: [...latest.values()], start: [...atCutoff.values()] }
}

function runsByKey(
  db: SqliteDatabase,
  projectId: string,
  pages: readonly PageSummary[],
  marketId: string | null,
  cutoff: string | null
): {
  latest: Map<string, StoredCheckRun>
  previous: Map<string, StoredCheckRun>
  atCutoff: Map<string, StoredCheckRun>
} {
  const latest = new Map<string, StoredCheckRun>()
  const previous = new Map<string, StoredCheckRun>()
  const atCutoff = new Map<string, StoredCheckRun>()
  if (pages.length === 0) return { latest, previous, atCutoff }
  const listed = listStoredCheckRuns(db, {
    projectId,
    pageIds: pages.map((page) => page.id),
    marketId,
    from: null,
    to: null,
    runId: null,
    promptId: null
  })
  const runs = listed.filter(isFullRun)
  for (const run of runs) {
    const key = `${run.pageId}|${run.marketId}`
    const before = latest.get(key)
    if (before !== undefined) previous.set(key, before)
    latest.set(key, run)
    if (cutoff !== null && run.finishedAt !== null && run.finishedAt <= cutoff) {
      atCutoff.set(key, run)
    }
  }
  // A first check still under way (or stopped part-way) counts now with the answers it
  // has, so share shows while it runs. A re-check waits for its end: share compares whole checks.
  const fullKeys = new Set(runs.map((run) => `${run.pageId}|${run.marketId}`))
  for (const run of listed) {
    const key = `${run.pageId}|${run.marketId}`
    if (run.status !== 'finished' && !fullKeys.has(key)) latest.set(key, run)
  }
  return { latest, previous, atCutoff }
}

/** Pages and topics whose checks count: every one not removed. */
export function sharePages(db: SqliteDatabase, projectId: string): PageSummary[] {
  return listPages(db, projectId).filter((page) => page.status !== 'removed')
}

export interface ShareTotals {
  /** Own links. */
  own: number
  /** Every link. */
  all: number
  /** Questions with an AI Overview behind those links. */
  questions: number
}

export interface CitationShare {
  now: ShareTotals
  /** At the compared moment. Null when nothing had been checked by then. */
  before: ShareTotals | null
  /** Page or topic × market checks behind `now`. */
  checks: number
  /** The links behind `now`, own links first. Empty unless asked for (`links: true`). */
  links: OverviewShareLink[]
}

/**
 * Share of citations in the shared scope. `before`: `'previous'` compares each page
 * and market with its own previous full check; an ISO time with the state then.
 */
export function citationShare(
  db: SqliteDatabase,
  input: {
    projectId: string
    domain: string
    marketId: string | null
    before: 'previous' | string
    /** Also list the links behind `now` (the Overview's share drill). */
    links?: boolean
  }
): CitationShare {
  const pages = sharePages(db, input.projectId)
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const profile = readProjectProfile(db)
  const context = competitorContext(db, {})
  const lens: SiteLens = {
    ownDomain: input.domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    lists: { direct: context.direct, partial: context.partial }
  }
  const cutoff = input.before === 'previous' ? null : input.before
  const { latest, previous, atCutoff } = runsByKey(
    db,
    input.projectId,
    pages,
    input.marketId,
    cutoff
  )
  let links: OverviewShareLink[] = []
  const totals = (runs: Iterable<StoredCheckRun>, detail = false): ShareTotals | null => {
    const tallies = emptyTallies()
    let any = false
    for (const run of runs) {
      const page = pageById.get(run.pageId)
      if (page === undefined) continue
      any = true
      tallyRun(tallies, {
        db,
        projectId: input.projectId,
        run,
        page,
        productKey: '',
        lens,
        detail
      })
    }
    if (!any) return null
    if (detail) links = shareLinks(tallies)
    return {
      own: tallies.sites.get(YOU_KEY)?.citations ?? 0,
      all: tallies.citations,
      questions: tallies.questions.size
    }
  }
  return {
    now: totals(latest.values(), input.links === true) ?? { own: 0, all: 0, questions: 0 },
    before: totals((cutoff === null ? previous : atCutoff).values()),
    checks: latest.size,
    links
  }
}

/** Every link the tallies counted (detail runs), own links first, then by question and position. */
function shareLinks(tallies: Tallies): OverviewShareLink[] {
  const out: OverviewShareLink[] = []
  for (const tally of tallies.sites.values()) {
    const own = tally.site.key === YOU_KEY
    for (const link of tally.links) {
      out.push({ ...link, host: hostOf(link.url, tally.site.host), own })
    }
  }
  out.sort(
    (left, right) =>
      Number(right.own) - Number(left.own) ||
      left.promptText.localeCompare(right.promptText) ||
      left.position - right.position ||
      left.id.localeCompare(right.id)
  )
  // Each site numbers its own links from 0, so ids repeat across sites: give every
  // link of the share its own id (a list keyed by id must never see two the same).
  const seen = new Map<string, number>()
  return out.map((link) => {
    const base = `${link.pageId}|${link.promptId}|${link.runId}|p${link.position}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return { ...link, id: count === 0 ? base : `${base}|${count}` }
  })
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || fallback
  } catch {
    return fallback
  }
}

/** A share as a whole percent. Null when nothing was cited. */
export function sharePercentOf(totals: ShareTotals | null): number | null {
  if (totals === null || totals.all === 0) return null
  return Math.round((totals.own / totals.all) * 100)
}
