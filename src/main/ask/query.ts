import type { Market, PageSummary, PromptCheckRow } from '@shared/domain'
import { ASK_ROW_LIMIT, type AskFilters, type AskOption, type AskRow } from '@shared/ipc'
import { loadPageResults } from '../engine/checks/results'
import type { SqliteDatabase } from '../storage/database'
import { listPageMarkets, listPages } from '../storage/pages'
import { listMarkets } from '../storage/project-profile'
import type { ProjectRecord } from '../storage/records'

/**
 * The deterministic half of Ask CiteFox (FR-25.7). Reads each page's latest
 * finished full check in each of its markets, through the same loader as the
 * results screen, and filters those prompt checks locally. Never calls Claude
 * and never makes a search.
 */

/** One stored prompt check, with the prompt's place in its set for sorting. */
export interface StoredAskRow extends AskRow {
  promptPosition: number
}

/** Everything one answer can filter: the latest prompt checks and the names behind ids. */
export interface AskScope {
  /** Pages still on the list, oldest first. */
  pages: readonly (AskOption & { url: string | null })[]
  /** The project's markets, default first. */
  markets: readonly AskOption[]
  /** Every latest prompt check, sorted by page, market, and prompt position. */
  rows: readonly StoredAskRow[]
  /** The project's own domain, left out of "other sites cited". */
  domain?: string
}

export interface AskQueryResult {
  /** The filters that ran: unknown page and market ids dropped. */
  filters: AskFilters
  /** Matches, at most {@link ASK_ROW_LIMIT}. */
  rows: readonly AskRow[]
  total: number
  searched: number
  checkedThrough: string | null
  /** Every match, for the answer text. */
  matched: readonly StoredAskRow[]
  /** Every row searched, so a "no match" answer can say which filter found nothing. */
  scopeRows: readonly StoredAskRow[]
  /** The project's own domain, when known. */
  ownDomain: string | null
}

/** Pages that are gone from the list keep their data, but Ask CiteFox leaves them out. */
const HIDDEN_PAGE_STATUSES: ReadonlySet<PageSummary['status']> = new Set(['removed', 'not_tracked'])

export function readAskScope(db: SqliteDatabase, project: ProjectRecord, now: Date): AskScope {
  const markets = listMarkets(db)
  const marketLabels = new Map(markets.map((market) => [market.id, askMarketLabel(market)]))
  const pages = listPages(db, project.id).filter((page) => !HIDDEN_PAGE_STATUSES.has(page.status))
  const builtAt = now.toISOString()
  const rows: StoredAskRow[] = []
  for (const page of pages) {
    const pageLabel = askPageLabel(page)
    for (const { marketId } of listPageMarkets(db, page.id)) {
      const results = loadPageResults(db, {
        projectId: project.id,
        pageId: page.id,
        marketId,
        runId: null,
        builtAt,
        domain: project.domain,
        keyLabels: new Map()
      })
      if (results.run === null) continue
      const marketLabel = marketLabels.get(marketId) ?? marketId
      for (const prompt of results.prompts) {
        rows.push(toRow(prompt, { page, pageLabel, marketId, marketLabel }))
      }
    }
  }
  rows.sort(compareRows)
  return {
    pages: pages.map((page) => ({
      id: page.id,
      label: askPageLabel(page),
      url: page.url,
      kind: page.kind ?? 'page'
    })),
    markets: markets.map((market) => ({ id: market.id, label: askMarketLabel(market) })),
    rows,
    domain: project.domain
  }
}

/** The filters with page and market ids this project does not have removed. */
export function knownFilters(filters: AskFilters, scope: AskScope): AskFilters {
  const pageIds = keepKnown(filters.pageIds, scope.pages)
  const marketIds = keepKnown(filters.marketIds, scope.markets)
  return { ...filters, pageIds, marketIds }
}

export function matchesFilters(row: AskRow, filters: AskFilters): boolean {
  if (filters.pageIds !== null && !filters.pageIds.includes(row.pageId)) return false
  if (filters.marketIds !== null && !filters.marketIds.includes(row.marketId)) return false
  if (filters.statuses !== null && !filters.statuses.includes(row.status)) return false
  if (filters.intentStages !== null && !filters.intentStages.includes(row.intentStage)) {
    return false
  }
  if (filters.movements !== null) {
    if (row.movement === null || !filters.movements.includes(row.movement)) return false
  }
  if (filters.citedDomain !== null && !citesDomain(row, filters.citedDomain)) return false
  if (filters.text !== null && !containsWords(row.promptText, filters.text)) return false
  return true
}

