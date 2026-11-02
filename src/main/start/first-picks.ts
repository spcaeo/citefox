import type { SiteStartPage, SiteStartSection, SiteStartTopic } from '@shared/ipc'
import { competitorDomainOf } from '@shared/domain'
import { START_MAX_TOPICS } from '@shared/site-start'
import { askMarketLabel } from '../ask/query'
import { completeAssist } from '../engine/assist'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import type { SqliteDatabase } from '../storage/database'
import { listProductCompetitors, listProducts } from '../storage/products'
import type { ProjectProfile } from '../storage/project-profile'
import type { SiteRead } from '../topics/records'
import {
  contestedProducts,
  rankSeeds,
  seedIdeas,
  seedPageHits,
  type SeedIdea
} from '../topics/seed-ideas'
import { siteText } from '../topics/site'
import { rulePage, type StartPageRow } from './candidates'
import {
  acceptStartReply,
  buildStartPrompt,
  factsLine,
  isCountOnly,
  parseStartReply,
  START_ASSIST_ID
} from './prompt'
import { pickStartPages, rankStartPages, type RankedPage, type RankSignals } from './rank'

/**
 * The first run's picks (Docs/PROMPT-AUDIT.md P2 item 4): the pages and topics with
 * the most to gain. Code ranks the pages and the seeds; two Claude calls run side by
 * side, one explaining the page picks (`start.firstPages`) and one writing the seeds
 * (`topic_seed_discover`). Rivals are not asked for: the saved catalog holds them.
 */

export interface FirstPicks {
  picked: { pages: SiteStartPage[]; source: 'claude' | 'rules'; message: string | null }
  /** Best first, each with the saved product its seed is about. Empty without Claude. */
  topics: FirstTopic[]
}

/** A first-run topic and the saved product its seed is about. */
export type FirstTopic = SiteStartTopic & { productId: string | null }

export async function firstPicks(
  host: EngineHost,
  projectId: string,
  input: {
    domain: string
    profile: ProjectProfile | null
    pages: readonly StartPageRow[]
    sections: readonly SiteStartSection[]
    reads: readonly SiteRead[]
    /** False when neither the sitemap nor a page could be read. */
    readable: boolean
  }
): Promise<FirstPicks> {
  const profile = input.profile
  const signals = await withProject(host, projectId, 'start:homework', (opened) =>
    rankSignals(opened.db, profile?.competitors ?? [], profile?.switchingFrom ?? [])
  )
  const picks = pickStartPages(rankStartPages(input.pages, signals))
  const [picked, ideas] = await Promise.all([
    pick(host, {
      projectId,
      domain: input.domain,
      market: profile === null ? 'Not set' : askMarketLabel(profile.market),
      sections: input.sections,
      picks,
      siteText: siteText(input.reads, 900),
      readable: input.readable
    }),
    topicsFor(host, projectId, {
      domain: input.domain,
      brandNames: profile?.brandNames ?? [],
      marketId: profile?.market.id ?? null,
      reads: input.reads,
      pages: input.pages,
      products: signals.products
    })
  ])
  const { explained, ...shown } = picked
  return {
    picked: { ...shown, pages: withSeedReasons(shown.pages, explained, picks, ideas.seeds) },
    topics: ideas.topics
  }
}

/** "Buyers getting server alerts texted to on-call phones ask AI Overviews what to do". */
function buyersAsk(seed: string): string {
  return `Buyers ${seed.charAt(0).toLowerCase()}${seed.slice(1)} ask AI Overviews what to do`
}

/**
 * A page reason names a buyer situation. A pick Claude did not explain (or explained
 * with only a count) takes the seed situation its path and title share most words
 * with, else the first seed of its product; the ranking facts stay as the evidence
 * unless they are only a count too. Without a matching seed the page keeps its line.
 */
export function withSeedReasons(
  pages: readonly SiteStartPage[],
  explained: ReadonlySet<string>,
  picks: readonly RankedPage[],
  seeds: readonly SeedIdea[]
): SiteStartPage[] {
  if (seeds.length === 0) return [...pages]
  return pages.map((page) => {
    if (explained.has(page.url)) return page
    const pick = picks.find((entry) => entry.page.url === page.url)
    const scored = seeds
      .map((seed, index) => ({ seed, index, hits: seedPageHits(seed.text, page) }))
      .filter((entry) => entry.hits > 0)
      .sort((left, right) => right.hits - left.hits || left.index - right.index)
    const seed =
      scored[0]?.seed ??
      (pick?.productId == null
        ? undefined
        : seeds.find((item) => item.productId === pick.productId))
    if (seed === undefined) return page
    return {
      ...page,
      reason: `${buyersAsk(seed.text)}, and this page can answer them.`,
      evidence: isCountOnly(page.evidence) ? (seed.evidence ?? page.evidence) : page.evidence
    }
  })
}

