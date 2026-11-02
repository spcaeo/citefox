import type { ProductCompetitor } from '@shared/domain'
import type { FillFromWebsiteResult } from '@shared/ipc'
import { competitorFor } from '../engine/checks/competitor-match'
import { pageCompetitorText } from '../engine/checks/report-context'
import { competitorContext } from '../engine/competitor-context'
import { fillFromWebsite } from '../engine/fill-from-website'
import { catalogFromFill, resolvePageProduct } from '../engine/products'
import { toContext, type EngineContext } from '../handlers/context'
import { listStoredAioReferences, type StoredAioReference } from '../storage/check-records'
import { readProductCatalog, replaceProductCatalog, setPageProduct } from '../storage/products'
import type { SqliteDatabase } from '../storage/database'
import { readProjectProfile, updateProjectProfile } from '../storage/project-profile'
import { SmokeError } from './errors'
import { keptEntries } from './fill-products'
import type { PageSmokeHookContext, SmokeHookResult } from './hook-context'
import { step } from './live'

/**
 * `--classify` (Docs/PROMPT-AUDIT.md P9): competitor citations by product, on real data.
 *
 * Before the page smoke's search ({@link prepareClassifySmoke}): runs Fill from my website
 * for real (site read, one web search per product), saves it as onboarding Finish does
 * (`catalogFromFill`, then `replaceProductCatalog`), and pins the page to the product it
 * maps to (product A). When Fill finds one product, a second one is added as the owner
 * would in Settings (product B). So the page smoke's own search is the check as product A.
 *
 * After it ({@link runClassifySmoke}):
 *
 * 1. Prints run A's cited domains: stored class, report label, and the other product's
 *    competitors among them.
 * 2. Pins the page to product B and checks again the searched prompt whose overview cited
 *    the most sources (1 prompt, at most 2 searches); prints the same for run B.
 * 3. Reads run A again: its stored classes must not have changed.
 *
 * Fails when a class and its report label disagree, a competitor is not the page
 * product's, or the page product's competitor is not stored as one.
 */

type PreSearchContext = Pick<
  PageSmokeHookContext,
  'io' | 'push' | 'secrets' | 'args' | 'setup' | 'storage' | 'projectId' | 'pageId' | 'clock'
>

/** The ids of product A (the page's) and product B, kept between the two halves. */
const pinned = new WeakMap<object, { a: string; b: string }>()

export async function prepareClassifySmoke(context: PreSearchContext): Promise<void> {
  const { io, push, secrets } = context
  const db = context.setup.projectDb
  const domain = new URL(context.args.url).hostname.replace(/^www\./u, '')
  const fill = await step(push, secrets, 'p9-fill', async () => {
    const started = Date.now()
    const result = await fillFromWebsite(smokeHost(context), { projectId: null, domain })
    if (result.nextStep !== null) throw new SmokeError(result.message ?? 'Fill did not finish.')
    return {
      detail: `products=${result.products?.length ?? 0} competitors=${result.competitors.length} ${Date.now() - started}ms`,
      result
    }
  })
  await step(push, secrets, 'p9-save', async () => {
    saveFill(context, fill.result)
    // The page's product as Fill's catalog infers it, before a product is added by hand.
    const resolved = resolvePageProduct(db, context.pageId)
    const added = secondProduct(context)
    const catalog = readProductCatalog(db)
    for (const item of catalog.products) {
      const own = competitorContext(db, { productId: item.id })
      io.stdout(
        `  product ${item.name}${item.id === added ? ' (added by hand, as in Settings)' : ''}`
      )
      io.stdout(`    direct: ${namesOf(own.direct)}`)
      io.stdout(`    partial: ${namesOf(own.partial)}`)
    }
    const a = resolved?.productId ?? catalog.products.find((item) => item.id !== added)?.id ?? null
    const b = catalog.products.find((item) => item.id !== a)?.id ?? null
    if (a === null || b === null) {
      throw new SmokeError('P9 needs two products to show the difference.')
    }
    // Pinned as a user confirms the page's product, so the search classifies by it.
    setPageProduct(db, context.pageId, a, true)
    pinned.set(context.storage, { a, b })
    return `page product=${nameOf(db, a)} (${resolved?.reason ?? 'first product'}); second=${nameOf(db, b)}`
  })
}

