import { sectionHash } from '../../shell/routes'
import type { TopicsClient } from './client'
import { addHash } from './routes'

/** A way to start that opens a path: the page form or a wizard draft. */
export type WayToStart = 'page' | 'seed' | 'keywords' | 'questions' | 'competitor'

/**
 * Opens one way to start and returns where to go: a page URL goes to the Add
 * page form (no draft); the others create a draft. Keywords & groups is the
 * seed path set to generate keywords. A suggested start's product is picked on the
 * draft, so the topic reads that product's competitors (Docs/PROMPT-AUDIT.md P2).
 */
export async function startWay(
  client: Pick<TopicsClient, 'topics:createDraft' | 'topics:updateDraft'>,
  projectId: string,
  way: WayToStart,
  seed?: string,
  productId?: string | null
): Promise<string> {
  if (way === 'page') return sectionHash('add-page')
  const path = way === 'keywords' ? 'seed' : way
  const draft = await client['topics:createDraft']({
    projectId,
    path,
    ...(seed !== undefined ? { seed, name: seed } : {})
  })
  const product = typeof productId === 'string' ? { mode: 'pick' as const, productId } : null
  if (way === 'keywords' || product !== null) {
    await client['topics:updateDraft']({
      projectId,
      draftId: draft.id,
      patch: {
        ...(way === 'keywords' ? { generate: 'keywords' as const } : {}),
        ...(product !== null ? { product } : {})
      }
    })
  }
  return addHash(draft.id)
}
