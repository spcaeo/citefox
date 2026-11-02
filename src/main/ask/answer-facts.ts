import type { PromptCheckStatus } from '@shared/domain'
import { EMPTY_ASK_FILTERS, type AskFilters } from '@shared/ipc'
import { bareDomain, matchesFilters, type AskQueryResult, type StoredAskRow } from './query'
import { MOVEMENT_WORDS, STAGE_WORDS, STATUS_WORDS } from './vocabulary'

/**
 * The extra sentences of an Ask CiteFox answer, each counted from the stored rows
 * (FR-25.7): which sites the overviews cite besides the user's, where the misses
 * pile up, and, when nothing matches, which filter found nothing. Claude writes none
 * of these words and none of these numbers.
 */

/** Statuses where the page asked about is not the one cited. */
export const MISS_STATUSES: ReadonlySet<PromptCheckStatus> = new Set([
  'not_cited',
  'brand_mentioned',
  'other_own_page'
])

/** Sites named in "Sites cited most". */
const SITE_LIMIT = 3

/**
 * "Sites cited most in these, besides yours: clicksend.com (2 of 3), textmagic.com
 * (1 of 3)." With a cited-domain filter: "Also cited with textmagic.com: …". Each
 * row counts a site once; subdomains count as their site. Null when there are none.
 */
export function sitesSentence(result: AskQueryResult): string | null {
  const own = result.ownDomain === null ? null : siteOf(result.ownDomain)
  const filtered = result.filters.citedDomain === null ? null : siteOf(result.filters.citedDomain)
  const found = new Map<string, { rows: number; best: number }>()
  for (const row of result.matched) {
    const seen = new Set<string>()
    row.citedDomains.forEach((domain, index) => {
      const site = siteOf(domain)
      if (site === own || site === filtered || seen.has(site)) return
      seen.add(site)
      const entry = found.get(site) ?? { rows: 0, best: index }
      entry.rows += 1
      entry.best = Math.min(entry.best, index)
      found.set(site, entry)
    })
  }
  if (found.size === 0) return null
  const top = [...found.entries()]
    .sort(
      ([leftSite, left], [rightSite, right]) =>
        right.rows - left.rows || left.best - right.best || leftSite.localeCompare(rightSite)
    )
    .slice(0, SITE_LIMIT)
    .map(([site, entry]) => `${site} (${entry.rows} of ${result.total})`)
  const lead =
    filtered === null
      ? 'Sites cited most in these, besides yours'
      : `Also cited with ${result.filters.citedDomain}`
  return `${lead}: ${top.join(', ')}.`
}

/**
 * "Most misses: Alerts in UK · EN (3 of its 5 prompts)." Only when the
 * misses spread over two or more page and market pairs and one has the most.
 */
export function focusSentence(result: AskQueryResult): string | null {
  const groups = new Map<string, { rows: StoredAskRow[]; first: StoredAskRow }>()
  for (const row of result.matched) {
    if (!MISS_STATUSES.has(row.status)) continue
    const key = `${row.pageId}\u0000${row.marketId}`
    const group = groups.get(key) ?? { rows: [], first: row }
    group.rows.push(row)
    groups.set(key, group)
  }
  if (groups.size < 2) return null
  const [top, next] = [...groups.values()].sort(
    (left, right) => right.rows.length - left.rows.length
  )
  // A tie picks nothing: "most" has to mean one page.
  if (top === undefined || (next !== undefined && next.rows.length === top.rows.length)) return null
  const { first } = top
  const all = result.scopeRows.filter(
    (row) => row.pageId === first.pageId && row.marketId === first.marketId
  ).length
  const markets = new Set(result.scopeRows.map((row) => row.marketId)).size
  const where = markets > 1 ? `${first.pageLabel} in ${first.marketLabel}` : first.pageLabel
  return `Most misses: ${where} (${top.rows.length} of its ${count(all, 'prompt')}).`
}

type FilterField = keyof AskFilters

/** The order a "no match" answer checks the filters in: the most telling first. */
const EXPLAIN_ORDER: readonly FilterField[] = [
  'citedDomain',
  'intentStages',
  'movements',
  'text',
  'statuses',
  'pageIds',
  'marketIds'
]

