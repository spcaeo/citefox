import type { QuestionRef } from '@shared/ipc'
import { getLatestPromptSet } from '../storage/content-records'
import type { SqliteDatabase } from '../storage/database'
import { getPage, setPageStatus } from '../storage/pages'
import { nextPromptIds } from '../storage/prompt-lineage'
import { readProductCatalog, replaceProductCatalog } from '../storage/products'
import type { ImportBatch } from './store'

/**
 * Undo of one import batch. Questions are found again by following their lineage to
 * the active prompt set (a later save gives each prompt a new id), then removed as
 * `questions:update remove` does; a topic the import created is removed with it.
 * Competitors and products leave the catalog; markets leave the page or topic and,
 * when nothing checked in them yet, the project.
 */

const MAX_STEPS = 500

/** The prompt carried from `promptId` into `active` (today's set), or null when it is gone. */
export function currentPromptId(
  db: SqliteDatabase,
  promptId: string,
  active: ReadonlySet<string>
): string | null {
  const queue = [promptId]
  const seen = new Set<string>()
  while (queue.length > 0 && seen.size < MAX_STEPS) {
    const id = queue.shift()
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    if (active.has(id)) return id
    queue.push(...nextPromptIds(db, id))
  }
  return null
}

export interface UndoPlan {
  /** Questions to remove through `questions:update`. */
  questions: QuestionRef[]
  /** Questions that are no longer there (removed or moved since). */
  gone: number
}

/** Resolves a batch's questions to the prompt ids in today's active sets. */
export function planQuestionUndo(
  db: SqliteDatabase,
  projectId: string,
  batch: ImportBatch
): UndoPlan {
  const plan: UndoPlan = { questions: [], gone: 0 }
  const activeBySource = new Map<string, Set<string>>()
  for (const item of batch.items) {
    if (item.kind !== 'prompt') continue
    let active = activeBySource.get(item.sourceId)
    if (active === undefined) {
      const page = getPage(db, item.sourceId, projectId)
      const set = page === null ? null : getLatestPromptSet(db, item.sourceId, [])
      active = new Set(set?.prompts.map((prompt) => prompt.id) ?? [])
      activeBySource.set(item.sourceId, active)
    }
    const current = currentPromptId(db, item.promptId, active)
    if (current === null) plan.gone += 1
    else plan.questions.push({ sourceId: item.sourceId, promptId: current })
  }
  return plan
}

/** Topics, competitors, products and markets the batch made. Returns how many were taken out. */
export function undoOtherItems(db: SqliteDatabase, projectId: string, batch: ImportBatch): number {
  let removed = 0
  for (const item of batch.items) {
    if (item.kind !== 'topic') continue
    const page = getPage(db, item.topicId, projectId)
    if (page === null || page.status === 'removed') continue
    removed += getLatestPromptSet(db, item.topicId, [])?.prompts.length ?? 0
    setPageStatus(db, item.topicId, 'removed', projectId)
  }
  const competitors = batch.items.filter((item) => item.kind === 'competitor')
  const products = new Set(
    batch.items.flatMap((item) => (item.kind === 'product' ? [item.productId] : []))
  )
  if (competitors.length > 0 || products.size > 0) {
    const catalog = readProductCatalog(db)
    const keptCompetitors = catalog.competitors.filter(
      (row) =>
        !(row.productId !== null && products.has(row.productId)) &&
        !competitors.some(
          (item) =>
            item.kind === 'competitor' &&
            row.productId === null &&
            row.name === item.name &&
            (row.domain ?? null) === item.domain
        )
    )
    const keptProducts = catalog.products.filter((product) => !products.has(product.id))
    removed +=
      catalog.products.length -
      keptProducts.length +
      (catalog.competitors.length - keptCompetitors.length)
    replaceProductCatalog(db, { products: keptProducts, competitors: keptCompetitors })
  }
  for (const item of batch.items) {
    if (item.kind !== 'market') continue
    if (item.pageId !== null) {
      db.prepare('DELETE FROM page_markets WHERE page_id = ? AND market_id = ?').run(
        item.pageId,
        item.marketId
      )
    }
    if (!item.created) continue
    const used = db
      .prepare<unknown[], { n: number }>(
        'SELECT COUNT(*) AS n FROM page_markets WHERE market_id = ?'
      )
      .get(item.marketId)
    if ((used?.n ?? 0) > 0) continue
    try {
      const result = db
        .prepare('DELETE FROM markets WHERE id = ? AND is_default = 0')
        .run(item.marketId)
      removed += result.changes
    } catch {
      // A check already ran in that market: the market stays, unlinked.
    }
  }
  return removed
}
