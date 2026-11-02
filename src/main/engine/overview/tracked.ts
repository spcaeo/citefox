import type { PageSummary } from '@shared/domain'
import type { OverviewTrackedQuestion } from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import { sourceOf } from './extras'
import { lineageRoot } from './timeline'

interface TrackedSql {
  page_id: string
  prompt_id: string
  label: string
  text: string | null
  stable_key: string | null
  keyword: number
}

/**
 * Every enabled prompt of the active sets of these pages and topics: the rows behind
 * the Overview's "Questions tracked" number (the same rule as `enabledPromptCounts`),
 * in page order, then prompt position. The wording is the page's default market's.
 * Keys match the checked questions' keys (a topic's stable key, a page prompt's
 * lineage root), so each row finds its latest result.
 */
export function trackedQuestions(
  db: SqliteDatabase,
  pages: readonly PageSummary[],
  lineage: ReadonlyMap<string, string>
): OverviewTrackedQuestion[] {
  if (pages.length === 0) return []
  const order = new Map(pages.map((page, index) => [page.id, index]))
  const byId = new Map(pages.map((page) => [page.id, page]))
  const rows = db
    .prepare<unknown[], TrackedSql>(
      `SELECT prompt_sets.page_id AS page_id, prompts.id AS prompt_id, prompts.label AS label,
              COALESCE(
                (SELECT v.text FROM prompt_variants v JOIN pages p ON p.id = prompt_sets.page_id
                  WHERE v.prompt_id = prompts.id AND v.market_id = p.default_market_id),
                (SELECT v.text FROM prompt_variants v WHERE v.prompt_id = prompts.id
                  ORDER BY v.rowid LIMIT 1)
              ) AS text,
              (SELECT tp.stable_key FROM topic_prompts tp
                WHERE tp.prompt_id = prompts.id AND tp.page_id = prompt_sets.page_id) AS stable_key,
              EXISTS (SELECT 1 FROM topic_prompts tp
                       WHERE tp.prompt_id = prompts.id AND tp.kind = 'keyword') AS keyword
         FROM prompt_sets
         JOIN prompts ON prompts.prompt_set_id = prompt_sets.id AND prompts.enabled = 1
        WHERE prompt_sets.is_active = 1
          AND prompt_sets.page_id IN (${pages.map(() => '?').join(', ')})
        ORDER BY prompts.position ASC`
    )
    .all(...pages.map((page) => page.id))
  return rows
    .map((row): OverviewTrackedQuestion => ({
      key: `${row.page_id}|${row.stable_key ?? lineageRoot(lineage, row.prompt_id)}`,
      pageId: row.page_id,
      promptId: row.prompt_id,
      label: row.label,
      text: row.text ?? row.label,
      source: sourceOf(byId.get(row.page_id)),
      keyword: row.keyword === 1
    }))
    .sort((left, right) => (order.get(left.pageId) ?? 0) - (order.get(right.pageId) ?? 0))
}