/**
 * The answer when nothing matches. It names the filter that found nothing on its
 * own ("No saved prompt check cites textmagic.com."), or, when each filter finds
 * rows but not together, what the first one found ("1 prompt check cites
 * textmagic.com: your page is cited for 1 prompt.").
 */
export function noMatchText(
  result: AskQueryResult,
  statusPhrase: (rows: readonly StoredAskRow[]) => string
): string {
  const searched = `Searched ${count(result.searched, 'prompt check')}.`
  const filters = result.filters
  const rows = result.scopeRows
  if (filters.movements !== null && rows.every((row) => row.movement === null)) {
    return `No stored results match. Movement needs two checks of a page in a market, and every saved result so far is a first check. ${searched}`
  }
  const active = EXPLAIN_ORDER.filter((field) => filters[field] !== null)
  for (const field of active) {
    if (rows.some((row) => matchesFilters(row, only(filters, field)))) continue
    return `No stored results match: no saved prompt check ${phrase(filters, field).one}. ${searched} Remove a filter to see more.`
  }
  const anchor = active[0]
  if (anchor === undefined || active.length < 2) {
    return `No stored results match these filters. ${searched} Remove a filter to see more.`
  }
  const anchored = rows.filter((row) => matchesFilters(row, only(filters, anchor)))
  const words = phrase(filters, anchor)
  const verb = anchored.length === 1 ? words.one : words.many
  return `No stored results match every filter. ${count(anchored.length, 'prompt check')} ${verb}: ${statusPhrase(anchored)}. ${searched} Remove a filter to see them.`
}

/** The filters with only one field kept. */
function only(filters: AskFilters, field: FilterField): AskFilters {
  return { ...EMPTY_ASK_FILTERS, [field]: filters[field] }
}

/** A field's condition as a verb phrase, for one row and for several. */
function phrase(filters: AskFilters, field: FilterField): { one: string; many: string } {
  switch (field) {
    case 'citedDomain':
      return { one: `cites ${filters.citedDomain}`, many: `cite ${filters.citedDomain}` }
    case 'intentStages': {
      const labels = orWords((filters.intentStages ?? []).map((stage) => STAGE_WORDS[stage].label))
      return { one: `is a ${labels} prompt`, many: `are ${labels} prompts` }
    }
    case 'movements': {
      const moved = orWords((filters.movements ?? []).map((movement) => MOVED[movement]))
      const text = `${moved} since the check before`
      return { one: text, many: text }
    }
    case 'text':
      return { one: `contains "${filters.text}"`, many: `contain "${filters.text}"` }
    case 'statuses': {
      const labels = orWords((filters.statuses ?? []).map((status) => STATUS_WORDS[status].label))
      return { one: `has the status ${labels}`, many: `have the status ${labels}` }
    }
    case 'pageIds':
      return { one: 'is for the chosen pages', many: 'are for the chosen pages' }
    case 'marketIds':
      return { one: 'is in the chosen markets', many: 'are in the chosen markets' }
  }
}

const MOVED: Readonly<Record<keyof typeof MOVEMENT_WORDS, string>> = {
  gained: 'gained a citation',
  lost: 'lost a citation',
  improved: 'moved up',
  declined: 'moved down',
  unchanged: 'stayed the same'
}

/**
 * The site a domain belongs to: `help.twilio.com` is `twilio.com`, `www.bbc.co.uk`
 * is `bbc.co.uk`. Good enough to group citations; not a public-suffix list.
 */
export function siteOf(domain: string): string {
  const parts = bareDomain(domain).split('.')
  if (parts.length <= 2) return parts.join('.')
  const top = parts[parts.length - 1] ?? ''
  const second = parts[parts.length - 2] ?? ''
  const twoLevel = top.length === 2 && SECOND_LEVELS.has(second)
  return parts.slice(twoLevel ? -3 : -2).join('.')
}

const SECOND_LEVELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or', 'gob'])

function orWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1] ?? ''}`
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`
}
