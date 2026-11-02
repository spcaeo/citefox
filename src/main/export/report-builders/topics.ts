import type { SqliteDatabase } from '../../storage/database'
import { getPage } from '../../storage/pages'
import { loadTopicResults } from '../../topics/results'
import type { ReportBuildContext, TopicCoverageSection, TopicCoverageTopic } from '../model/types'
import {
  buildTopicCoverageTopic,
  topicCoverageSection,
  type SavedTopicSummary
} from '../model/topic-coverage'

/**
 * Topic coverage for the topic subjects in a report, read from saved checks and the
 * saved Claude summary (`topic_summaries`). Never searches and never calls Claude.
 * Null when no tracked subject is a topic, so a page report leaves the section out.
 */
export function topicCoverageFromStorage(
  db: SqliteDatabase,
  input: { projectId: string; domain: string; builtAt: string },
  context: ReportBuildContext
): TopicCoverageSection | null {
  const topics: TopicCoverageTopic[] = []
  let anyTopic = false
  for (const page of context.pages) {
    if (page.role !== 'tracked') continue
    const stored = getPage(db, page.id, input.projectId)
    if (stored === null || stored.kind !== 'topic') continue
    anyTopic = true
    for (const market of context.markets) {
      let results: ReturnType<typeof loadTopicResults>
      try {
        results = loadTopicResults(db, {
          projectId: input.projectId,
          topicId: page.id,
          marketId: market.id,
          runId: null,
          domain: input.domain,
          builtAt: input.builtAt
        })
      } catch {
        continue
      }
      // A market the topic is not checked in reads back as another market; skip it.
      if (results.topic.marketId !== market.id) continue
      topics.push(
        buildTopicCoverageTopic(
          results,
          savedSummary(db, page.id, market.id),
          context,
          market.label
        )
      )
    }
  }
  return anyTopic ? topicCoverageSection(topics) : null
}

interface SummarySql {
  line: string
  executive: string
  actions_json: string
  created_at: string
}

/** The latest saved `topic_summary` for the topic in that market, or null. */
export function savedSummary(
  db: SqliteDatabase,
  topicId: string,
  marketId: string
): SavedTopicSummary | null {
  let row: SummarySql | undefined
  try {
    row = db
      .prepare<unknown[], SummarySql>(
        `SELECT line, executive, actions_json, created_at FROM topic_summaries
          WHERE page_id = ? AND market_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(topicId, marketId)
  } catch {
    return null
  }
  if (row === undefined) return null
  return {
    line: row.line,
    executive: row.executive,
    actions: parseActions(row.actions_json),
    createdAt: row.created_at
  }
}

function parseActions(json: string): SavedTopicSummary['actions'] {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { text: item, verify: null }
        if (typeof item !== 'object' || item === null) return null
        const record = item as Record<string, unknown>
        if (typeof record.text !== 'string' || record.text.trim().length === 0) return null
        return {
          text: record.text,
          verify: typeof record.verify === 'string' ? record.verify : null
        }
      })
      .filter((item): item is { text: string; verify: string | null } => item !== null)
      .slice(0, 3)
  } catch {
    return []
  }
}
