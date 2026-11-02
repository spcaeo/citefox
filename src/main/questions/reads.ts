import { isCitationClass, isTopicStage } from '@shared/domain'
import type { CitationClass, PromptCheckStatus, TopicPromptKind, TopicStage } from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'

/**
 * The Questions screen's reads. Each is one statement over the whole project file
 * (NFR-12), so a project with a thousand questions is a handful of queries, never one
 * per question. Raw search and overview JSON are never read here: the check stored the
 * status, the brand-named flag and the references it derived from them.
 */

/** Bound parameters per statement, well under SQLite's limit. */
const CHUNK = 500

export interface ActivePrompt {
  id: string
  pageId: string
  promptSetId: string
  position: number
  enabled: boolean
  /** The wording in the market, else the first market's. */
  text: string
  /** A topic prompt's stage, else the stage its intent stands for. Null when unset. */
  stage: TopicStage | null
  kind: TopicPromptKind
  /** A topic prompt's target page (`topic_prompts`). Both null for a page's prompt. */
  targetPageId: string | null
  targetUrl: string | null
}

/** The journey stage a page prompt's intent stands for (the reverse of a topic's mapping). */
const INTENT_STAGE: Readonly<Record<string, TopicStage>> = {
  problem: 'problem',
  solution: 'options',
  comparison: 'compare',
  objection: 'doubts',
  trigger: 'decide'
}

/** Every prompt of every active prompt set, in page then position order. */
export function readActivePrompts(db: SqliteDatabase, marketId: string | null): ActivePrompt[] {
  const rows = db
    .prepare<
      unknown[],
      {
        id: string
        page_id: string
        prompt_set_id: string
        position: number
        enabled: number
        label: string
        text: string | null
        intent_stage: string
        topic_kind: string | null
        topic_stage: string | null
        target_page_id: string | null
        target_url: string | null
      }
    >(
      `SELECT prompts.id, prompt_sets.page_id, prompts.prompt_set_id, prompts.position,
              prompts.enabled, prompts.label, prompts.intent_stage,
              (SELECT text FROM prompt_variants v WHERE v.prompt_id = prompts.id
                ORDER BY (v.market_id = ?) DESC, v.market_id ASC LIMIT 1) AS text,
              tp.kind AS topic_kind, tp.stage AS topic_stage,
              tp.target_page_id, tp.target_url
       FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id AND prompt_sets.is_active = 1
       LEFT JOIN topic_prompts tp ON tp.prompt_id = prompts.id
       ORDER BY prompt_sets.page_id ASC, prompts.position ASC`
    )
    .all(marketId ?? '')
  return rows.map((row) => {
    const topic = row.topic_kind !== null
    const stage = topic
      ? row.topic_stage !== null && isTopicStage(row.topic_stage)
        ? row.topic_stage
        : null
      : (INTENT_STAGE[row.intent_stage] ?? null)
    return {
      id: row.id,
      pageId: row.page_id,
      promptSetId: row.prompt_set_id,
      position: row.position,
      enabled: row.enabled === 1,
      text: row.text ?? row.label,
      stage,
      kind: row.topic_kind === 'keyword' ? 'keyword' : 'question',
      targetPageId: row.target_url === null ? null : row.target_page_id,
      targetUrl: row.target_url
    }
  })
}

/** Page id → the markets it is checked in, oldest first. */
export function readPageMarkets(db: SqliteDatabase): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const rows = db
    .prepare<unknown[], { page_id: string; market_id: string }>(
      'SELECT page_id, market_id FROM page_markets ORDER BY added_at ASC, rowid ASC'
    )
    .all()
  for (const row of rows) {
    const list = out.get(row.page_id)
    if (list) list.push(row.market_id)
    else out.set(row.page_id, [row.market_id])
  }
  return out
}

/** A saved version's prompt → the prompt it was carried from, with that one's wording. */
export interface LineageStep {
  previousId: string
  previousText: string | null
}

export function readLineage(db: SqliteDatabase, marketId: string | null): Map<string, LineageStep> {
  const rows = db
    .prepare<unknown[], { prompt_id: string; previous_prompt_id: string; text: string | null }>(
      `SELECT l.prompt_id, l.previous_prompt_id,
              (SELECT text FROM prompt_variants v WHERE v.prompt_id = l.previous_prompt_id
                ORDER BY (v.market_id = ?) DESC, v.market_id ASC LIMIT 1) AS text
       FROM prompt_lineage l`
    )
    .all(marketId ?? '')
  return new Map(
    rows.map((row) => [
      row.prompt_id,
      { previousId: row.previous_prompt_id, previousText: row.text }
    ])
  )
}

/** One capture of a finished check, without its raw JSON. */
export interface LeanSample {
  id: string
  runId: string
  promptId: string
  sampleNo: number
  status: PromptCheckStatus
  named: boolean | null
  citedUrl: string | null
  position: number | null
}

export interface LeanReference {
  serpResultId: string
  position: number
  url: string
  domain: string
  classification: CitationClass
}

/** References of these captures, in position order. */
export function readReferences(db: SqliteDatabase, sampleIds: readonly string[]): LeanReference[] {
  const out: LeanReference[] = []
  for (let at = 0; at < sampleIds.length; at += CHUNK) {
    const ids = sampleIds.slice(at, at + CHUNK)
    const rows = db
      .prepare<
        unknown[],
        {
          serp_result_id: string
          position: number
          url: string
          domain: string
          classification: string
        }
      >(
        `SELECT serp_result_id, position, url, domain, classification
         FROM aio_references
         WHERE serp_result_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY serp_result_id ASC, position ASC`
      )
      .all(...ids)
    for (const row of rows) {
      if (!isCitationClass(row.classification)) continue
      out.push({
        serpResultId: row.serp_result_id,
        position: row.position,
        url: row.url,
        domain: row.domain,
        classification: row.classification
      })
    }
  }
  return out
}

/** Splits ids for a reader that binds one parameter per id. */
export function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += CHUNK) out.push(items.slice(at, at + CHUNK))
  return out
}
