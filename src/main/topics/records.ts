import {
  isFunnelStage,
  isKeywordGroupKind,
  isKeywordIntent,
  isPageType,
  isTopicGenerate,
  isTopicPromptKind,
  isTopicPromptSource,
  isTopicSource,
  isTopicStage,
  isTopicWizardPath,
  isTopicWizardStep
} from '@shared/domain'
import type {
  FunnelStage,
  KeywordGroupKind,
  KeywordIntent,
  PageType,
  TopicBands,
  TopicDraft,
  TopicGenerate,
  TopicPromptKind,
  TopicPromptSource,
  TopicSource,
  TopicStage,
  TopicWizardPath,
  TopicWizardStep
} from '@shared/domain'
import type { SqliteDatabase } from '../storage/database'
import { StorageError } from '../storage/errors'

/** `topics`, `topic_prompts`, `topic_drafts`, `topic_site_reads`, `topic_check_batches`. */

export interface TopicRecord {
  pageId: string
  seed: string
  source: TopicSource
  competitorUrl: string | null
  website: string | null
  about: string | null
  generate: TopicGenerate
  depth: Record<string, unknown>
  bands: TopicBands
  draftId: string | null
  createdAt: string
  updatedAt: string
}

interface TopicSql {
  page_id: string
  seed: string
  source: string
  competitor_url: string | null
  website: string | null
  about: string | null
  generate: string
  depth_json: string
  question_band_lo: number
  question_band_hi: number
  keyword_band_lo: number
  keyword_band_hi: number
  draft_id: string | null
  created_at: string
  updated_at: string
}

export function upsertTopic(db: SqliteDatabase, record: TopicRecord): void {
  db.prepare(
    `INSERT INTO topics (
       page_id, seed, source, competitor_url, website, about, generate, depth_json,
       question_band_lo, question_band_hi, keyword_band_lo, keyword_band_hi, draft_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (page_id) DO UPDATE SET
       seed = excluded.seed, source = excluded.source, competitor_url = excluded.competitor_url,
       website = excluded.website, about = excluded.about, generate = excluded.generate,
       depth_json = excluded.depth_json, question_band_lo = excluded.question_band_lo,
       question_band_hi = excluded.question_band_hi, keyword_band_lo = excluded.keyword_band_lo,
       keyword_band_hi = excluded.keyword_band_hi, draft_id = excluded.draft_id,
       updated_at = excluded.updated_at`
  ).run(
    record.pageId,
    record.seed.slice(0, 500),
    record.source,
    record.competitorUrl,
    record.website,
    record.about === null ? null : record.about.slice(0, 4000),
    record.generate,
    JSON.stringify(record.depth),
    record.bands.questions.lo,
    record.bands.questions.hi,
    record.bands.keywords.lo,
    record.bands.keywords.hi,
    record.draftId,
    record.createdAt,
    record.updatedAt
  )
}

export function getTopic(db: SqliteDatabase, pageId: string): TopicRecord | null {
  const row = db.prepare<unknown[], TopicSql>('SELECT * FROM topics WHERE page_id = ?').get(pageId)
  return row === undefined ? null : topicFromSql(row)
}

export function listTopics(db: SqliteDatabase): TopicRecord[] {
  return db
    .prepare<unknown[], TopicSql>('SELECT * FROM topics ORDER BY created_at ASC, rowid ASC')
    .all()
    .map(topicFromSql)
}

export function setTopicBands(
  db: SqliteDatabase,
  pageId: string,
  bands: TopicBands,
  now: string
): void {
  db.prepare(
    `UPDATE topics SET question_band_lo = ?, question_band_hi = ?, keyword_band_lo = ?,
       keyword_band_hi = ?, updated_at = ? WHERE page_id = ?`
  ).run(bands.questions.lo, bands.questions.hi, bands.keywords.lo, bands.keywords.hi, now, pageId)
}

/** The topic's target page (migration 047), or null when none is set. */
export function getTopicTargetPage(db: SqliteDatabase, pageId: string): string | null {
  const row = db
    .prepare<unknown[], { target_url: string | null }>(
      'SELECT target_url FROM topics WHERE page_id = ?'
    )
    .get(pageId)
  return row?.target_url ?? null
}