export async function runClassifySmoke(context: PageSmokeHookContext): Promise<SmokeHookResult> {
  const runA = context.runId
  if (runA === null) return { ran: false, detail: 'the search step returned no run' }
  const products = pinned.get(context.storage)
  if (products === undefined) return { ran: false, detail: 'the catalog was not saved' }
  const { push, secrets } = context
  const db = context.setup.projectDb
  const before = classesOf(references(context, runA))
  await step(push, secrets, 'p9-classes-a', async () => printClasses(context, runA, products.a))

  const promptId = busiestPrompt(references(context, runA))
  if (promptId === null) {
    return { ran: false, detail: 'no searched prompt had an overview with sources' }
  }
  // The same prompt checked as a page about product B: product A's competitors must show
  // as other, and product B's as competitors.
  setPageProduct(db, context.pageId, products.b, true)
  const searchesBefore = context.searches()
  const runB = await step(push, secrets, 'p9-check-b', async () => {
    const finished = await context.engine.start({
      projectId: context.projectId,
      pageIds: [context.pageId],
      marketIds: [context.marketId],
      promptIds: [promptId],
      reason: 'manual'
    })
    if (finished.status !== 'finished') {
      throw new SmokeError(finished.message ?? 'The check did not finish.')
    }
    const id = finished.runIds[0]
    if (id === undefined) throw new SmokeError('The check stored no run.')
    return {
      detail: `as ${nameOf(db, products.b)} searches+${context.searches() - searchesBefore}`,
      id
    }
  })
  await step(push, secrets, 'p9-classes-b', async () => printClasses(context, runB.id, products.b))

  await step(push, secrets, 'p9-old-run', async () => {
    const after = classesOf(references(context, runA))
    const changed = [...before.entries()].filter(([key, value]) => after.get(key) !== value)
    if (changed.length > 0 || after.size !== before.size) {
      throw new SmokeError(`Run A's classes changed: ${changed.map(([key]) => key).join(', ')}`)
    }
    return `run A unchanged after the page moved to ${nameOf(db, products.b)} (${before.size} sources)`
  })
  return { ran: true, detail: 'classified' }
}

/**
 * Prints each cited domain once with its stored class, the report label, and the other
 * products it competes in; throws when a class and its label disagree, a competitor is
 * not this product's, or this product's competitor is not stored as one.
 */
function printClasses(context: PageSmokeHookContext, runId: string, productId: string): string {
  const db = context.setup.projectDb
  const lists = competitorContext(db, { pageId: context.pageId })
  const others = readProductCatalog(db).products.filter((item) => item.id !== productId)
  const { competitorOf } = pageCompetitorText(db, context.pageId)
  const problems: string[] = []
  const seen = new Set<string>()
  let competitors = 0
  let otherProducts = 0
  for (const reference of references(context, runId)) {
    if (seen.has(reference.domain)) continue
    seen.add(reference.domain)
    const label = competitorOf({
      url: reference.url,
      classification: reference.classification === 'target' ? 'this page' : reference.classification
    })
    const elsewhere = others
      .map((item) => ({
        item,
        hit: competitorFor(reference.domain, competitorContext(db, { productId: item.id }))
      }))
      .filter((entry) => entry.hit !== null)
      .map((entry) => `${entry.item.name} ${entry.hit?.tier ?? ''}`.trim())
    const mine = competitorFor(reference.domain, lists)
    context.io.stdout(
      `  ${reference.domain}: ${reference.classification}${label === null ? '' : ` (${label})`}${elsewhere.length > 0 ? ` · competitor of ${elsewhere.join(', ')}` : ''}`
    )
    if (reference.classification === 'competitor') competitors += 1
    if (mine === null && elsewhere.length > 0) otherProducts += 1
    if ((label !== null) !== (reference.classification === 'competitor')) {
      problems.push(`${reference.domain} class and report label disagree`)
    }
    if (reference.classification === 'competitor' && mine === null) {
      problems.push(`${reference.domain} is a competitor but not this product's`)
    }
    if (mine !== null && reference.classification !== 'competitor') {
      problems.push(
        `${reference.domain} is this product's competitor but stored ${reference.classification}`
      )
    }
  }
  if (problems.length > 0) throw new SmokeError(problems.join('; '))
  return `domains=${seen.size} competitors=${competitors} other-product competitors shown as other=${otherProducts}`
}

