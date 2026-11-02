import { SURE_FIT } from '@shared/topic-scoring'
import { targetPageKey } from '@shared/target-page'
import type { SqliteDatabase } from '../storage/database'
import { getTopicTargetPage, listAllTopicPrompts } from './records'

/**
 * Each topic question's pages that count as the right page: its Primary page and its
 * Also OK pages, or the topic's target page when the question has none of its own (a
 * CiteFox AI pick under {@link SURE_FIT} is a hint only). An empty list: no target yet,
 * so any page of the site counts. Every prompt version is listed, so old checks are
 * judged too. The one rule for new checks (classify) and the re-judge below.
 */
export function questionTargetPages(
  db: SqliteDatabase,
  topicId: string
): Map<string, readonly string[]> {
  const topicTarget = getTopicTargetPage(db, topicId)
  const out = new Map<string, readonly string[]>()
  for (const record of listAllTopicPrompts(db, topicId)) {
    const unsure =
      record.matchSetBy === 'claude' &&
      !record.matchConfirmed &&
      (record.matchConfidence ?? 0) < SURE_FIT
    const own = record.targetUrl !== null && !unsure
    out.set(
      record.promptId,
      own
        ? [record.targetUrl ?? '', ...(record.alsoUrls ?? [])].filter(Boolean)
        : topicTarget === null
          ? []
          : [topicTarget]
    )
  }
  return out
}

interface StoredSample {
  id: string
  prompt_id: string
  status: string
}

interface StoredRef {
  id: string
  position: number
  url: string
  normalized_url: string
  classification: string
}

const JUDGED = new Set(['page_cited', 'other_own_page', 'brand_mentioned', 'not_cited'])

/**
 * Re-judges a topic's saved Google AI Overview checks after its pages changed: each own
 * reference is `target` when it is one of the question's pages, else `own`, and the
 * sample's status, cited URL and position follow (the classify rule). Spends no search.
 * Returns how many samples changed.
 */
export function rejudgeTopicChecks(db: SqliteDatabase, topicId: string): number {
  const pages = questionTargetPages(db, topicId)
  const samples = db
    .prepare<unknown[], StoredSample>(
      `SELECT serp_results.id, serp_results.prompt_id, serp_results.status
         FROM serp_results JOIN runs ON runs.id = serp_results.run_id
        WHERE runs.page_id = ?`
    )
    .all(topicId)
  const refsOf = db.prepare<unknown[], StoredRef>(
    `SELECT id, position, url, normalized_url, classification FROM aio_references
      WHERE serp_result_id = ? ORDER BY position ASC`
  )
  const setRef = db.prepare('UPDATE aio_references SET classification = ? WHERE id = ?')
  const setSample = db.prepare(
    'UPDATE serp_results SET status = ?, cited_url = ?, position = ? WHERE id = ?'
  )
  let changed = 0
  db.transaction(() => {
    for (const sample of samples) {
      if (!JUDGED.has(sample.status)) continue
      const keys = new Set(
        (pages.get(sample.prompt_id) ?? [])
          .map((url) => targetPageKey(url))
          .filter((key): key is string => key !== null)
      )
      const refs = refsOf.all(sample.id)
      const own = refs.filter((ref) => ref.classification === 'target' || ref.classification === 'own')
      for (const ref of own) {
        const next = keys.has(targetPageKey(ref.normalized_url) ?? '') ? 'target' : 'own'
        if (next !== ref.classification) {
          setRef.run(next, ref.id)
          ref.classification = next
        }
      }
      const target = own.find((ref) => ref.classification === 'target')
      const other = own[0]
      const decided = target ?? other
      if (decided === undefined) continue
      const status = target !== undefined || keys.size === 0 ? 'page_cited' : 'other_own_page'
      if (status !== sample.status || target !== undefined || other !== undefined) {
        const result = setSample.run(status, decided.url, decided.position, sample.id)
        if (status !== sample.status && result.changes > 0) changed += 1
      }
    }
  })()
  return changed
}
