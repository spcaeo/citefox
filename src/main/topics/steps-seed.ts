import { inferProduct } from '@shared/domain'
import type { ProductCompetitor, ProjectProduct, TopicDraft } from '@shared/domain'
import type { CompanySuggestion, DiscoverSeedResult, ProductSuggestion } from '@shared/ipc'
import { domainOf } from '../engine/competitor-context'
import { competitorsByProduct } from '../engine/competitors-by-product'
import { homepageReader } from '../engine/projects'
import { listProductCompetitors } from '../storage/products'
import { getMarket, readProjectProfile } from '../storage/project-profile'
import { progressFor, type OpenedProject, type TopicEnv } from './env'
import { readSite } from './site'
import { DISCOVER_SEED_COUNT, productsAbout, seedIdeas, type SeedIdea } from './seed-ideas'

export { savedDataText } from './seed-ideas'

/**
 * Topic seed discovery (`topics:discoverSeed`, Docs/PROMPT-AUDIT.md P2 items 1–2).
 *
 * 1. The site's homepage and key pages (cached, no search).
 * 2. One `topic_seed_discover` call: seeds, each tied to a saved product, and segments.
 * 3. The competitors of the topic's product: the saved catalog (Fill from my website,
 *    PC) when that product has its own rows, so nothing is asked twice; else one web
 *    search for that product with the seed as its job (batch 2 row 5).
 *
 * What buyers switch from and integrations are the project's saved notes; this step
 * no longer asks Claude for them.
 */

/** `topics:discoverSeed`: reads the site (cached, no searches) and suggests seeds. */
export async function discoverSeed(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft
): Promise<DiscoverSeedResult> {
  const progress = progressFor(env, {
    projectId: opened.project.id,
    draftId: draft.id,
    topicId: null,
    step: 'seed_discover'
  })
  const domain = draft.website || opened.project.domain
  const reads = await readSite(env.host, opened.db, domain, {
    onProgress: (step) => {
      progress(
        'running',
        step.done,
        step.total + 1,
        `Reading ${step.url.replace(/^https:\/\//u, '')}`
      )
    }
  })
  progress('running', reads.length, reads.length + 1, 'Suggesting problems to start from')
  const pagesRead = reads.map((read) => ({ url: read.url, role: read.role, ok: read.ok }))
  const profile = readProjectProfile(opened.db)
  const saved = savedNotes(profile, (prefix) => `${prefix}-${env.host.createId()}`)
  if (!reads.some((read) => read.ok)) {
    progress('warning', reads.length, reads.length + 1, 'Could not read the website')
    return {
      draftId: draft.id,
      pagesRead,
      seeds: [],
      segments: [],
      competitors: [],
      ...saved,
      about: null,
      info: null,
      message: 'Could not read the website. Check the website and try again.'
    }
  }
  const ideas = await seedIdeas(env.host, opened, {
    channel: 'topics:discoverSeed',
    domain,
    about: draft.about.trim() || null,
    brandNames: draft.brandNames,
    marketId: draft.marketIds[0] ?? null,
    reads,
    count: DISCOVER_SEED_COUNT
  })
  progress('ok', reads.length + 1, reads.length + 1, 'Suggestions are ready')
  const id = (prefix: string): string => `${prefix}-${env.host.createId()}`
  const focus = focusProduct(ideas.products, draft, ideas.seeds)
  const companies = await topicCompetitors(env, opened, draft, {
    domain,
    focus,
    seed: draft.seed.trim() || ideas.seeds[0]?.text || null,
    products: ideas.products,
    segments: draft.segments.length > 0 ? draft.segments : ideas.segments.map((item) => item.name),
    notCompetitors: [...(profile?.switchingFrom ?? []), ...(profile?.integrations ?? [])],
    id
  })
  return {
    draftId: draft.id,
    pagesRead,
    products: companies.products,
    seeds: ideas.seeds.map((seed) => ({ id: id('seed'), ...seed })),
    segments: ideas.segments.map((segment) => ({ id: id('seg'), ...segment })),
    competitors: companies.competitors,
    ...saved,
    about: draft.about.trim() ? null : productsAbout(domain, ideas.products),
    info: ideas.info,
    message: null
  }
}

/**
 * The product the topic is about: the one picked on the Seed step; else the product
 * of the seed already typed (as Automatic would infer it); else the first suggested
 * seed's product. Null: the whole business.
 */
export function focusProduct(
  products: readonly ProjectProduct[],
  draft: Pick<TopicDraft, 'productId' | 'seed'>,
  seeds: readonly SeedIdea[]
): ProjectProduct | null {
  if (products.length === 0 || draft.productId === null) return null
  const byId = (value: string | null | undefined): ProjectProduct | null =>
    value === null || value === undefined
      ? null
      : (products.find((product) => product.id === value) ?? null)
  if (typeof draft.productId === 'string') return byId(draft.productId)
  const typed = draft.seed.trim()
  if (typed.length > 0) {
    const inferred = byId(inferProduct(products, { text: typed }).productId)
    if (inferred !== null) return inferred
  }
  return byId(seeds[0]?.productId)
}