/**
 * When Fill found one product, a second one as the owner would add it in Settings, so
 * the smoke can show one domain judged differently by product: two-way texting from a
 * shared inbox, a real TextBolt line. Its direct rivals are the first product's partial
 * competitors (an overlap for that product, the same job for this one) plus two inbox
 * tools. Returns its id, or null when Fill found more than one product.
 */
function secondProduct(context: PreSearchContext): string | null {
  const db = context.setup.projectDb
  const catalog = readProductCatalog(db)
  if (catalog.products.length !== 1) return null
  const first = catalog.products[0]
  if (first === undefined) return null
  const id = 'prod-smoke-two-way'
  const row = (name: string, domain: string | null): ProductCompetitor => ({
    name,
    domain,
    productId: id,
    tier: 'direct',
    startingPrice: null,
    sources: []
  })
  const overlap = catalog.competitors.filter(
    (item) => item.productId === first.id && item.tier === 'partial'
  )
  replaceProductCatalog(db, {
    products: [
      ...catalog.products,
      {
        id,
        name: 'Two-way texting inbox',
        job: 'text customers back and forth from a shared business number and inbox',
        buyer: 'local service businesses and front-desk teams'
      }
    ],
    competitors: [
      ...catalog.competitors,
      ...overlap.map((item) => row(item.name, item.domain)),
      row('Podium', 'podium.com'),
      row('Heymarket', 'heymarket.com')
    ]
  })
  return id
}

function nameOf(db: SqliteDatabase, productId: string): string {
  const products = readProductCatalog(db).products
  return products.find((item) => item.id === productId)?.name ?? productId
}

/** Saves the Fill read the way onboarding Finish does: the flat list, then the catalog. */
function saveFill(context: PreSearchContext, result: FillFromWebsiteResult): void {
  const db = context.setup.projectDb
  const profile = readProjectProfile(db)
  if (profile === null) throw new SmokeError('The smoke project has no profile.')
  const kept = keptEntries(result)
  updateProjectProfile(db, { ...profile, competitors: kept })
  replaceProductCatalog(db, catalogFromFill(result, kept, readProductCatalog(db)))
}

function references(context: PageSmokeHookContext, runId: string): StoredAioReference[] {
  return listStoredAioReferences(context.setup.projectDb, {
    projectId: context.projectId,
    pageIds: [context.pageId],
    marketId: context.marketId,
    from: null,
    to: null,
    runId,
    promptId: null
  })
}

function classesOf(rows: readonly StoredAioReference[]): Map<string, string> {
  return new Map(
    rows.map((row) => [`${row.promptId} ${row.position} ${row.domain}`, row.classification])
  )
}

/** The prompt whose overview cited the most distinct domains, or null. */
function busiestPrompt(rows: readonly StoredAioReference[]): string | null {
  const domains = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = domains.get(row.promptId) ?? new Set<string>()
    set.add(row.domain)
    domains.set(row.promptId, set)
  }
  let best: string | null = null
  let size = 0
  for (const [promptId, set] of domains) {
    if (set.size > size) {
      best = promptId
      size = set.size
    }
  }
  return best
}

function namesOf(items: readonly { name: string; domain: string | null }[]): string {
  return (
    items
      .map((item) => (item.domain === null ? item.name : `${item.name} (${item.domain})`))
      .join(', ') || 'none'
  )
}

/** An engine host over the smoke's storage, with the smoke's Claude Code provider. */
function smokeHost(context: PreSearchContext): EngineContext {
  const refuse = (): never => {
    throw new SmokeError('The classify smoke runs Claude through the smoke provider only.')
  }
  return toContext({
    appInfo: () => ({ name: 'CiteFox', version: 'smoke' }),
    storage: context.storage,
    secrets: context.setup.secretStore,
    logger: context.setup.logger,
    http: context.setup.transport,
    claudeCommand: { run: () => Promise.resolve(refuse()) },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => context.secrets,
    now: context.clock,
    claude: context.setup.provider
  })
}
