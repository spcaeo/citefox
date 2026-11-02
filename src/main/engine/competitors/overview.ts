import type { PageSummary } from '@shared/domain'
import type {
  CitedSiteProductShare,
  CitedSiteRow,
  CompetitorsOverview,
  CompetitorsOverviewRequest
} from '@shared/ipc'
import { cleanHost } from '@shared/competitor-hosts'
import { bareDomain } from '@shared/own-site'
import { IpcRequestError } from '../../ipc-request'
import type { StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import { listMarkets, readProjectProfile } from '../../storage/project-profile'
import { listProducts } from '../../storage/products'
import { competitorContext } from '../competitor-context'
import { resolvePageProduct } from '../products'
import { pickRuns } from './share'
import { rowSiteKind, storedKindsFor, unsortedDomains } from './site-kinds'
import {
  competitorKey,
  emptyTallies,
  siteId,
  siteOf,
  tallyRun,
  YOU_KEY,
  youSite,
  type SiteKey,
  type SiteLens,
  type SiteTally,
  type Tallies
} from './tally'

const CHANNEL = 'competitors:overview'
const MS_PER_DAY = 86_400_000

export interface OverviewInput {
  db: SqliteDatabase
  projectId: string
  domain: string
  now: Date
  request: CompetitorsOverviewRequest
}

/**
 * `competitors:overview`. The latest full check of every page and topic (in the
 * market and product filters) gives who is cited and named now; the latest full
 * check finished by the period start gives the share then. Competitors are the
 * project's saved ones through `competitorContext` (the product's when filtered).
 */
export function loadCompetitorsOverview(input: OverviewInput): CompetitorsOverview {
  const { db, projectId, request } = input
  const markets = listMarkets(db)
  const products = listProducts(db)
  const marketId = request.marketId ?? null
  const productId = request.productId ?? null
  if (marketId !== null && !markets.some((market) => market.id === marketId)) {
    throw new IpcRequestError(CHANNEL, 'That market is not in this project')
  }
  if (productId !== null && !products.some((product) => product.id === productId)) {
    throw new IpcRequestError(CHANNEL, 'That product is not in this project')
  }
  const profile = readProjectProfile(db)
  const context = competitorContext(db, productId === null ? {} : { productId })
  const lens: SiteLens = {
    ownDomain: input.domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    lists: { direct: context.direct, partial: context.partial }
  }
  const periodStart = new Date(input.now.getTime() - request.period * MS_PER_DAY).toISOString()

  const productOf = new Map<string, string>()
  const pages = listPages(db, projectId).filter((page) => {
    if (page.status === 'removed') return false
    const resolved = products.length === 0 ? null : resolvePageProduct(db, page.id, products)
    const key = resolved?.productId ?? ''
    productOf.set(page.id, key)
    return productId === null || key === productId
  })
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const { current, start } = pickRuns(db, projectId, pages, marketId, periodStart)

  const latest = emptyTallies()
  for (const run of current) addRun(latest, run, true)
  const then = emptyTallies()
  for (const run of start) addRun(then, run, false)
  const hasStart = start.length > 0
  const firstSeen = firstSeenBySite(db, pages, marketId, lens)

  const keys = new Set<string>([YOU_KEY, ...latest.sites.keys()])
  for (const item of [...lens.lists.direct, ...lens.lists.partial]) {
    keys.add(competitorKey(item.name))
  }
  const rows: CitedSiteRow[] = [...keys].map((key) =>
    buildRow(key, latest.sites.get(key) ?? null, {
      now: latest,
      then,
      hasStart,
      firstSeen: firstSeen.get(key) ?? null,
      periodStart,
      lens,
      brand: profile?.brandNames[0] ?? null,
      productKeys: products.length >= 2 ? productKeys(products, pages, productOf) : []
    })
  )
  const stored = storedKindsFor(db, rows)
  const pending = new Set(unsortedDomains(rows, stored))
  for (const row of rows) {
    row.siteKind = rowSiteKind(row, stored)
    if (row.domain !== null && pending.has(cleanHost(row.domain))) row.siteKindPending = true
  }
  const rank = { you: 0, competitor: 1, other: 1 }
  rows.sort(
    (left, right) =>
      rank[left.kind] - rank[right.kind] ||
      right.citations - left.citations ||
      (right.named ?? 0) - (left.named ?? 0) ||
      left.name.localeCompare(right.name)
  )
  return {
    projectId,
    period: request.period,
    periodStart,
    marketId,
    productId,
    markets,
    products: products.map((product) => ({ id: product.id, name: product.name })),
    ownDomain: bareDomain(input.domain),
    citations: latest.citations,
    questions: latest.questions.size,
    checks: current.length,
    checkedAt: current.reduce<string | null>(
      (latest, run) =>
        run.finishedAt !== null && (latest === null || run.finishedAt > latest)
          ? run.finishedAt
          : latest,
      null
    ),
    newSites: hasStart ? rows.filter((row) => row.isNew).length : null,
    rows,
    unsortedDomains: pending.size
  }

  function addRun(tallies: Tallies, run: StoredCheckRun, detail: boolean): void {
    const page = pageById.get(run.pageId)
    if (page === undefined) return
    tallyRun(tallies, {
      db,
      projectId,
      run,
      page,
      productKey: productOf.get(page.id) ?? '',
      lens,
      detail
    })
  }
}

/**
 * When each site was first cited in a full check of these pages (every sample, not only
 * the winning one): a site is new when that is inside the period.
 */
function firstSeenBySite(
  db: SqliteDatabase,
  pages: readonly PageSummary[],
  marketId: string | null,
  lens: SiteLens
): Map<string, string> {
  const found = new Map<string, string>()
  if (pages.length === 0) return found
  const ids = pages.map((page) => page.id)
  const rows = db
    .prepare<unknown[], { domain: string; classification: string; first: string }>(
      `SELECT aio_references.domain AS domain, aio_references.classification AS classification,
              MIN(runs.finished_at) AS first
       FROM aio_references
       JOIN serp_results ON serp_results.id = aio_references.serp_result_id
       JOIN runs ON runs.id = serp_results.run_id
       WHERE runs.status = 'finished' AND runs.partial = 0 AND runs.finished_at IS NOT NULL
         AND runs.page_id IN (${ids.map(() => '?').join(', ')})
         ${marketId === null ? '' : 'AND runs.market_id = ?'}
       GROUP BY aio_references.domain, aio_references.classification`
    )
    .all(...ids, ...(marketId === null ? [] : [marketId]))
  for (const row of rows) {
    const classification =
      row.classification === 'target' ||
      row.classification === 'own' ||
      row.classification === 'competitor'
        ? row.classification
        : 'other'
    const { key } = siteOf({ domain: row.domain, classification }, lens)
    const current = found.get(key)
    if (current === undefined || row.first < current) found.set(key, row.first)
  }
  return found
}

/** Product keys in product order, plus `''` when some pages have no product. */
function productKeys(
  products: readonly { id: string }[],
  pages: readonly PageSummary[],
  productOf: ReadonlyMap<string, string>
): string[] {
  const keys = products.map((product) => product.id)
  if (pages.some((page) => (productOf.get(page.id) ?? '') === '')) keys.push('')
  return keys
}

interface RowContext {
  now: Tallies
  then: Tallies
  hasStart: boolean
  firstSeen: string | null
  periodStart: string
  lens: SiteLens
  brand: string | null
  productKeys: readonly string[]
}

function buildRow(key: string, tally: SiteTally | null, context: RowContext): CitedSiteRow {
  const site = siteFor(key, tally, context)
  const citations = tally?.citations ?? 0
  const share = context.now.citations === 0 ? null : citations / context.now.citations
  const startCitations = context.hasStart ? (context.then.sites.get(key)?.citations ?? 0) : null
  const shareChange =
    startCitations === null || share === null || context.then.citations === 0
      ? null
      : share - startCitations / context.then.citations
  const byProduct: CitedSiteProductShare[] = context.productKeys.map((productKey) => {
    const counts = tally?.byProduct.get(productKey)
    const total = context.now.productCitations.get(productKey) ?? 0
    const productCitations = counts?.citations ?? 0
    return {
      productId: productKey === '' ? null : productKey,
      citations: productCitations,
      questions: counts?.questions.size ?? 0,
      share: total === 0 ? null : productCitations / total
    }
  })
  return {
    id: siteId(key),
    name: site.name,
    domain: site.domain,
    kind: site.kind,
    siteKind: null,
    tier: site.tier,
    citations,
    questions: tally?.questions.size ?? 0,
    share,
    named: site.kind === 'other' ? null : (tally?.named.size ?? 0),
    startCitations,
    shareChange,
    firstSeenAt: context.firstSeen,
    isNew:
      site.kind !== 'you' &&
      context.hasStart &&
      citations > 0 &&
      context.firstSeen !== null &&
      context.firstSeen > context.periodStart,
    byProduct,
    gaps: tally === null ? [] : [...tally.gaps.values()],
    links: tally === null ? [] : [...tally.links].sort((a, b) => a.position - b.position),
    citedQuestions: tally === null ? [] : [...tally.cited.values()],
    namedQuestions: tally === null || site.kind === 'other' ? [] : [...tally.namedRefs.values()]
  }
}

function siteFor(
  key: string,
  tally: SiteTally | null,
  context: RowContext
): Pick<SiteKey, 'kind' | 'name' | 'tier'> & { domain: string | null } {
  if (key === YOU_KEY) {
    const own = youSite(context.lens)
    return { kind: 'you', name: context.brand ?? own.name, tier: null, domain: own.host }
  }
  const saved = [...context.lens.lists.direct, ...context.lens.lists.partial].find(
    (item) => competitorKey(item.name) === key
  )
  if (saved !== undefined) {
    return {
      kind: 'competitor',
      name: saved.name,
      tier: context.lens.lists.direct.includes(saved) ? 'direct' : 'partial',
      domain: saved.domain ?? topHost(tally)
    }
  }
  const site = tally?.site
  return {
    kind: site?.kind ?? 'other',
    name: site?.name ?? key,
    tier: site?.tier ?? null,
    domain: topHost(tally)
  }
}

function topHost(tally: SiteTally | null): string | null {
  if (tally === null) return null
  let best: string | null = null
  let most = -1
  for (const [host, links] of tally.hosts) {
    if (host.length === 0) continue
    if (links > most) {
      best = host
      most = links
    }
  }
  return best
}
