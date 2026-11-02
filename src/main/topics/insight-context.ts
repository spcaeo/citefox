import type { TopicResultRow } from '@shared/domain'
import { competitorContext } from '../engine/competitor-context'
import { fence, marketBlock } from '../prompts/blocks'
import {
  overviewWithSources,
  referencesBlock,
  tagReferences,
  type StoredReference,
  type TaggedReference
} from '../prompts/citations'
import type { SqliteDatabase } from '../storage/database'
import { getMarket, readProjectProfile } from '../storage/project-profile'

/**
 * What the topic results prompts (Docs/PROMPT-AUDIT.md, package P5) read from a
 * stored check: one prompt's overview with its source markers, its sources tagged
 * by the topic product's competitors, the market and where the business stands.
 * Saved data only; never a search.
 */

/** One prompt's stored overview in one run: the flat text, the raw overview and its sources. */
export interface StoredOverview {
  aioText: string | null
  rawAioJson: string | null
  references: StoredReference[]
}

/** The stored overview of one prompt in one run (the first sample with text). */
export function storedOverview(
  db: SqliteDatabase,
  promptId: string,
  runId: string | null
): StoredOverview {
  const empty: StoredOverview = { aioText: null, rawAioJson: null, references: [] }
  if (runId === null) return empty
  const serp = db
    .prepare<unknown[], { id: string; aio_text: string | null; raw_aio_json: string | null }>(
      `SELECT id, aio_text, raw_aio_json FROM serp_results WHERE run_id = ? AND prompt_id = ?
        ORDER BY (aio_text IS NULL) ASC, sample_no ASC LIMIT 1`
    )
    .get(runId, promptId)
  if (serp === undefined) return empty
  const rows = db
    .prepare<
      unknown[],
      {
        position: number
        url: string
        domain: string
        title: string | null
        classification: string
        source_type: string
      }
    >(
      `SELECT position, url, domain, title, classification, source_type
         FROM aio_references WHERE serp_result_id = ? ORDER BY position`
    )
    .all(serp.id)
  return {
    aioText: serp.aio_text,
    rawAioJson: serp.raw_aio_json,
    references: rows.map((row) => ({
      position: row.position,
      url: row.url,
      domain: row.domain,
      title: row.title,
      classification: row.classification,
      sourceType: row.source_type
    }))
  }
}

/** A stored overview ready for a prompt: fenced text, tagged sources and their listing. */
export interface OverviewForPrompt {
  references: TaggedReference[]
  /** `<overview>…</overview>` with `[n]` markers where Google showed them. */
  overview: string
  /** The overview text without the fence, for evidence checks. */
  overviewText: string
  /** One line per source, tagged own, direct or partial competitor, or other. */
  sources: string
}

/** Reads and tags one prompt's stored overview for the topic's product. */
export function overviewForPrompt(
  db: SqliteDatabase,
  input: { promptId: string; runId: string | null; topicId: string; ownDomain: string }
): OverviewForPrompt {
  const stored = storedOverview(db, input.promptId, input.runId)
  const context = competitorContext(db, { topicId: input.topicId })
  const references = tagReferences(stored.references, context, input.ownDomain)
  const read = overviewWithSources(stored.rawAioJson, stored.aioText, stored.references)
  const overviewText = read.text.length > 0 ? read.text : 'No overview text was stored.'
  return {
    references,
    overview: fence('overview', overviewText),
    overviewText,
    sources: referencesBlock(references, read.snippets)
  }
}

/** `{{ market_block }}` for a topic market, else the project's market. */
export function topicMarketBlock(db: SqliteDatabase, marketId: string | null): string {
  const market =
    (marketId === null ? null : getMarket(db, marketId)) ?? readProjectProfile(db)?.market ?? null
  if (market === null) return 'Market: not set. Write in English.'
  return marketBlock({
    country: market.country,
    language: market.language,
    location: market.location
  })
}

/** Where the business stands for one row, in plain words, from the check. */
export function standingLine(row: TopicResultRow, references: readonly TaggedReference[]): string {
  const own = references.filter((reference) => reference.tag === 'own')
  const ownText =
    own.length === 0
      ? 'its site is not among the sources'
      : `its site is cited at position ${own.map((reference) => `${reference.position} (${reference.url})`).join(', ')}`
  switch (row.state) {
    case 'right_page':
      return `Cited: the target page is a source; ${ownText}.`
    case 'other_page':
      return `Another page of the business is cited, not the target page; ${ownText}.`
    case 'not_cited':
      return `Not cited: ${ownText}.`
    case 'no_page':
      return `No target page is set for this question; ${ownText}.`
    case 'no_aio':
      return 'Google showed no AI Overview for this question.'
    case 'failed':
      return 'The search failed, so there is no overview to read.'
    case 'not_checked':
      return 'Not checked yet.'
  }
}
