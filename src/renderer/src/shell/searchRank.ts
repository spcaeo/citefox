import { PAGE_FIX_KIND_COPY } from '@shared/page-fixes'
import { withDrawerOpened } from './drawerUrl'
import { SEARCH_CATALOG, type CatalogEntry, type CatalogTarget } from './searchCatalog'
import type { SearchOption } from './search'

/**
 * Ranking for Ctrl+K: how well a typed query fits an entry's name, its other
 * words and where it lives. Every typed word must fit somewhere (a word's start,
 * so "comp" finds Competitors); a whole phrase that is one of the entry's words
 * ("dark mode", "how often", "to do") fits best. Pure, so it runs on every key
 * with no call to main.
 */

/**
 * Words that carry no meaning in a search ("open the guide" is "guide"), including
 * the question words of a help question ("why is what changed empty" is "changed empty").
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'my',
  'of',
  'for',
  'in',
  'on',
  'me',
  'i',
  'go',
  'open',
  'show',
  'see',
  'find',
  'please',
  'where',
  'is',
  'how',
  'do',
  'can',
  'with',
  'what',
  'why',
  'when',
  'which',
  'does',
  'are',
  'am',
  'it',
  'we',
  'our',
  'should'
])

/** Lower case, words only: "Fixes · Did it work?" is "fixes did it work". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .trim()
}

function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean)
}

/** The words of a query that mean something; all of them when every word is a stop word. */
export function queryWords(query: string): string[] {
  const all = tokens(query)
  const meaningful = all.filter((word) => !STOP_WORDS.has(word))
  return meaningful.length > 0 ? meaningful : all
}

/** What an entry is searched by. */
export interface Searchable {
  text: string
  words?: readonly string[]
  detail?: string | null
}

/** How well `query` fits `entry`: 0 is no match, higher is better. */
export function scoreEntry(query: string, entry: Searchable): number {
  const phrase = normalize(query)
  const words = queryWords(query)
  if (phrase === '' || words.length === 0) return 0
  const name = normalize(entry.text)
  const phrases = (entry.words ?? []).map(normalize)
  if (name === phrase) return 1000
  if (name.startsWith(phrase)) return 900
  if (phrases.includes(phrase)) return 800
  const nameTokens = tokens(entry.text)
  const otherTokens = phrases.flatMap((item) => item.split(' '))
  const detailTokens = tokens(entry.detail ?? '')
  let total = 0
  let inName = true
  for (const word of words) {
    let best = 0
    if (nameTokens.includes(word)) best = 40
    else if (nameTokens.some((token) => token.startsWith(word))) best = 30
    if (best === 0) {
      inName = false
      if (otherTokens.includes(word)) best = 25
      else if (word.length >= 3 && otherTokens.some((token) => token.startsWith(word))) best = 15
      else if (detailTokens.some((token) => token.startsWith(word))) best = 8
      else if (word.length >= 4 && name.includes(word)) best = 5
    }
    if (best === 0) return 0
    total += best
  }
  return 100 + total + (inName ? 100 : 0)
}

/** The best matches of `items`, best first, at most `limit`. */
export function rank<T>(
  query: string,
  items: readonly T[],
  searchable: (item: T) => Searchable,
  limit: number
): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreEntry(query, searchable(item)) }))
    .filter((found) => found.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((found) => found.item)
}

/** The link an entry opens: its route, or its drawer over `hash` (the screen open now). */
export function targetHref(target: CatalogTarget, hash: string): string {
  if ('hash' in target) return target.hash
  if ('drawer' in target) return withDrawerOpened(hash, target.drawer, target.values ?? {})
  return ''
}

function catalogOption(entry: CatalogEntry, hash: string): SearchOption {
  return {
    key: `${entry.group}:${entry.id}`,
    href: targetHref(entry.target, hash),
    text: entry.text,
    detail: entry.detail,
    ...('theme' in entry.target ? { theme: entry.target.theme } : {})
  }
}

