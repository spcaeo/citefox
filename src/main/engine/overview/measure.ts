import type { AioReference, PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import { cleanHost } from '@shared/competitor-hosts'
import type {
  OverviewCitedSite,
  OverviewOwnPage,
  OverviewQuestion,
  OverviewSource,
  OverviewYouStatus
} from '@shared/ipc'
import { citationChange, type CitationChange, type DiffSide } from '@shared/report/diff'
import { sameTargetPage } from '@shared/target-page'
import { isOwnReference } from '@shared/topic-scoring'
import { storedCompetitor, type CompetitorLists } from '../checks/competitor-match'
import type { QuestionOutcome } from './timeline'

/**
 * The definitions every Overview number uses. They are the ones the page and
 * topic screens use, so the numbers agree:
 *
 * - an AI Overview showed: the winning status is not `no_aio` or `error`;
 * - cited: that overview's references include an own-domain link (the check's
 *   `target` or `own` classification), as Topic results' cited states and
 *   Results' `page_cited` + `other_own_page`;
 * - named: the check found the brand in the overview text (`named`, FR-6.4);
 * - share of citations: own links ÷ all links in those overviews, each link
 *   once per question (as Results counts citations).
 */

const AIO_STATUSES = new Set<PromptCheckStatus>([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

export function hasAio(row: PromptCheckRow): boolean {
  return AIO_STATUSES.has(row.status)
}

export function isCited(row: PromptCheckRow): boolean {
  return hasAio(row) && row.references.some(isOwnReference)
}

export function isNamed(row: PromptCheckRow): boolean {
  return hasAio(row) && row.named === true
}

/** Each cited link once per question. */
function distinctLinks(row: PromptCheckRow): AioReference[] {
  const seen = new Set<string>()
  const out: AioReference[] = []
  for (const reference of row.references) {
    if (seen.has(reference.normalizedUrl)) continue
    seen.add(reference.normalizedUrl)
    out.push(reference)
  }
  return out
}

export interface Counts {
  withAio: number
  cited: number
  named: number
  ownCitations: number
  allCitations: number
}

export function countOutcomes(outcomes: Iterable<QuestionOutcome>): Counts {
  const counts: Counts = { withAio: 0, cited: 0, named: 0, ownCitations: 0, allCitations: 0 }
  for (const { row } of outcomes) {
    if (!hasAio(row)) continue
    counts.withAio += 1
    if (isCited(row)) counts.cited += 1
    if (isNamed(row)) counts.named += 1
    for (const link of distinctLinks(row)) {
      counts.allCitations += 1
      if (isOwnReference(link)) counts.ownCitations += 1
    }
  }
  return counts
}

/** Own links as a whole percent of all links. Null when there are no links. */
export function sharePercent(counts: Pick<Counts, 'ownCitations' | 'allCitations'>): number | null {
  if (counts.allCitations === 0) return null
  return Math.round((counts.ownCitations / counts.allCitations) * 100)
}

export function youStatus(row: PromptCheckRow): OverviewYouStatus {
  if (row.status === 'error') return 'error'
  if (row.status === 'no_aio') return 'no_aio'
  if (isCited(row)) return 'cited'
  if (isNamed(row)) return 'named'
  return 'not_cited'
}

/**
 * The target page when any link is to it, else another own page; null when not cited.
 * A topic has no URL of its own: its question's target page (`topic_prompts`) is
 * matched against the own links, as the topic page does (`deriveRowState`), so
 * Summary and Topics count the same "Target page".
 */
export function ownPageOf(row: PromptCheckRow, topicTarget?: TopicTarget): OverviewOwnPage | null {
  if (!isCited(row)) return null
  if (topicTarget !== undefined) {
    return row.references.some(
      (reference) => isOwnReference(reference) && sameTargetPage(reference.url, topicTarget.url)
    )
      ? 'target'
      : 'other'
  }
  return row.references.some((reference) => reference.classification === 'target')
    ? 'target'
    : 'other'
}

/** A topic question's target page. `url` null: no target page yet. */
export interface TopicTarget {
  url: string | null
}

/** Best (lowest) own reference position. */
export function ownPosition(row: PromptCheckRow): number | null {
  const positions = row.references.filter(isOwnReference).map((reference) => reference.position)
  return positions.length === 0 ? null : Math.min(...positions)
}

/** A cited site as people know it: the product's competitor name, else its domain. */
function siteOf(
  reference: AioReference,
  lists: CompetitorLists
): { name: string; domain: string; competitor: boolean } {
  const domain = cleanHost(reference.domain || reference.url)
  const hit = storedCompetitor(reference, lists)
  return hit === null
    ? { name: domain, domain, competitor: false }
    : { name: hit.name, domain, competitor: true }
}

/** Up to `limit` other sites in reference order, each once. */
export function citedInstead(row: PromptCheckRow, lists: CompetitorLists, limit = 3): string[] {
  const out: string[] = []
  const sorted = [...row.references].sort((left, right) => left.position - right.position)
  for (const reference of sorted) {
    if (isOwnReference(reference)) continue
    const { name } = siteOf(reference, lists)
    if (name.length === 0 || out.includes(name)) continue
    out.push(name)
    if (out.length >= limit) break
  }
  return out
}

/** The other sites one overview cites, each once, keyed by lower-case name. */
export function sitesCitedBy(
  row: PromptCheckRow,
  lists: CompetitorLists
): Map<string, { name: string; domain: string; competitor: boolean }> {
  const sites = new Map<string, { name: string; domain: string; competitor: boolean }>()
  if (!hasAio(row)) return sites
  for (const reference of row.references) {
    if (isOwnReference(reference)) continue
    const site = siteOf(reference, lists)
    const key = site.name.toLowerCase()
    if (key.length === 0 || sites.has(key)) continue
    sites.set(key, site)
  }
  return sites
}

/** Questions citing each other site, by lower-case name, and questions citing you. */
export function siteCounts(
  outcomes: Iterable<QuestionOutcome>,
  listsFor: (pageId: string) => CompetitorLists
): { sites: Map<string, OverviewCitedSite>; own: number; ownKeys: readonly string[] } {
  const sites = new Map<string, OverviewCitedSite & { keys: string[] }>()
  const ownKeys: string[] = []
  for (const outcome of outcomes) {
    const { row } = outcome
    if (!hasAio(row)) continue
    if (isCited(row)) ownKeys.push(outcome.key)
    for (const [key, site] of sitesCitedBy(row, listsFor(outcome.pageId))) {
      const current = sites.get(key)
      if (current === undefined) {
        sites.set(key, { ...site, count: 1, own: false, before: null, keys: [outcome.key] })
      } else {
        current.count += 1
        current.keys.push(outcome.key)
      }
    }
  }
  return { sites, own: ownKeys.length, ownKeys }
}

/**
 * "Who gets cited": questions whose overview cites each site, top `limit`
 * other sites plus the project itself, most cited first. With `before` (the
 * compared check's counts), each row carries its earlier count.
 */
export function citedSites(
  outcomes: Iterable<QuestionOutcome>,
  listsFor: (pageId: string) => CompetitorLists,
  own: { name: string; domain: string },
  limit = 5,
  before: { sites: ReadonlyMap<string, OverviewCitedSite>; own: number } | null = null
): OverviewCitedSite[] {
  const counted = siteCounts(outcomes, listsFor)
  const top = [...counted.sites.entries()]
    .sort(
      ([, left], [, right]) =>
        right.count - left.count ||
        Number(right.competitor) - Number(left.competitor) ||
        left.name.localeCompare(right.name)
    )
    .slice(0, limit)
    .map(([key, site]) => ({
      ...site,
      before: before === null ? null : (before.sites.get(key)?.count ?? 0)
    }))
  const you: OverviewCitedSite = {
    name: own.name,
    domain: own.domain,
    count: counted.own,
    own: true,
    competitor: false,
    before: before === null ? null : before.own,
    keys: counted.ownKeys
  }
  // The project sits among the others by its count; on a tie it goes first.
  return [...top, you].sort(
    (left, right) => right.count - left.count || Number(right.own) - Number(left.own)
  )
}

/** How the diff reads one Overview outcome: cited is the own domain in its overview. */
export function overviewSide(row: PromptCheckRow): DiffSide {
  return { cited: isCited(row), failed: row.status === 'error' }
}

const CHANGE_ORDER: readonly (CitationChange | null)[] = ['gained', 'lost', 'kept', 'never', null]

/** The best own reference's URL when cited. */
function ownUrl(row: PromptCheckRow): string | null {
  const own = [...row.references]
    .filter(isOwnReference)
    .sort((left, right) => left.position - right.position)[0]
  return own?.url ?? row.citedUrl ?? null
}

/**
 * Every question of the latest state, with its change since `before` (the
 * compared state). Gained and lost first, then kept, never cited and unmatched.
 * `comparable` false for a page or topic hides its changes (the 90% coverage rule).
 */
export function questionRows(
  before: ReadonlyMap<string, QuestionOutcome> | null,
  now: ReadonlyMap<string, QuestionOutcome>,
  sourceOf: (pageId: string) => OverviewSource,
  listsFor: (pageId: string) => CompetitorLists,
  comparable: (pageId: string) => boolean = () => true,
  /** A topic question's target page; undefined for a tracked page's question. */
  topicTarget: (pageId: string, promptId: string) => TopicTarget | undefined = () => undefined
): OverviewQuestion[] {
  const out: OverviewQuestion[] = []
  for (const [key, after] of now) {
    const earlier = before?.get(key) ?? null
    const change = comparable(after.pageId)
      ? citationChange(earlier === null ? null : overviewSide(earlier.row), overviewSide(after.row))
      : null
    const cited = isCited(after.row)
    out.push({
      key,
      pageId: after.pageId,
      promptId: after.promptId,
      marketId: after.marketId,
      runId: after.runId,
      text: after.text,
      source: sourceOf(after.pageId),
      you: youStatus(after.row),
      ownPage: ownPageOf(after.row, topicTarget(after.pageId, after.promptId)),
      position: cited ? ownPosition(after.row) : null,
      citedUrl: cited ? ownUrl(after.row) : null,
      citedInstead: citedInstead(after.row, listsFor(after.pageId)),
      change,
      before:
        earlier === null
          ? null
          : {
              you: youStatus(earlier.row),
              ownPage: ownPageOf(earlier.row, topicTarget(earlier.pageId, earlier.promptId)),
              position: isCited(earlier.row) ? ownPosition(earlier.row) : null,
              checkedAt: earlier.checkedAt
            },
      checkedAt: after.checkedAt
    })
  }
  out.sort(
    (left, right) =>
      CHANGE_ORDER.indexOf(left.change) - CHANGE_ORDER.indexOf(right.change) ||
      left.text.localeCompare(right.text) ||
      left.key.localeCompare(right.key)
  )
  return out
}
