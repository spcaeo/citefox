import type { Market, PageSummary, ProductCompetitor, ProjectProduct } from '@shared/domain'
import { foldWord } from '@shared/import-fields'
import { pageMarkets } from '../engine/page-access'
import { getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { listPages, MAX_PROMPT_COUNT } from '../storage/pages'
import { listProductCompetitors, listProducts } from '../storage/products'
import { listMarkets, readProjectProfile } from '../storage/project-profile'
import type { ProjectRecord } from '../storage/records'
import { indexed, SimilarIndex } from './similar'

/**
 * What an import checks rows against, read once per call from the project file:
 * every tracked question (all pages and topics, so a near-duplicate in another topic
 * is found), the tracked pages, competitors, products and markets, the brand names
 * and the own domain.
 */

export interface TrackedQuestion {
  text: string
  sourceId: string
  sourceName: string
}

export interface ImportDestination {
  id: string
  kind: 'page' | 'topic'
  name: string
  marketIds: readonly string[]
  /** Questions it holds now. */
  count: number
  /** How many more it can take (a page or topic holds at most 1,000). */
  room: number
  url: string | null
}

export interface ProjectFacts {
  domain: string
  includeSubdomains: boolean
  brands: readonly string[]
  markets: readonly Market[]
  pages: readonly PageSummary[]
  /** Tracked page URLs (lower case), for "already tracked". */
  trackedUrls: ReadonlySet<string>
  /** Topics by folded name. */
  topicsByName: ReadonlyMap<string, ImportDestination>
  destinations: ReadonlyMap<string, ImportDestination>
  /** Every tracked question, by page or topic. */
  questions: SimilarIndex<TrackedQuestion>
  questionsBySource: ReadonlyMap<string, SimilarIndex<TrackedQuestion>>
  competitors: readonly ProductCompetitor[]
  products: readonly ProjectProduct[]
}

export function nameOfPage(page: PageSummary): string {
  return (page.kind === 'topic' ? page.title : (page.label ?? page.title)) ?? page.url ?? page.id
}

export function readProjectFacts(db: SqliteDatabase, project: ProjectRecord): ProjectFacts {
  const profile = readProjectProfile(db)
  const brands = [...(profile?.brandNames ?? [])]
  const pages = listPages(db, project.id).filter((page) => page.status !== 'removed')
  const questions = new SimilarIndex<TrackedQuestion>()
  const questionsBySource = new Map<string, SimilarIndex<TrackedQuestion>>()
  const destinations = new Map<string, ImportDestination>()
  const topicsByName = new Map<string, ImportDestination>()
  const trackedUrls = new Set<string>()
  for (const page of pages) {
    const kind = page.kind === 'topic' ? 'topic' : 'page'
    if (kind === 'page' && page.url !== null) trackedUrls.add(page.url.toLowerCase())
    const name = nameOfPage(page)
    const active = getLatestPromptSet(db, page.id, brands)
    const own = new SimilarIndex<TrackedQuestion>()
    for (const prompt of active?.prompts ?? []) {
      const text = prompt.variants[0]?.text ?? prompt.label
      const entry = indexed({ text, sourceId: page.id, sourceName: name }, text)
      questions.add(entry)
      own.add(entry)
    }
    questionsBySource.set(page.id, own)
    const count = active?.prompts.length ?? 0
    const destination: ImportDestination = {
      id: page.id,
      kind,
      name,
      marketIds: pageMarkets(db, page.id).map((market) => market.id),
      count,
      room: Math.max(0, MAX_PROMPT_COUNT - count),
      url: page.url
    }
    destinations.set(page.id, destination)
    if (kind === 'topic' && (page.status === 'tracked' || page.status === 'paused')) {
      topicsByName.set(foldWord(name), destination)
    }
  }
  return {
    domain: project.domain,
    includeSubdomains: profile?.includeSubdomains ?? false,
    brands,
    markets: listMarkets(db),
    pages,
    trackedUrls,
    topicsByName,
    destinations,
    questions,
    questionsBySource,
    competitors: listProductCompetitors(db),
    products: listProducts(db)
  }
}
