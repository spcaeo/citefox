import type { TopicBatchInput } from '../scheduler/types'
import type { SqliteDatabase } from '../storage/database'
import { listTopicBatches } from './records'

/**
 * The "N now and the rest over 7 days" plan. Each waiting batch is read into the
 * scheduler's check catalog (`readProjectCheckSlice`), so the due planner turns a
 * batch whose day has come into a due item with its prompt ids. It then runs
 * through the queue like any scheduled check — caps, pause, quiet hours, the
 * single due pass and cap notices — in the window and in `citefox --check-due`.
 * A batch is recorded as started when its check succeeds (`recordCheckedPage`);
 * a refused or failed batch stays waiting for the next pass.
 */

/** Stable keys → enabled prompt ids of the topic's active prompt set, in prompt order. */
export function promptIdsForKeys(
  db: SqliteDatabase,
  topicId: string,
  keys: readonly string[]
): string[] {
  if (keys.length === 0) return []
  const wanted = new Set(keys)
  return db
    .prepare<unknown[], { prompt_id: string; stable_key: string }>(
      `SELECT tp.prompt_id, tp.stable_key FROM topic_prompts tp
         JOIN prompts p ON p.id = tp.prompt_id
         JOIN prompt_sets s ON s.id = p.prompt_set_id
        WHERE s.page_id = ? AND s.is_active = 1 AND p.enabled = 1
        ORDER BY p.position`
    )
    .all(topicId)
    .filter((row) => wanted.has(row.stable_key))
    .map((row) => row.prompt_id)
}

/** Waiting batches of one project as catalog rows. Batches with no prompt left are dropped. */
export function topicBatchInputs(db: SqliteDatabase, projectId: string): TopicBatchInput[] {
  let batches
  try {
    batches = listTopicBatches(db)
  } catch {
    // A file from before migration 028 has no batches.
    return []
  }
  return batches.flatMap((batch) => {
    if (batch.startedAt !== null || batch.cancelledAt !== null) return []
    const promptIds = promptIdsForKeys(db, batch.pageId, batch.promptKeys)
    if (promptIds.length === 0) return []
    return [
      {
        id: batch.id,
        projectId,
        pageId: batch.pageId,
        dueAt: batch.dueAt,
        marketIds: batch.marketIds,
        promptIds
      }
    ]
  })
}
