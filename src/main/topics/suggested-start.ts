import type { TopicSuggestedStartResult } from '@shared/ipc'
import { listPagesOfKind } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import type { OpenedProject, TopicEnv } from './env'
import { seedIdeas } from './seed-ideas'
import { cachedSiteReads } from './site'

/**
 * The suggested start on the topic wizard's first screen (Docs/PROMPT-AUDIT.md P2
 * item 3): the seeds-only `topic_seed_discover` call with a count of one, from the
 * cached site reads and saved project data. The seed carries its product, so a topic
 * started from it reads that product's competitors.
 */

/** `topics:suggestedStart`: one seed from saved project data. Null with a message when there is none. */
export async function suggestedStart(
  env: TopicEnv,
  opened: OpenedProject
): Promise<TopicSuggestedStartResult> {
  const pages = listPagesOfKind(opened.db, opened.project.id, 'page').filter(
    (page) => page.status === 'tracked'
  )
  const reads = cachedSiteReads(opened.db)
  if (pages.length === 0 && reads.length === 0) {
    return {
      suggestion: null,
      message: 'Track a page or read your site first, and CiteFox can suggest a start.'
    }
  }
  const profile = readProjectProfile(opened.db)
  const ideas = await seedIdeas(env.host, opened, {
    channel: 'topics:suggestedStart',
    domain: opened.project.domain,
    about: null,
    brandNames: profile?.brandNames ?? [],
    marketId: profile?.market.id ?? null,
    reads,
    count: 1
  })
  const seed = ideas.seeds[0]
  if (seed === undefined) return { suggestion: null, message: 'No start could be suggested yet.' }
  const cited =
    opened.db
      .prepare<unknown[], { n: number }>(
        `SELECT COUNT(DISTINCT domain) AS n FROM aio_references WHERE classification = 'competitor'`
      )
      .get()?.n ?? 0
  return {
    suggestion: {
      seed: seed.text,
      productId: seed.productId,
      facts: [
        {
          value: String(pages.length),
          text: `tracked ${pages.length === 1 ? 'page' : 'pages'} to match questions to`
        },
        {
          value: String(cited),
          text: `competitor ${cited === 1 ? 'domain' : 'domains'} cited in your saved checks`
        }
      ],
      why: ideas.why ?? 'It is the problem your saved pages and checks point to most.',
      path: 'seed',
      info: ideas.info
    },
    message: null
  }
}
