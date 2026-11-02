import { resolveTargetPage } from '@shared/target-page'
import type { SqliteDatabase } from '../storage/database'
import { listProducts } from '../storage/products'
import { readProjectProfile } from '../storage/project-profile'
import { TopicInputError } from './drafts'
import { getTopicTargetPage, setTopicTargetPage } from './records'

/**
 * A topic's target page (migration 047, src/shared/target-page.ts): the page on the
 * own site its questions should be cited from. Set on the topic screen
 * (`topics:update` with `targetPage`), and prefilled from the topic's product page
 * when a topic is first written.
 */

/** `topics:update` `targetPage`: a URL or path on the own site, or null to clear it. */
export function saveTopicTargetPage(
  db: SqliteDatabase,
  input: { topicId: string; domain: string; value: string | null; now: string }
): void {
  if (input.value === null || input.value.trim().length === 0) {
    setTopicTargetPage(db, input.topicId, null, input.now)
    return
  }
  const includeSubdomains = readProjectProfile(db)?.includeSubdomains ?? false
  const url = resolveTargetPage(input.value, input.domain, includeSubdomains)
  if (url === null) {
    throw new TopicInputError(
      `Use a page on ${input.domain}.`,
      'Pick one of your pages, or type a path such as /pricing.'
    )
  }
  setTopicTargetPage(db, input.topicId, url, input.now)
}

/**
 * Sets the topic's target page to its product's page (`products.evidence_path`, where
 * Fill from my website found the product) when the topic has none yet. A product
 * found on the home page (`/`) is no target: the home page is not a product page.
 */
export function prefillTopicTargetPage(
  db: SqliteDatabase,
  input: { topicId: string; productId: string | null | undefined; domain: string; now: string }
): void {
  if (!input.productId || getTopicTargetPage(db, input.topicId) !== null) return
  const path = listProducts(db).find((product) => product.id === input.productId)?.evidencePath
  if (!path) return
  const url = resolveTargetPage(path, input.domain)
  if (url === null || new URL(url).pathname === '/') return
  setTopicTargetPage(db, input.topicId, url, input.now)
}
