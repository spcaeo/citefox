import type {
  CompanySuggestion,
  FillFromWebsiteResult,
  FillSearchFound,
  FillSiteFound,
  ProductCompetitorsRequest,
  ProductCompetitorsResult,
  ProductSearchState
} from '@shared/ipc'
import { fold } from '../setupApply'

/**
 * What step 3's read has found so far (owner, 2026-10-29: "how many have you found, can
 * you list them in real time"), built from the `found` part of `projects:fillProgress`
 * events, the read's own answer, and the user's "Try again" per product. Pure.
 */

/** One product's competitor search as its line shows it. */
export interface ProductSearch {
  id: string
  name: string
  state: ProductSearchState
  /** Epoch ms it got its turn and started searching, and when it ended. */
  startedAt: number | null
  endedAt: number | null
  /** Its checked competitors once done. */
  competitors: readonly CompanySuggestion[]
  /** Why it did not finish, in plain words. */
  note: string | null
  /** The user asked for this search again. */
  retried: boolean
}

export interface ReadLive {
  /** The site read (what it sells, brand names, what its pages name). Null until it is in. */
  site: FillSiteFound | null
  searches: readonly ProductSearch[]
  /** Names found for "who buys from you" and "what sends them looking". */
  buyers: readonly string[]
  triggers: readonly string[]
}

export type LiveAction =
  | { type: 'site'; found: FillSiteFound }
  | { type: 'search'; found: FillSearchFound; at: number }
  | { type: 'retry'; productId: string; at: number }
  | { type: 'retried'; result: ProductCompetitorsResult; at: number }
  /** The read's answer: settles any search it has news of (and fills in a read with no events). */
  | { type: 'final'; fill: FillFromWebsiteResult; at: number }
  /** The read stopped after the site was in: searches still open did not finish. */
  | { type: 'lost'; note: string; at: number }
  | { type: 'rows'; list: 'buyers' | 'triggers'; names: readonly string[] }

export const EMPTY_LIVE: ReadLive = { site: null, searches: [], buyers: [], triggers: [] }

/** The line for a search the read's answer says did not finish. */
export const NOT_FINISHED_NOTE = 'CiteFox AI did not finish this search.'

function waiting(id: string, name: string): ProductSearch {
  return {
    id,
    name,
    state: 'waiting',
    startedAt: null,
    endedAt: null,
    competitors: [],
    note: null,
    retried: false
  }
}

function settled(search: ProductSearch): boolean {
  return search.state === 'done' || search.state === 'failed'
}

function update(
  live: ReadLive,
  productId: string,
  change: (search: ProductSearch) => ProductSearch
): ReadLive {
  if (!live.searches.some((search) => search.id === productId)) return live
  return {
    ...live,
    searches: live.searches.map((search) => (search.id === productId ? change(search) : search))
  }
}

function onSearch(search: ProductSearch, found: FillSearchFound, at: number): ProductSearch {
  switch (found.state) {
    case 'waiting':
      return search
    case 'running':
      return settled(search)
        ? search
        : { ...search, state: 'running', startedAt: search.startedAt ?? at }
    case 'done':
      return {
        ...search,
        state: 'done',
        startedAt: search.startedAt ?? at,
        endedAt: at,
        competitors: found.competitors,
        note: null
      }
    case 'failed':
      return {
        ...search,
        state: 'failed',
        endedAt: at,
        competitors: [],
        note: found.note ?? NOT_FINISHED_NOTE
      }
  }
}

/** The site part of a read's answer, for a read that sent no `site` event. */
function siteOf(fill: FillFromWebsiteResult): FillSiteFound {
  return {
    kind: 'site',
    summary: fill.summary ?? null,
    brands: fill.brands,
    products: fill.products ?? [],
    comparedWith: [],
    switchingFrom: fill.switchingFrom,
    integrations: fill.integrations,
    suggestedMarket: fill.suggestedMarket,
    market: null
  }
}

/** Settles a still-open search from the read's answer. */
function fromFill(search: ProductSearch, fill: FillFromWebsiteResult, at: number): ProductSearch {
  if (settled(search) || search.retried) return search
  const product = (fill.products ?? []).find((item) => item.id === search.id)
  if (product === undefined) return search
  if (product.searchNote !== null) {
    return { ...search, state: 'failed', endedAt: at, note: NOT_FINISHED_NOTE }
  }
  return {
    ...search,
    state: 'done',
    endedAt: at,
    competitors: fill.competitors.filter((row) => row.product === search.id),
    note: null
  }
}

