import type { PageSummary } from '@shared/domain'
import { competitorContext } from '../engine/competitor-context'
import { nameOfPage } from '../import/context'
import { defaultPageMarket, pageBlockValues } from '../pipeline/page-context'
import {
  buyerBlock,
  buyerFromPageProfile,
  businessBlock,
  competitorBlock,
  marketBlock,
  productBlock
} from '../prompts/blocks'
import { projectRulesBlock } from '../prompts/project-rules'
import { getLatestBuyerProfile, getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { getPage, listPages } from '../storage/pages'
import { listProductCompetitors, listProducts } from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'
import { activeProjectRules } from '../storage/project-rules'
import type { ProjectRecord } from '../storage/records'
import type { HelpFillContext, HelpFillPage, HelpFillTarget } from './types'

/**
 * What a help-fill prompt and the merge read from the project, once per call: the
 * context blocks every Claude prompt uses (prompts/blocks.ts, competitors through
 * `competitorContext`), the page or topic, the tracked page paths and every tracked
 * question. Nothing else leaves the project file.
 */

/** Pages whose paths a reply may use for `page`. */
const MAX_PAGE_PATHS = 40

export class HelpFillTargetMissing extends Error {
  constructor() {
    super('That page or topic was not found.')
    this.name = 'HelpFillTargetMissing'
  }
}

/** The context without the request's question and subject (the service adds those). */
export type HelpFillBaseContext = Omit<HelpFillContext, 'promptId' | 'subject'>

export function readHelpFillContext(
  db: SqliteDatabase,
  project: ProjectRecord,
  pageId: string | null
): HelpFillBaseContext {
  const profile = readProjectProfile(db)
  const brands = [...(profile?.brandNames ?? [])]
  const page = pageId === null ? null : getPage(db, pageId, project.id)
  if (pageId !== null && page === null) throw new HelpFillTargetMissing()
  const pages = listPages(db, project.id).filter((item) => item.status !== 'removed')
  const projectQuestions: string[] = []
  let targetQuestions: string[] = []
  for (const item of pages) {
    const { first, all } = questionsOf(db, item.id, brands)
    projectQuestions.push(...all)
    if (item.id === pageId) targetQuestions = first
  }
  return {
    projectId: project.id,
    domain: project.domain,
    brands,
    target: page === null ? null : targetOf(page),
    blocks: [
      ...(page === null
        ? projectBlocks(db, project, brands)
        : pageBlocks(db, project, page, brands)),
      // The owner's project rules ride with the context, so every help-fill prompt has them.
      ...rulesBlocks(activeProjectRules(db))
    ],
    pagePaths: pages
      .filter((item) => item.kind !== 'topic' && item.url !== null)
      .map((item) => pathOf(item.url ?? ''))
      .filter((path, index, all) => path.length > 0 && all.indexOf(path) === index)
      .slice(0, MAX_PAGE_PATHS),
    targetQuestions,
    projectQuestions,
    pages: trackedPages(pages),
    ...catalogOf(db)
  }
}

/** The owner's rules as one context block, or none. */
export function rulesBlocks(rules: readonly string[]): string[] {
  const block = projectRulesBlock(rules)
  return block.length === 0 ? [] : [block]
}

/** Tracked pages (not topics), once per path, with the name the app shows. */
function trackedPages(pages: readonly PageSummary[]): HelpFillPage[] {
  const seen = new Set<string>()
  const out: HelpFillPage[] = []
  for (const item of pages) {
    if (item.kind === 'topic' || item.url === null) continue
    const path = pathOf(item.url)
    if (path.length === 0 || seen.has(path)) continue
    seen.add(path)
    out.push({ path, url: item.url, name: nameOfPage(item) })
  }
  return out
}

/** Products (for `competes_with`), saved competitors (what the competitors kind tracks) and the market. */
function catalogOf(
  db: SqliteDatabase
): Pick<HelpFillContext, 'products' | 'competitors' | 'market'> {
  const market = readProjectProfile(db)?.market ?? null
  try {
    return {
      market: market === null ? null : { country: market.country, language: market.language },
      products: listProducts(db).map((product) => ({
        id: product.id,
        name: product.name,
        job: product.job,
        buyer: product.buyer
      })),
      competitors: listProductCompetitors(db).map((item) => ({
        name: item.name,
        domain: item.domain
      }))
    }
  } catch {
    // An older project file without the catalog tables adds nothing.
    return { market: null, products: [], competitors: [] }
  }
}

/** `/pricing/` from `https://example.com/pricing/`; a path stays as it is. */
export function pathOf(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('/')) return trimmed
  try {
    const parsed = new URL(trimmed)
    return parsed.pathname || '/'
  } catch {
    return ''
  }
}

function targetOf(page: PageSummary): HelpFillTarget {
  return {
    id: page.id,
    kind: page.kind === 'topic' ? 'topic' : 'page',
    name: nameOfPage(page),
    url: page.url
  }
}

/**
 * A page's questions: the first wording of each (listed in the prompt, as the
 * importer shows them) and every market's wording (what rows merge into).
 */
function questionsOf(
  db: SqliteDatabase,
  pageId: string,
  brands: readonly string[]
): { first: string[]; all: string[] } {
  try {
    const prompts = getLatestPromptSet(db, pageId, brands)?.prompts ?? []
    const first = prompts.map((prompt) => prompt.variants[0]?.text ?? prompt.label)
    const all = prompts.flatMap((prompt) => [prompt.label, ...prompt.variants.map((v) => v.text)])
    return {
      first: first.filter((text) => text.trim().length > 0),
      all: [...new Set(all.filter((text) => text.trim().length > 0))]
    }
  } catch {
    // A page whose prompt set cannot be read adds nothing to the lists.
    return { first: [], all: [] }
  }
}

/** The page's blocks (its product, its market) plus its buyer profile when it has one. */
function pageBlocks(
  db: SqliteDatabase,
  project: ProjectRecord,
  page: PageSummary,
  brands: readonly string[]
): string[] {
  const values = pageBlockValues({
    db,
    pageId: page.id,
    domain: project.domain,
    pageUrl: page.url,
    brandNames: brands,
    market: defaultPageMarket(db, page),
    language: null
  })
  return [
    values.business_block ?? '',
    values.product_block ?? '',
    values.market_block ?? '',
    buyerLines(db, page.id),
    values.competitor_block ?? ''
  ].filter((block) => block.length > 0)
}

/** The whole business: no product, the project's default market, every competitor. */
function projectBlocks(
  db: SqliteDatabase,
  project: ProjectRecord,
  brands: readonly string[]
): string[] {
  const profile = readProjectProfile(db)
  const competitors = competitorContext(db, {})
  return [
    businessBlock({ domain: project.domain, summary: null, brandNames: brands }),
    productBlock(null),
    profile === null
      ? ''
      : marketBlock({
          country: profile.market.country,
          language: profile.market.language,
          location: profile.market.location
        }),
    competitorBlock(competitors)
  ].filter((block) => block.length > 0)
}

function buyerLines(db: SqliteDatabase, pageId: string): string {
  try {
    const profile = getLatestBuyerProfile(db, pageId)
    return profile === null ? '' : buyerBlock(buyerFromPageProfile(profile))
  } catch {
    return ''
  }
}