export function queryScope(scope: AskScope, requested: AskFilters): AskQueryResult {
  const filters = knownFilters(requested, scope)
  const matched = scope.rows.filter((row) => matchesFilters(row, filters))
  return {
    filters,
    rows: matched.slice(0, ASK_ROW_LIMIT).map(publicRow),
    total: matched.length,
    searched: scope.rows.length,
    checkedThrough: newest(scope.rows.map((row) => row.checkedAt)),
    matched,
    scopeRows: scope.rows,
    ownDomain: scope.domain === undefined ? null : bareDomain(scope.domain)
  }
}

/** Reads the stored results and runs the filters over them. */
export function runAskQuery(
  db: SqliteDatabase,
  project: ProjectRecord,
  filters: AskFilters,
  now: Date
): AskQueryResult & { scope: AskScope } {
  const scope = readAskScope(db, project, now)
  return { ...queryScope(scope, filters), scope }
}

/** Domains cited in the latest checks, by how many prompt checks cite them. */
export function citedDomainCounts(rows: readonly AskRow[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const domain of row.citedDomains) counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([domain]) => domain)
}

/** "US · EN", "US · Austin · EN". No flag: the label is also read aloud and written to CSV. */
export function askMarketLabel(market: Pick<Market, 'country' | 'language' | 'location'>): string {
  const language = (market.language.split('-')[0] ?? market.language).toUpperCase()
  const place = market.location ? `${market.country} · ${market.location}` : market.country
  return `${place} · ${language}`
}

/** The page's label, else its title, else its URL path. */
export function askPageLabel(page: Pick<PageSummary, 'label' | 'title' | 'url'>): string {
  const label = page.label?.trim()
  if (label) return label
  const title = page.title?.trim()
  if (title) return title
  if (page.url === null) return 'Topic'
  try {
    const path = new URL(page.url).pathname
    return path === '/' ? page.url : path
  } catch {
    return page.url
  }
}

function toRow(
  prompt: PromptCheckRow,
  where: { page: PageSummary; pageLabel: string; marketId: string; marketLabel: string }
): StoredAskRow {
  const domains: string[] = []
  for (const reference of prompt.references) {
    const domain = bareDomain(reference.domain)
    if (domain.length > 0 && !domains.includes(domain)) domains.push(domain)
  }
  return {
    pageId: where.page.id,
    pageLabel: where.pageLabel,
    pageUrl: where.page.url,
    pageKind: where.page.kind ?? 'page',
    marketId: where.marketId,
    marketLabel: where.marketLabel,
    promptId: prompt.promptId,
    promptText: prompt.text,
    intentStage: prompt.intentStage,
    status: prompt.status,
    position: prompt.position,
    movement: prompt.movement,
    citedDomains: domains,
    checkedAt: prompt.checkedAt,
    promptPosition: prompt.promptPosition
  }
}

function publicRow(row: StoredAskRow): AskRow {
  const { promptPosition, ...rest } = row
  void promptPosition
  return rest
}

function compareRows(left: StoredAskRow, right: StoredAskRow): number {
  return (
    left.pageLabel.localeCompare(right.pageLabel) ||
    left.pageId.localeCompare(right.pageId) ||
    left.marketLabel.localeCompare(right.marketLabel) ||
    left.marketId.localeCompare(right.marketId) ||
    left.promptPosition - right.promptPosition
  )
}

function keepKnown(
  ids: readonly string[] | null,
  known: readonly AskOption[]
): readonly string[] | null {
  if (ids === null) return null
  const kept = ids.filter((id) => known.some((option) => option.id === id))
  return kept.length === 0 ? null : kept
}

export function citesDomain(row: AskRow, domain: string): boolean {
  const wanted = bareDomain(domain)
  return row.citedDomains.some((cited) => cited === wanted || cited.endsWith(`.${wanted}`))
}

function containsWords(text: string, words: string): boolean {
  const haystack = text.toLowerCase()
  return words
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .every((word) => haystack.includes(word))
}

export function bareDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
}

function newest(values: readonly (string | null)[]): string | null {
  let latest: string | null = null
  for (const value of values) {
    if (value !== null && (latest === null || value > latest)) latest = value
  }
  return latest
}
