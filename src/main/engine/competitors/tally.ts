import { createHash } from 'node:crypto'
import { brandNamed } from '@shared/brand-mentions'
import { cleanHost, flatName } from '@shared/competitor-hosts'
import type { AioReference, PageSummary } from '@shared/domain'
import type {
  CitedSiteKind,
  CompetitorGapQuestion,
  CompetitorLink,
  CompetitorQuestionRef
} from '@shared/ipc'
import { bareDomain, isOwnHost } from '@shared/own-site'
import type { StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { competitorFor, storedCompetitor, type CompetitorLists } from '../checks/competitor-match'
import { runBuiltPrompts } from '../checks/results'
import { AIO_STATUSES } from '../checks/score'

/**
 * Counting cited sites across stored checks (Competitors). One rule decides what a
 * reference is: the own site by the FR-6.5 rule (or the stored `target` / `own`
 * classification), a competitor by the one competitor matcher (or the stored
 * classification when the saved list has changed since), else its host.
 */

/** What a cited reference counts as. */
export interface SiteKey {
  key: string
  kind: CitedSiteKind
  name: string
  tier: 'direct' | 'partial' | null
  host: string
}

export interface SiteLens {
  ownDomain: string
  includeSubdomains: boolean
  lists: CompetitorLists
}

export const YOU_KEY = 'you'

export function competitorKey(name: string): string {
  return `c:${flatName(name)}`
}

export function siteOf(
  reference: Pick<AioReference, 'domain' | 'classification'>,
  lens: SiteLens
): SiteKey {
  const host = cleanHost(reference.domain)
  const own = bareDomain(lens.ownDomain)
  if (
    reference.classification === 'target' ||
    reference.classification === 'own' ||
    isOwnHost(host, own, lens.includeSubdomains)
  ) {
    return { key: YOU_KEY, kind: 'you', name: own, tier: null, host }
  }
  const hit = competitorFor(host, lens.lists) ?? storedCompetitor(reference, lens.lists)
  if (hit !== null) {
    return {
      key: competitorKey(hit.name),
      kind: 'competitor',
      name: hit.name,
      tier: hit.tier,
      host
    }
  }
  return { key: `h:${host}`, kind: 'other', name: host, tier: null, host }
}

/** An opaque, stable id for a row key, so routes never carry a domain or a name. */
export function siteId(key: string): string {
  return `s${createHash('sha256').update(key).digest('hex').slice(0, 15)}`
}

/** One site's counts in a set of checks. */
export interface SiteTally {
  site: SiteKey
  citations: number
  /** `pageId|promptId`. */
  questions: Set<string>
  named: Set<string>
  /** Product id (`''` for none) → counts. */
  byProduct: Map<string, { citations: number; questions: Set<string> }>
  /** Host → links, to name a competitor's site when no domain is saved. */
  hosts: Map<string, number>
  gaps: Map<string, CompetitorGapQuestion>
  /** Latest checks only: the links behind `citations`. */
  links: CompetitorLink[]
  /** Latest checks only: the questions behind `questions` and `named`. */
  cited: Map<string, CompetitorQuestionRef>
  namedRefs: Map<string, CompetitorQuestionRef>
}

export interface Tallies {
  sites: Map<string, SiteTally>
  citations: number
  /** Questions with an overview. */
  questions: Set<string>
  /** Product id (`''` for none) → every citation in it. */
  productCitations: Map<string, number>
}

export function emptyTallies(): Tallies {
  return { sites: new Map(), citations: 0, questions: new Set(), productCitations: new Map() }
}

function ensure(tallies: Tallies, site: SiteKey): SiteTally {
  const found = tallies.sites.get(site.key)
  if (found !== undefined) return found
  const created: SiteTally = {
    site,
    citations: 0,
    questions: new Set(),
    named: new Set(),
    byProduct: new Map(),
    hosts: new Map(),
    gaps: new Map(),
    links: [],
    cited: new Map(),
    namedRefs: new Map()
  }
  tallies.sites.set(site.key, created)
  return created
}

export interface RunScope {
  db: SqliteDatabase
  projectId: string
  run: StoredCheckRun
  page: PageSummary
  /** `''` when the page has no product. */
  productKey: string
  lens: SiteLens
  /** Collect "cited and you're not" questions and names (the latest checks only). */
  detail: boolean
}

/**
 * Adds one stored run: each prompt's winning sample, its references once per URL
 * (as Results counts links), whether the overview names the brand or a competitor,
 * and the questions where a site is cited and the own site is not.
 */
export function tallyRun(tallies: Tallies, scope: RunScope): void {
  const { run, page, lens } = scope
  const competitors = [...lens.lists.direct, ...lens.lists.partial]
  for (const item of runBuiltPrompts(scope.db, scope.projectId, run)) {
    const winning = item.winning
    if (winning === null || !AIO_STATUSES.has(item.row.status)) continue
    const question = `${page.id}|${item.row.promptId}`
    tallies.questions.add(question)
    const perSite = new Map<
      string,
      { site: SiteKey; links: number; best: AioReference; refs: AioReference[] }
    >()
    const seen = new Set<string>()
    for (const reference of winning.references) {
      if (seen.has(reference.normalizedUrl)) continue
      seen.add(reference.normalizedUrl)
      const site = siteOf(reference, lens)
      const current = perSite.get(site.key)
      if (current === undefined) {
        perSite.set(site.key, { site, links: 1, best: reference, refs: [reference] })
      } else {
        current.links += 1
        current.refs.push(reference)
        if (reference.position < current.best.position) current.best = reference
      }
    }
    const ownCited = perSite.has(YOU_KEY)
    for (const { site, links, best, refs } of perSite.values()) {
      const tally = ensure(tallies, site)
      if (scope.detail) addCited(tally, scope, item, links, best, refs)
      tally.citations += links
      tally.questions.add(question)
      tally.hosts.set(site.host, (tally.hosts.get(site.host) ?? 0) + links)
      const product = tally.byProduct.get(scope.productKey) ?? {
        citations: 0,
        questions: new Set<string>()
      }
      product.citations += links
      product.questions.add(question)
      tally.byProduct.set(scope.productKey, product)
      tallies.citations += links
      tallies.productCitations.set(
        scope.productKey,
        (tallies.productCitations.get(scope.productKey) ?? 0) + links
      )
      if (scope.detail && site.kind !== 'you' && !ownCited) addGap(tally, scope, item, best)
    }
    if (!scope.detail) continue
    if (item.row.named === true) {
      const you = ensure(tallies, youSite(lens))
      you.named.add(question)
      addRef(you.namedRefs, scope, item, 0, null)
    }
    for (const competitor of competitors) {
      if (!brandNamed(winning.aioText, [competitor.name])) continue
      const tier = lens.lists.direct.includes(competitor) ? 'direct' : 'partial'
      const tally = ensure(tallies, {
        key: competitorKey(competitor.name),
        kind: 'competitor',
        name: competitor.name,
        tier,
        host: competitor.domain ?? ''
      })
      tally.named.add(question)
      addRef(tally.namedRefs, scope, item, 0, null)
    }
  }
}

type BuiltItem = ReturnType<typeof runBuiltPrompts>[number]

/** The question as a ref, once per question; a later market adds its id and links. */
function addRef(
  refs: Map<string, CompetitorQuestionRef>,
  scope: RunScope,
  item: BuiltItem,
  links: number,
  position: number | null
): void {
  const id = `${scope.page.id}|${item.row.promptId}`
  const found = refs.get(id)
  if (found !== undefined) {
    refs.set(id, {
      ...found,
      marketIds: found.marketIds.includes(scope.run.marketId)
        ? found.marketIds
        : [...found.marketIds, scope.run.marketId],
      links: found.links + links,
      position:
        position === null
          ? found.position
          : found.position === null
            ? position
            : Math.min(found.position, position)
    })
    return
  }
  const page = scope.page
  refs.set(id, {
    id,
    pageId: page.id,
    pageKind: page.kind === 'topic' ? 'topic' : 'page',
    pageLabel: page.label ?? page.title ?? page.url ?? page.id,
    promptId: item.row.promptId,
    promptLabel: item.row.label,
    promptText: item.row.text,
    marketId: scope.run.marketId,
    marketIds: [scope.run.marketId],
    runId: scope.run.id,
    links,
    position
  })
}

function addCited(
  tally: SiteTally,
  scope: RunScope,
  item: BuiltItem,
  links: number,
  best: AioReference,
  refs: readonly AioReference[]
): void {
  addRef(tally.cited, scope, item, links, best.position)
  for (const reference of refs) {
    tally.links.push({
      id: `${scope.page.id}|${item.row.promptId}|${scope.run.id}|${tally.links.length}`,
      pageId: scope.page.id,
      promptId: item.row.promptId,
      promptText: item.row.text,
      marketId: scope.run.marketId,
      runId: scope.run.id,
      url: reference.url,
      position: reference.position
    })
  }
}

function addGap(
  tally: SiteTally,
  scope: RunScope,
  item: ReturnType<typeof runBuiltPrompts>[number],
  best: AioReference
): void {
  const id = `${scope.page.id}|${item.row.promptId}`
  const found = tally.gaps.get(id)
  if (found !== undefined) {
    if (!found.marketIds.includes(scope.run.marketId)) {
      tally.gaps.set(id, { ...found, marketIds: [...found.marketIds, scope.run.marketId] })
    }
    return
  }
  const page = scope.page
  tally.gaps.set(id, {
    id,
    pageId: page.id,
    pageKind: page.kind === 'topic' ? 'topic' : 'page',
    pageLabel: page.label ?? page.title ?? page.url ?? page.id,
    pageUrl: page.url,
    promptId: item.row.promptId,
    promptLabel: item.row.label,
    promptText: item.row.text,
    marketId: scope.run.marketId,
    marketIds: [scope.run.marketId],
    runId: scope.run.id,
    position: best.position,
    url: best.url,
    checkedAt: scope.run.finishedAt
  })
}

export function youSite(lens: SiteLens): SiteKey {
  const own = bareDomain(lens.ownDomain)
  return { key: YOU_KEY, kind: 'you', name: own, tier: null, host: own }
}
