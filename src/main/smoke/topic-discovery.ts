import { inferProduct } from '@shared/domain'
import type { DiscoverSeedResult } from '@shared/ipc'
import { competitorContext } from '../engine/competitor-context'
import { openOwned } from '../engine/project-db'
import type { EngineContext } from '../handlers/context'
import { productsHandlers } from '../handlers/products'
import { projectsHandlers } from '../handlers/projects'
import { listProducts } from '../storage/products'
import { readProjectProfile, updateProjectProfile } from '../storage/project-profile'
import { buildSections } from '../start/candidates'
import { firstPicks } from '../start/first-picks'
import { listStartPages } from '../start/store'
import { cachedSiteReads } from '../topics/site'
import { fillLines } from './fill'
import { keptEntries } from './fill-products'
import type { SavedCompetitors } from './topic-journey'

/**
 * Topic smoke helpers for the discovery package (Docs/PROMPT-AUDIT.md, P2). With
 * `--fill <domain> --topic`, the topic project is filled first and saved as
 * onboarding Finish saves it (products, competitors by product, switch-from and
 * integrations), so Discover reads the saved catalog instead of searching again,
 * and the first-run picks run on it. Each prints what it found so runs compare.
 */

/** One line per seed (with its product), then the competitors Discover shows. */
export function seedLines(result: DiscoverSeedResult): string[] {
  const products = new Map((result.products ?? []).map((item) => [item.id, item.name]))
  const lines = result.seeds.map((seed) => {
    const product = seed.productId === null ? 'none' : (products.get(seed.productId) ?? 'unknown')
    return `seed [${product}] ${seed.text}${seed.caution ? ` (caution: ${seed.caution})` : ''}`
  })
  for (const tier of ['direct', 'partial'] as const) {
    const names = result.competitors
      .filter((item) => (item.tier ?? 'direct') === tier)
      .map((item) => item.name)
    lines.push(`discover ${tier}: ${names.join(', ') || 'none'}`)
  }
  lines.push(
    `discover switch-from: ${result.switchingFrom.map((item) => item.name).join(', ') || 'none'}`,
    `discover integrations: ${result.integrations.map((item) => item.name).join(', ') || 'none'}`
  )
  return lines
}

/**
 * Fill from my website on the topic project, then saved the way onboarding Finish
 * saves it: every competitor with a domain kept, its products and rows by product,
 * and what buyers switch from and integrations as notes.
 */
export async function fillTopicProject(
  ctx: EngineContext,
  projectId: string,
  domain: string,
  print: (line: string) => void
): Promise<string> {
  const result = await projectsHandlers(ctx)['projects:fillFromWebsite']({ projectId, domain })
  for (const line of fillLines(result)) print(`fill ${line}`)
  if (result.nextStep !== null) throw new Error(`Fill failed: ${result.message ?? 'no reply'}`)
  const opened = openOwned(ctx, projectId, 'smoke:fill')
  try {
    const profile = readProjectProfile(opened.db)
    if (profile === null) throw new Error('The topic project has no profile.')
    const seen = new Set<string>()
    const competitors = [...keptEntries(result), ...profile.competitors].filter((entry) => {
      const key = entry.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    updateProjectProfile(opened.db, {
      ...profile,
      competitors,
      switchingFrom: result.switchingFrom.map((item) => item.name),
      integrations: result.integrations.map((item) => item.name)
    })
  } finally {
    opened.close()
  }
  const saved = await productsHandlers(ctx)['products:saveFill']({
    projectId,
    fill: { products: result.products ?? [], competitors: result.competitors }
  })
  return `products=${saved.products.map((item) => item.name).join(' | ') || 'none'} rows=${saved.competitors.length} switch-from=${result.switchingFrom.length} integrations=${result.integrations.length}`
}

/**
 * After a saved Fill: the typed seed's product (as Automatic infers it, the product
 * "Use as seed" would pick) and that product's competitors, for the journey checks.
 */
export function seedProductCompetitors(
  ctx: EngineContext,
  projectId: string,
  seed: string
): SavedCompetitors & { productId: string | null; product: string | null } {
  const opened = openOwned(ctx, projectId, 'smoke:topic')
  try {
    const products = listProducts(opened.db)
    const productId = inferProduct(products, { text: seed }).productId
    const context = competitorContext(opened.db, productId === null ? {} : { productId })
    return {
      productId,
      product: products.find((item) => item.id === productId)?.name ?? null,
      direct: context.direct.map((item) => item.name),
      partial: context.partial.map((item) => item.name),
      products: products.map((item) => item.name)
    }
  } finally {
    opened.close()
  }
}

/** The first run's picks on the filled project: pages with their reasons, then topics. */
export async function firstRunLines(ctx: EngineContext, projectId: string): Promise<string[]> {
  const opened = openOwned(ctx, projectId, 'smoke:first-run')
  let input: Parameters<typeof firstPicks>[2]
  let products: Map<string, string>
  try {
    products = new Map(listProducts(opened.db).map((item) => [item.id, item.name]))
    const pages = listStartPages(opened.db)
    input = {
      domain: opened.project.domain,
      profile: readProjectProfile(opened.db),
      pages,
      sections: buildSections(pages),
      reads: cachedSiteReads(opened.db),
      readable: pages.length > 0
    }
  } finally {
    opened.close()
  }
  const started = Date.now()
  const picks = await firstPicks(ctx, projectId, input)
  return [
    `first-run source=${picks.picked.source} ${Date.now() - started}ms`,
    ...picks.picked.pages.map(
      (page) => `first-run page ${page.path} | ${page.reason} | ${page.evidence}`
    ),
    ...picks.topics.map(
      (topic) =>
        `first-run topic [${topic.productId === null ? 'none' : (products.get(topic.productId) ?? 'unknown')}] ${topic.seed} | ${topic.reason}`
    )
  ]
}