/**
 * What the page ranking reads: the saved products, their competitors (the flat list
 * as whole-business rows when the catalog is empty) and what buyers switch from.
 */
function rankSignals(
  db: SqliteDatabase,
  competitors: readonly string[],
  switchingFrom: readonly string[]
): RankSignals {
  const rows = listProductCompetitors(db)
  return {
    products: listProducts(db),
    competitors:
      rows.length > 0
        ? rows
        : competitors.map((name) => ({
            name,
            domain: competitorDomainOf(name),
            productId: null,
            tier: 'direct' as const
          })),
    switchingFrom
  }
}

/** Code's picks, explained by Claude; the ranking facts stand in when Claude cannot. */
async function pick(
  host: EngineHost,
  input: Parameters<typeof buildStartPrompt>[0] & { projectId: string; readable: boolean }
): Promise<FirstPicks['picked'] & { explained: ReadonlySet<string> }> {
  const fallback = (): SiteStartPage[] =>
    input.picks.map((entry: RankedPage) =>
      rulePage(entry.page, input.sections, undefined, factsLine(entry))
    )
  if (!input.readable) {
    return {
      pages: fallback(),
      source: 'rules',
      message: 'CiteFox could not read your site or sitemap. Add a page yourself.',
      explained: new Set()
    }
  }
  try {
    const reply = await completeAssist(
      host,
      'start:homework',
      buildStartPrompt(input),
      (value) => acceptStartReply(value, input.picks),
      null,
      { assistId: START_ASSIST_ID, projectId: input.projectId }
    )
    const parsed = parseStartReply(reply, input.picks, input.sections)
    if (parsed.explained === 0 && input.picks.length > 0) throw new Error('unusable reply')
    return {
      pages: parsed.pages,
      source: 'claude',
      message: null,
      explained: parsed.explainedUrls
    }
  } catch (error) {
    host.logger.warn('start autopilot: Claude pick failed', {
      message: error instanceof Error ? error.message : 'failed'
    })
    return {
      pages: fallback(),
      source: 'rules',
      message:
        'CiteFox AI could not be reached, so these pages come from their addresses. Questions need CiteFox AI.',
      explained: new Set()
    }
  }
}

/**
 * The first topics (P2 item 4): the seeds-only `topic_seed_discover` call with one
 * spare seed, ranked by code (site pages that could be cited for it, competitors in
 * play for its product, then Claude's order); the best {@link START_MAX_TOPICS} kept.
 * Empty when Claude cannot be reached.
 */
async function topicsFor(
  host: EngineHost,
  projectId: string,
  input: {
    domain: string
    brandNames: readonly string[]
    marketId: string | null
    reads: readonly SiteRead[]
    pages: readonly StartPageRow[]
    products: RankSignals['products']
  }
): Promise<{ topics: FirstTopic[]; seeds: SeedIdea[] }> {
  if (!input.reads.some((read) => read.ok)) return { topics: [], seeds: [] }
  try {
    return await withProject(host, projectId, 'start:homework', async (opened) => {
      const ideas = await seedIdeas(host, opened, {
        channel: 'start:homework',
        domain: input.domain,
        about: null,
        brandNames: input.brandNames,
        marketId: input.marketId,
        reads: input.reads,
        count: START_MAX_TOPICS + 1
      })
      const first = ideas.seeds[0]?.text ?? null
      const topics = rankSeeds(ideas.seeds, input.pages, contestedProducts(opened))
        .slice(0, START_MAX_TOPICS)
        .map((seed) => {
          const product = input.products.find((item) => item.id === seed.productId) ?? null
          const covered =
            seed.pages > 0
              ? `${seed.pages} of your ${seed.pages === 1 ? 'pages covers' : 'pages cover'} it`
              : 'Your homepage and key pages answer it'
          return {
            seed: seed.text,
            productId: seed.productId,
            reason:
              seed.text === first && ideas.why !== null
                ? ideas.why
                : `${buyersAsk(seed.text)}, and ${covered.charAt(0).toLowerCase()}${covered.slice(1)}${product === null ? '' : ` for ${product.name}`}.`,
            evidence: seed.evidence ?? `${covered}.`,
            caution: seed.caution
          }
        })
      return { topics, seeds: ideas.seeds }
    })
  } catch (error) {
    host.logger.warn('start autopilot: seed ideas failed', {
      message: error instanceof Error ? error.message : 'failed'
    })
    return { topics: [], seeds: [] }
  }
}