/** Results shown per group at most. */
export const GROUP_LIMIT = {
  actions: 5,
  screens: 6,
  help: 4,
  competitors: 5,
  fixes: 5,
  reports: 3
} as const

/** Actions, screens and help topics matching `query`, best first, with links over `hash`. */
export function findCatalog(
  query: string,
  hash: string,
  catalog: readonly CatalogEntry[] = SEARCH_CATALOG
): { actions: SearchOption[]; screens: SearchOption[]; help: SearchOption[] } {
  const pick = (group: CatalogEntry['group'], limit: number): SearchOption[] =>
    rank(
      query,
      catalog.filter((entry) => entry.group === group),
      (entry) => entry,
      limit
    ).map((entry) => catalogOption(entry, hash))
  return {
    actions: pick('actions', GROUP_LIMIT.actions),
    screens: pick('screens', GROUP_LIMIT.screens),
    help: pick('help', GROUP_LIMIT.help)
  }
}

/** The project's things Ctrl+K finds besides topics, pages and questions (`useSearchData`). */
export interface SearchData {
  competitors: readonly { id: string; name: string; domain: string | null }[]
  pageFixes: readonly {
    id: string
    title: string
    kind: keyof typeof PAGE_FIX_KIND_COPY
    topics: string
  }[]
  logged: readonly { id: string; number: number; page: string }[]
  reports: readonly { id: string; name: string }[]
}

export const NO_SEARCH_DATA: SearchData = {
  competitors: [],
  pageFixes: [],
  logged: [],
  reports: []
}

/** Competitors, fixes and report schedules matching `query`; each opens where the app opens it. */
export function findData(
  query: string,
  data: SearchData,
  hash: string
): { competitors: SearchOption[]; fixes: SearchOption[]; reports: SearchOption[] } {
  const competitors = rank(
    query,
    data.competitors,
    (item) => ({ text: item.name, words: item.domain ? [item.domain] : [], detail: item.domain }),
    GROUP_LIMIT.competitors
  ).map((item) => ({
    key: `competitor:${item.id}`,
    href: withDrawerOpened(hash, 'competitor', { competitor: item.id }),
    text: item.name,
    detail: item.domain
  }))
  const pageFixes = data.pageFixes.map((item) => ({
    key: `page-fix:${item.id}`,
    search: {
      text: item.title,
      words: [PAGE_FIX_KIND_COPY[item.kind].title, item.topics, 'fix', 'brief'],
      detail: PAGE_FIX_KIND_COPY[item.kind].title
    },
    href: withDrawerOpened(hash, 'page-fix', { 'pfx.id': item.id }),
    detail: `${PAGE_FIX_KIND_COPY[item.kind].title} · ${item.topics}`
  }))
  const logged = data.logged.map((item) => ({
    key: `fix:${item.id}`,
    search: {
      text: `Fix ${item.number} · ${item.page}`,
      words: ['logged fix', 'change', 'fix'],
      detail: 'Logged fix'
    },
    href: withDrawerOpened(hash, 'fix', { fix: item.id }),
    detail: 'Logged fix'
  }))
  const fixes = rank(
    query,
    [...pageFixes, ...logged],
    (item) => item.search,
    GROUP_LIMIT.fixes
  ).map((item) => ({ key: item.key, href: item.href, text: item.search.text, detail: item.detail }))
  const reports = rank(
    query,
    data.reports,
    (item) => ({ text: item.name, words: ['report', 'schedule'], detail: 'Report schedule' }),
    GROUP_LIMIT.reports
  ).map((item) => ({
    key: `report:${item.id}`,
    // The schedule drawer belongs to Reports: open it there.
    href: `#/reports?drawer=schedule&schedule.id=${encodeURIComponent(item.id)}`,
    text: item.name,
    detail: 'Report schedule'
  }))
  return { competitors, fixes, reports }
}