export function reduceLive(live: ReadLive, action: LiveAction): ReadLive {
  switch (action.type) {
    case 'site': {
      const known = new Map(live.searches.map((search) => [search.id, search]))
      return {
        ...live,
        site: action.found,
        searches: action.found.products.map(
          (product) => known.get(product.id) ?? waiting(product.id, product.name)
        )
      }
    }
    case 'search':
      return update(live, action.found.productId, (search) =>
        onSearch(search, action.found, action.at)
      )
    case 'retry':
      return update(live, action.productId, (search) => ({
        ...search,
        state: 'running',
        startedAt: action.at,
        endedAt: null,
        competitors: [],
        note: null,
        retried: true
      }))
    case 'retried':
      return update(live, action.result.productId, (search) => ({
        ...search,
        state: action.result.ok ? 'done' : 'failed',
        endedAt: action.at,
        competitors: action.result.competitors,
        note: action.result.ok ? null : (action.result.note ?? NOT_FINISHED_NOTE)
      }))
    case 'final': {
      const base =
        live.site === null ? reduceLive(live, { type: 'site', found: siteOf(action.fill) }) : live
      return {
        ...base,
        searches: base.searches.map((search) => fromFill(search, action.fill, action.at))
      }
    }
    case 'lost':
      return {
        ...live,
        searches: live.searches.map((search) =>
          settled(search) || search.retried
            ? search
            : { ...search, state: 'failed', endedAt: action.at, note: action.note }
        )
      }
    case 'rows':
      return { ...live, [action.list]: action.names }
  }
}

/** Every search finished or failed (true when there is none). */
export function searchesSettled(live: ReadLive): boolean {
  return live.searches.every(settled)
}

/** A search the user asked for again is still running. */
export function retrying(live: ReadLive): boolean {
  return live.searches.some((search) => search.retried && search.state === 'running')
}

/** A search is still open or did not finish (step 3's done view and step 6 show the lines). */
export function searchesNeedAttention(live: ReadLive): boolean {
  return live.searches.some((search) => search.state !== 'done')
}

export function failedSearches(live: ReadLive): readonly ProductSearch[] {
  return live.searches.filter((search) => search.state === 'failed')
}

/** The competitors found so far, once each by name, in product order. */
export function competitorsSoFar(live: ReadLive): CompanySuggestion[] {
  const seen = new Set<string>()
  const rows: CompanySuggestion[] = []
  for (const search of live.searches) {
    for (const row of search.competitors) {
      const key = fold(row.name)
      if (key.length === 0 || seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }
  return rows
}

/** Rivals the site's own pages name that no search has listed (yet). */
export function siteNamedOnly(live: ReadLive): string[] {
  const seen = new Set(competitorsSoFar(live).map((row) => fold(row.name)))
  const names: string[] = []
  for (const name of live.site?.comparedWith ?? []) {
    const key = fold(name)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/** The read so far as a Fill answer, for the draft: the site, and each finished search. */
export function liveFill(live: ReadLive, domain: string): FillFromWebsiteResult {
  const site = live.site
  const failed = new Set(failedSearches(live).map((search) => search.id))
  return {
    domain,
    pagesRead: [],
    summary: site?.summary ?? null,
    products: (site?.products ?? []).map((product) => ({
      ...product,
      searchNote: failed.has(product.id) ? NOT_FINISHED_NOTE : null
    })),
    brands: site?.brands ?? [],
    competitors: live.searches.flatMap((search) => search.competitors),
    switchingFrom: site?.switchingFrom ?? [],
    integrations: site?.integrations ?? [],
    suggestedMarket: site?.suggestedMarket ?? null,
    message: '',
    nextStep: null
  }
}

/** "Try again" for one product: the same question the read asked. Null without the site read. */
export function retryRequest(
  live: ReadLive,
  domain: string,
  productId: string
): ProductCompetitorsRequest | null {
  const site = live.site
  const product = site?.products.find((item) => item.id === productId)
  if (site === null || product === undefined) return null
  // Within what main accepts (`parseProductCompetitors`).
  const cut = (text: string, max: number): string => text.trim().slice(0, max).trim()
  const names = (list: readonly string[], count: number, max: number): string[] =>
    list
      .map((name) => cut(name, max))
      .filter((name) => name.length > 0)
      .slice(0, count)
  const summary = site.summary === null ? '' : cut(site.summary, 4000)
  return {
    projectId: null,
    domain,
    market: site.market,
    summary: summary.length > 0 ? summary : null,
    product: {
      id: product.id,
      name: cut(product.name, 200),
      job: cut(product.job, 2000) || cut(product.name, 200),
      buyer: cut(product.buyer, 600)
    },
    comparedWith: names(site.comparedWith, 20, 80),
    brandNames: names(
      site.brands.map((brand) => brand.name),
      30,
      120
    ),
    notCompetitors: names(
      [...site.switchingFrom, ...site.integrations].map((company) => company.name),
      60,
      200
    )
  }
}