/** Sets or clears (`null`) the topic's target page, a URL already resolved on the own site. */
export function setTopicTargetPage(
  db: SqliteDatabase,
  pageId: string,
  url: string | null,
  now: string
): void {
  db.prepare('UPDATE topics SET target_url = ?, updated_at = ? WHERE page_id = ?').run(
    url === null ? null : url.slice(0, 2000),
    now,
    pageId
  )
}

function topicFromSql(row: TopicSql): TopicRecord {
  if (!isTopicSource(row.source) || !isTopicGenerate(row.generate)) {
    throw new StorageError('Invalid topic row')
  }
  let depth: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(row.depth_json) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      depth = parsed as Record<string, unknown>
    }
  } catch {
    depth = {}
  }
  return {
    pageId: row.page_id,
    seed: row.seed,
    source: row.source,
    competitorUrl: row.competitor_url,
    website: row.website,
    about: row.about,
    generate: row.generate,
    depth,
    bands: {
      questions: { lo: row.question_band_lo, hi: row.question_band_hi },
      keywords: { lo: row.keyword_band_lo, hi: row.keyword_band_hi }
    },
    draftId: row.draft_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// ---------------------------------------------------------------------------
// topic_prompts
// ---------------------------------------------------------------------------

export interface TopicPromptRecord {
  promptId: string
  pageId: string
  stableKey: string
  kind: TopicPromptKind
  stage: TopicStage | null
  source: TopicPromptSource
  sourceNote: string | null
  kwGroup: string | null
  kwGroupKind: KeywordGroupKind | null
  intent: KeywordIntent | null
  funnel: FunnelStage | null
  pageType: PageType | null
  targetPageId: string | null
  targetUrl: string | null
  matchConfidence: number | null
  matchReason: string | null
  matchSetBy: 'claude' | 'user' | null
  matchConfirmed: boolean
  /** Other own pages that may answer it; Google citing any counts as the right page. */
  alsoUrls?: readonly string[]
}

interface TopicPromptSql {
  prompt_id: string
  page_id: string
  stable_key: string
  kind: string
  stage: string | null
  source: string
  source_note: string | null
  kw_group: string | null
  kw_group_kind: string | null
  intent: string | null
  funnel: string | null
  page_type: string | null
  target_page_id: string | null
  target_url: string | null
  match_confidence: number | null
  match_reason: string | null
  match_set_by: string | null
  match_confirmed: number
  also_urls_json?: string
}

export function insertTopicPrompts(db: SqliteDatabase, rows: readonly TopicPromptRecord[]): void {
  const insert = db.prepare(
    `INSERT INTO topic_prompts (
       prompt_id, page_id, stable_key, kind, stage, source, source_note, kw_group, kw_group_kind,
       intent, funnel, page_type, target_page_id, target_url, match_confidence, match_reason,
       match_set_by, match_confirmed, also_urls_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const row of rows) {
    insert.run(
      row.promptId,
      row.pageId,
      row.stableKey,
      row.kind,
      row.stage,
      row.source,
      clip(row.sourceNote, 500),
      clip(row.kwGroup, 120),
      row.kwGroupKind,
      row.intent,
      row.funnel,
      row.pageType,
      row.targetUrl === null ? null : row.targetPageId,
      clip(row.targetUrl, 2000),
      row.matchConfidence === null
        ? null
        : Math.max(0, Math.min(100, Math.round(row.matchConfidence))),
      clip(row.matchReason, 500),
      row.matchSetBy,
      row.matchConfirmed ? 1 : 0,
      JSON.stringify(cleanAlso(row.alsoUrls ?? [], row.targetUrl))
    )
  }
}

const MAX_ALSO = 10

/** Unique, short enough, never the target itself; at most {@link MAX_ALSO}. */
function cleanAlso(urls: readonly string[], target: string | null): string[] {
  const out: string[] = []
  for (const url of urls) {
    if (url.length === 0 || url.length > 2000 || url === target || out.includes(url)) continue
    out.push(url)
    if (out.length >= MAX_ALSO) break
  }
  return out
}

/** The question's other pages (besides its target). */
export function setTopicPromptAlso(
  db: SqliteDatabase,
  promptId: string,
  urls: readonly string[]
): void {
  const row = db
    .prepare<unknown[], { target_url: string | null }>(
      'SELECT target_url FROM topic_prompts WHERE prompt_id = ?'
    )
    .get(promptId)
  db.prepare('UPDATE topic_prompts SET also_urls_json = ? WHERE prompt_id = ?').run(
    JSON.stringify(cleanAlso(urls, row?.target_url ?? null)),
    promptId
  )
}

function parseAlso(json: string | undefined): string[] {
  if (json === undefined) return []
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Topic prompt rows of one prompt set, in prompt position order. */
export function listTopicPrompts(db: SqliteDatabase, promptSetId: string): TopicPromptRecord[] {
  return db
    .prepare<unknown[], TopicPromptSql>(
      `SELECT topic_prompts.* FROM topic_prompts
         JOIN prompts ON prompts.id = topic_prompts.prompt_id
        WHERE prompts.prompt_set_id = ?
        ORDER BY prompts.position ASC`
    )
    .all(promptSetId)
    .map(topicPromptFromSql)
}

/** Every topic prompt row the topic ever had (all prompt-set versions). */
export function listAllTopicPrompts(db: SqliteDatabase, pageId: string): TopicPromptRecord[] {
  return db
    .prepare<unknown[], TopicPromptSql>('SELECT * FROM topic_prompts WHERE page_id = ?')
    .all(pageId)
    .map(topicPromptFromSql)
}

export function setTopicPromptTarget(
  db: SqliteDatabase,
  promptId: string,
  target: {
    pageId: string | null
    url: string | null
    confidence: number | null
    reason: string | null
    setBy: 'claude' | 'user'
    confirmed: boolean
  }
): void {
  db.prepare(
    `UPDATE topic_prompts SET target_page_id = ?, target_url = ?, match_confidence = ?,
       match_reason = ?, match_set_by = ?, match_confirmed = ? WHERE prompt_id = ?`
  ).run(
    target.url === null ? null : target.pageId,
    clip(target.url, 2000),
    target.confidence,
    clip(target.reason, 500),
    target.setBy,
    target.confirmed ? 1 : 0,
    promptId
  )
}

function topicPromptFromSql(row: TopicPromptSql): TopicPromptRecord {
  if (!isTopicPromptKind(row.kind) || !isTopicPromptSource(row.source)) {
    throw new StorageError('Invalid topic prompt row')
  }
  return {
    promptId: row.prompt_id,
    pageId: row.page_id,
    stableKey: row.stable_key,
    kind: row.kind,
    stage: row.stage !== null && isTopicStage(row.stage) ? row.stage : null,
    source: row.source,
    sourceNote: row.source_note,
    kwGroup: row.kw_group,
    kwGroupKind:
      row.kw_group_kind !== null && isKeywordGroupKind(row.kw_group_kind)
        ? row.kw_group_kind
        : null,
    intent: row.intent !== null && isKeywordIntent(row.intent) ? row.intent : null,
    funnel: row.funnel !== null && isFunnelStage(row.funnel) ? row.funnel : null,
    pageType: row.page_type !== null && isPageType(row.page_type) ? row.page_type : null,
    targetPageId: row.target_page_id,
    targetUrl: row.target_url,
    matchConfidence: row.match_confidence,
    matchReason: row.match_reason,
    matchSetBy:
      row.match_set_by === 'claude' || row.match_set_by === 'user' ? row.match_set_by : null,
    matchConfirmed: row.match_confirmed === 1,
    alsoUrls: parseAlso(row.also_urls_json)
  }
}

// ---------------------------------------------------------------------------
// topic_drafts
// ---------------------------------------------------------------------------

export interface StoredDraftRow {
  id: string
  path: TopicWizardPath
  step: TopicWizardStep
  topicPageId: string | null
  state: TopicDraft
  createdAt: string
  updatedAt: string
  startedAt: string | null
}

interface DraftSql {
  id: string
  path: string
  step: string
  topic_page_id: string | null
  state_json: string
  created_at: string
  updated_at: string
  started_at: string | null
  discarded_at: string | null
}

export function saveDraftRow(db: SqliteDatabase, draft: TopicDraft): void {
  db.prepare(
    `INSERT INTO topic_drafts (id, path, step, topic_page_id, state_json, created_at, updated_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       path = excluded.path, step = excluded.step, topic_page_id = excluded.topic_page_id,
       state_json = excluded.state_json, updated_at = excluded.updated_at,
       started_at = excluded.started_at`
  ).run(
    draft.id,
    draft.path,
    draft.step,
    draft.topicId,
    JSON.stringify(draft),
    draft.createdAt,
    draft.updatedAt,
    draft.startedAt
  )
}

export function readDraftRow(db: SqliteDatabase, id: string): StoredDraftRow | null {
  const row = db
    .prepare<unknown[], DraftSql>(
      'SELECT * FROM topic_drafts WHERE id = ? AND discarded_at IS NULL'
    )
    .get(id)
  return row === undefined ? null : draftFromSql(row)
}

/** Open drafts, newest first. */
export function listDraftRows(db: SqliteDatabase): StoredDraftRow[] {
  return db
    .prepare<unknown[], DraftSql>(
      `SELECT * FROM topic_drafts WHERE discarded_at IS NULL AND started_at IS NULL
        ORDER BY updated_at DESC`
    )
    .all()
    .map(draftFromSql)
    .filter((row): row is StoredDraftRow => row !== null)
}

export function discardDraftRow(db: SqliteDatabase, id: string, now: string): void {
  db.prepare('UPDATE topic_drafts SET discarded_at = ? WHERE id = ?').run(now, id)
}

function draftFromSql(row: DraftSql): StoredDraftRow | null {
  if (!isTopicWizardPath(row.path) || !isTopicWizardStep(row.step)) return null
  let state: TopicDraft
  try {
    state = JSON.parse(row.state_json) as TopicDraft
  } catch {
    return null
  }
  return {
    id: row.id,
    path: row.path,
    step: row.step,
    topicPageId: row.topic_page_id,
    state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at
  }
}

// ---------------------------------------------------------------------------
// topic_site_reads
// ---------------------------------------------------------------------------

export type SiteReadRole =
  'home' | 'pricing' | 'features' | 'faq' | 'about' | 'use_cases' | 'other' | 'competitor'

/** Characters of page text a site read keeps: a long blog post whole, menu included. */
export const SITE_READ_TEXT_MAX = 150_000
/** The old cap: a read this long was likely cut short, so Page edits reads it again. */
export const OLD_SITE_READ_TEXT_MAX = 20_000

export interface SiteRead {
  url: string
  role: SiteReadRole
  ok: boolean
  title: string | null
  metaDescription: string | null
  h1: string | null
  outline: readonly string[]
  faqCount: number
  wordCount: number
  text: string
  method: 'direct' | 'jina' | 'fixture' | null
  readAt: string
}

interface SiteReadSql {
  url: string
  role: string
  ok: number
  title: string | null
  meta_description: string | null
  h1: string | null
  outline_json: string
  faq_count: number
  word_count: number
  text: string
  method: string | null
  read_at: string
}

export function saveSiteRead(db: SqliteDatabase, read: SiteRead): void {
  db.prepare(
    `INSERT INTO topic_site_reads (url, role, ok, title, meta_description, h1, outline_json,
       faq_count, word_count, text, method, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET role = excluded.role, ok = excluded.ok, title = excluded.title,
       meta_description = excluded.meta_description, h1 = excluded.h1,
       outline_json = excluded.outline_json, faq_count = excluded.faq_count,
       word_count = excluded.word_count, text = excluded.text, method = excluded.method,
       read_at = excluded.read_at`
  ).run(
    read.url.slice(0, 2000),
    read.role,
    read.ok ? 1 : 0,
    clip(read.title, 300),
    clip(read.metaDescription, 500),
    clip(read.h1, 300),
    JSON.stringify(read.outline.slice(0, 80).map((line) => line.slice(0, 200))),
    Math.max(0, read.faqCount),
    Math.max(0, read.wordCount),
    read.text.slice(0, SITE_READ_TEXT_MAX),
    read.method,
    read.readAt
  )
}

export function getSiteRead(db: SqliteDatabase, url: string): SiteRead | null {
  const row = db
    .prepare<unknown[], SiteReadSql>('SELECT * FROM topic_site_reads WHERE url = ?')
    .get(url)
  return row === undefined ? null : siteReadFromSql(row)
}

export function listSiteReads(db: SqliteDatabase, role?: SiteReadRole): SiteRead[] {
  const rows =
    role === undefined
      ? db.prepare<unknown[], SiteReadSql>('SELECT * FROM topic_site_reads ORDER BY read_at').all()
      : db
          .prepare<unknown[], SiteReadSql>(
            'SELECT * FROM topic_site_reads WHERE role = ? ORDER BY read_at'
          )
          .all(role)
  return rows.map(siteReadFromSql)
}

function siteReadFromSql(row: SiteReadSql): SiteRead {
  let outline: string[] = []
  try {
    const parsed = JSON.parse(row.outline_json) as unknown
    if (Array.isArray(parsed))
      outline = parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    outline = []
  }
  return {
    url: row.url,
    role: row.role as SiteReadRole,
    ok: row.ok === 1,
    title: row.title,
    metaDescription: row.meta_description,
    h1: row.h1,
    outline,
    faqCount: row.faq_count,
    wordCount: row.word_count,
    text: row.text,
    method:
      row.method === 'direct' || row.method === 'jina' || row.method === 'fixture'
        ? row.method
        : null,
    readAt: row.read_at
  }
}

// ---------------------------------------------------------------------------
// topic_check_batches
// ---------------------------------------------------------------------------

export interface TopicBatch {
  id: string
  pageId: string
  batchNo: number
  marketIds: readonly string[]
  promptKeys: readonly string[]
  dueAt: string
  jobId: string | null
  startedAt: string | null
  cancelledAt: string | null
}

interface BatchSql {
  id: string
  page_id: string
  batch_no: number
  market_ids: string
  prompt_keys: string
  due_at: string
  job_id: string | null
  started_at: string | null
  cancelled_at: string | null
}

export function insertTopicBatches(db: SqliteDatabase, batches: readonly TopicBatch[]): void {
  const insert = db.prepare(
    `INSERT INTO topic_check_batches (id, page_id, batch_no, market_ids, prompt_keys, due_at,
       job_id, started_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const batch of batches) {
    insert.run(
      batch.id,
      batch.pageId,
      batch.batchNo,
      JSON.stringify(batch.marketIds),
      JSON.stringify(batch.promptKeys),
      batch.dueAt,
      batch.jobId,
      batch.startedAt,
      batch.cancelledAt
    )
  }
}

export function listTopicBatches(db: SqliteDatabase, pageId?: string): TopicBatch[] {
  const rows =
    pageId === undefined
      ? db
          .prepare<unknown[], BatchSql>(
            'SELECT * FROM topic_check_batches ORDER BY due_at, batch_no'
          )
          .all()
      : db
          .prepare<unknown[], BatchSql>(
            'SELECT * FROM topic_check_batches WHERE page_id = ? ORDER BY batch_no'
          )
          .all(pageId)
  return rows.map((row) => ({
    id: row.id,
    pageId: row.page_id,
    batchNo: row.batch_no,
    marketIds: parseStrings(row.market_ids),
    promptKeys: parseStrings(row.prompt_keys),
    dueAt: row.due_at,
    jobId: row.job_id,
    startedAt: row.started_at,
    cancelledAt: row.cancelled_at
  }))
}

export function markTopicBatchStarted(
  db: SqliteDatabase,
  id: string,
  jobId: string | null,
  now: string
): void {
  db.prepare('UPDATE topic_check_batches SET job_id = ?, started_at = ? WHERE id = ?').run(
    jobId,
    now,
    id
  )
}

export function cancelPendingTopicBatches(db: SqliteDatabase, pageId: string, now: string): void {
  db.prepare(
    `UPDATE topic_check_batches SET cancelled_at = ?
      WHERE page_id = ? AND started_at IS NULL AND cancelled_at IS NULL`
  ).run(now, pageId)
}

/** A reworded question gets a new stable key; batches still waiting check it under that key. */
export function renamePendingBatchKey(
  db: SqliteDatabase,
  pageId: string,
  from: string,
  to: string
): void {
  const update = db.prepare('UPDATE topic_check_batches SET prompt_keys = ? WHERE id = ?')
  for (const batch of listTopicBatches(db, pageId)) {
    if (batch.startedAt !== null || batch.cancelledAt !== null) continue
    if (!batch.promptKeys.includes(from)) continue
    update.run(JSON.stringify(batch.promptKeys.map((key) => (key === from ? to : key))), batch.id)
  }
}

export function nextBatchNo(db: SqliteDatabase, pageId: string): number {
  const row = db
    .prepare<unknown[], { n: number | null }>(
      'SELECT MAX(batch_no) AS n FROM topic_check_batches WHERE page_id = ?'
    )
    .get(pageId)
  return (row?.n ?? 0) + 1
}

function parseStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function clip(value: string | null, max: number): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}