/**
 * The topic's competitors. Saved rows of the focus product (plus whole-business rows)
 * when it has its own; with no product, every saved row; else one web search.
 */
async function topicCompetitors(
  env: TopicEnv,
  opened: OpenedProject,
  draft: TopicDraft,
  input: {
    domain: string
    focus: ProjectProduct | null
    seed: string | null
    products: readonly ProjectProduct[]
    segments: readonly string[]
    notCompetitors: readonly string[]
    id: (prefix: string) => string
  }
): Promise<{ products: ProductSuggestion[]; competitors: CompanySuggestion[] }> {
  const rows = listProductCompetitors(opened.db)
  const own = input.focus === null ? [] : rows.filter((row) => row.productId === input.focus?.id)
  const savedProducts = input.products.map(productSuggestion)
  if (own.length > 0) {
    return {
      products: savedProducts,
      competitors: savedCompanies(
        [...own, ...rows.filter((row) => row.productId === null)],
        input.id
      )
    }
  }
  if (input.focus === null && input.products.length > 0 && rows.length > 0) {
    return { products: savedProducts, competitors: savedCompanies(rows, input.id) }
  }
  const market =
    (draft.marketIds[0] === undefined ? null : getMarket(opened.db, draft.marketIds[0])) ??
    readProjectProfile(opened.db)?.market ??
    null
  const job = input.seed ?? input.focus?.job ?? null
  const searched = await competitorsByProduct(env.host, {
    channel: 'topics:discoverSeed',
    projectId: opened.project.id,
    domain: input.domain,
    summary: draft.about.trim() || productsAbout(input.domain, input.products),
    products: [
      {
        name: input.focus?.name ?? (job === null ? 'main product' : `product for “${job}”`),
        job: job ?? `What ${input.domain} sells.`,
        buyer:
          input.focus?.buyer ||
          (input.segments.length > 0 ? input.segments.slice(0, 4).join(', ') : 'Its buyers'),
        evidence: null
      }
    ],
    market: market === null ? null : { country: market.country, language: market.language },
    brandNames: draft.brandNames,
    notCompetitors: input.notCompetitors,
    readHomepage: homepageReader(env.host)
  })
  const found = searched.products[0]?.searchNote === null
  return {
    products: found ? searched.products : savedProducts,
    competitors: found ? searched.competitors : savedCompanies(rows, input.id)
  }
}

/** Saved rows as the card shows them, each company once (direct wins over partial). */
function savedCompanies(
  rows: readonly ProductCompetitor[],
  id: (prefix: string) => string
): CompanySuggestion[] {
  const out: CompanySuggestion[] = []
  const ordered = [...rows].sort(
    (left, right) => Number(left.tier !== 'direct') - Number(right.tier !== 'direct')
  )
  for (const row of ordered) {
    const key = row.name.trim().toLowerCase()
    if (out.some((item) => item.name.toLowerCase() === key)) continue
    const fromSearch = row.sources.length > 0
    out.push({
      id: id('comp'),
      name: row.name,
      domain: row.domain,
      domainSource: row.domain === null ? null : fromSearch ? 'search' : 'typed',
      reason: fromSearch
        ? `Saved on your project${row.startingPrice ? ` · from ${row.startingPrice}` : ''}.`
        : 'Saved on your project.',
      evidence: null,
      checkDomain: false,
      product: row.productId,
      tier: row.tier,
      startingPrice: row.startingPrice,
      sources: row.sources
    })
  }
  return out
}

function productSuggestion(product: ProjectProduct): ProductSuggestion {
  return {
    id: product.id,
    name: product.name,
    job: product.job,
    buyer: product.buyer,
    evidence: null,
    searchNote: null
  }
}

/** The project's saved switch-from options and integrations, as the card lists them. */
function savedNotes(
  profile: ReturnType<typeof readProjectProfile>,
  id: (prefix: string) => string
): Pick<DiscoverSeedResult, 'switchingFrom' | 'integrations'> {
  const company =
    (prefix: string, reason: string) =>
    (name: string): CompanySuggestion => {
      const domain = domainOf(name)
      return {
        id: id(prefix),
        name,
        domain,
        domainSource: domain === null ? null : 'typed',
        reason,
        evidence: null,
        checkDomain: false
      }
    }
  return {
    switchingFrom: (profile?.switchingFrom ?? []).map(
      company('switch', 'Saved on your project: buyers move off it.')
    ),
    integrations: (profile?.integrations ?? []).map(
      company('integ', 'Saved on your project: used together with it.')
    )
  }
}
