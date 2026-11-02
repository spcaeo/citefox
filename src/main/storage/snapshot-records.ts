import { isEligibilityCode, isOutlineLevel, isPageReadMethod } from '@shared/domain'
import type {
  BuyerProfile,
  BuyerProfileBody,
  NamedReason,
  OutlineEntry,
  PageEligibility,
  PageFaq,
  PagePromiseSummary,
  PageReadMethod
} from '@shared/domain'
import { requireCount, requireDuration } from './content-values'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import {
  assertId,
  readJson,
  requireContentHash,
  requireJsonDocument,
  requireLabel,
  requireOptionalLabel,
  requireStoredText,
  requireUtcTimestamp
} from './values'

/** `snapshots` and `buyer_profiles` rows in a project database. */

export interface StoredSnapshot {
  id: string
  pageId: string
  fetchedAt: string
  method: PageReadMethod
  httpStatus: number | null
  durationMs: number
  title: string | null
  metaDescription: string | null
  h1: string | null
  canonical: string | null
  publishedAt: string | null
  modifiedAt: string | null
  outline: readonly OutlineEntry[]
  faqs: readonly PageFaq[]
  h2Count: number
  h3Count: number
  tableCount: number
  bodyText: string
  wordCount: number
  contentHash: string
  summary: PagePromiseSummary | null
  /**
   * Whether Google may show and quote the page (direct reads only). Null or absent
   * when the read did not see the HTML, or came before project migration 044.
   */
  eligibility?: PageEligibility | null
}

export function insertSnapshot(db: SqliteDatabase, record: StoredSnapshot): void {
  const row = normalizeSnapshot(record)
  const eligibility = eligibilityJson(row.eligibility)
  // Unknown eligibility is the column's default (null), so it is only named when
  // known; a database from before migration 044 still takes the row.
  const extra = eligibility === null ? [] : [eligibility]
  db.prepare(
    `INSERT INTO snapshots (
       id, page_id, fetched_at, method, http_status, duration_ms, title, meta_description, h1,
       canonical, published_at, modified_at, outline_json, faqs_json, h2_count, h3_count,
       table_count, body_text, word_count, content_hash, summary_json${eligibility === null ? '' : ', eligibility_json'}
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${eligibility === null ? '' : ', ?'})`
  ).run(
    row.id,
    row.pageId,
    row.fetchedAt,
    row.method,
    row.httpStatus,
    row.durationMs,
    row.title,
    row.metaDescription,
    row.h1,
    row.canonical,
    row.publishedAt,
    row.modifiedAt,
    JSON.stringify(row.outline),
    JSON.stringify(row.faqs),
    row.h2Count,
    row.h3Count,
    row.tableCount,
    row.bodyText,
    row.wordCount,
    row.contentHash,
    row.summary === null ? null : JSON.stringify(row.summary),
    ...extra
  )
}

/** A newer read of an unchanged page saw new robots rules: keep them on the snapshot. */
export function setSnapshotEligibility(
  db: SqliteDatabase,
  snapshotId: string,
  eligibility: PageEligibility
): void {
  const id = assertId(snapshotId)
  const result = db
    .prepare(`UPDATE snapshots SET eligibility_json = ? WHERE id = ?`)
    .run(eligibilityJson(eligibility), id)
  if (result.changes !== 1) throw new StorageError('Could not save the page eligibility')
}

function eligibilityJson(eligibility: PageEligibility | null | undefined): string | null {
  if (eligibility === null || eligibility === undefined) return null
  return requireJsonDocument(
    {
      issues: eligibility.issues.map((issue) => ({
        code: isEligibilityCode(issue.code) ? issue.code : fail('Invalid eligibility'),
        where: issue.where,
        detail: requireLabel(issue.detail, 'eligibility detail', 200)
      }))
    },
    'eligibility'
  )
}

/** Unreadable or unknown entries are dropped, so an odd row never breaks the page read. */
function eligibilityFromSql(json: string | null): PageEligibility | null {
  if (json === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.issues)) return null
  const issues = parsed.issues.flatMap((item: unknown) => {
    if (!isRecord(item) || !isEligibilityCode(item.code) || typeof item.detail !== 'string') {
      return []
    }
    const where = item.where === 'header' || item.where === 'html' ? item.where : 'meta'
    return [{ code: item.code, where, detail: item.detail }] as const
  })
  return { issues }
}

export function setSnapshotSummary(
  db: SqliteDatabase,
  snapshotId: string,
  summary: PagePromiseSummary
): void {
  const id = assertId(snapshotId)
  const json = requireJsonDocument(summary, 'summary')
  const result = db.prepare(`UPDATE snapshots SET summary_json = ? WHERE id = ?`).run(json, id)
  if (result.changes !== 1) throw new StorageError('Could not save summary')
}

export function getLatestSnapshot(db: SqliteDatabase, pageId: string): StoredSnapshot | null {
  assertId(pageId)
  const row = db
    .prepare<unknown[], SnapshotSql>(
      `${SNAPSHOT_SELECT} WHERE page_id = ? ORDER BY fetched_at DESC, rowid DESC LIMIT 1`
    )
    .get(pageId)
  return row === undefined ? null : snapshotFromSql(row)
}

/** The snapshot a run stored, including the body text `aio_gap.md` compares. */
export function getStoredSnapshot(db: SqliteDatabase, snapshotId: string): StoredSnapshot | null {
  const row = db
    .prepare<unknown[], SnapshotSql>(`${SNAPSHOT_SELECT} WHERE id = ?`)
    .get(assertId(snapshotId))
  return row === undefined ? null : snapshotFromSql(row)
}

export function insertBuyerProfile(db: SqliteDatabase, profile: BuyerProfile): void {
  const id = assertId(profile.id)
  const pageId = assertId(profile.pageId)
  const snapshotId = assertId(profile.snapshotId)
  const body = requireJsonDocument(profileBody(profile), 'buyer profile')
  db.prepare(
    `INSERT INTO buyer_profiles (
       id, page_id, snapshot_id, body_json, template_id, template_name, template_hash,
       template_updated_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    pageId,
    snapshotId,
    body,
    assertId(profile.templateId),
    requireLabel(profile.templateName, 'template name', 80),
    requireContentHash(profile.templateHash),
    profile.templateUpdatedAt === null ? null : requireUtcTimestamp(profile.templateUpdatedAt),
    requireUtcTimestamp(profile.createdAt)
  )
}

export function getLatestBuyerProfile(db: SqliteDatabase, pageId: string): BuyerProfile | null {
  assertId(pageId)
  const row = db
    .prepare<unknown[], ProfileSql>(
      `SELECT id, page_id, snapshot_id, body_json, template_id, template_name, template_hash,
              template_updated_at, created_at
       FROM buyer_profiles WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(pageId)
  if (row === undefined) return null
  const prompt = db
    .prepare<unknown[], { icp_id: string }>(
      `SELECT icp_id FROM prompt_sets WHERE page_id = ? AND is_active = 1`
    )
    .get(pageId)
  return profileFromSql(row, prompt !== undefined && prompt.icp_id !== row.id)
}

interface SnapshotSql {
  id: string
  page_id: string
  fetched_at: string
  method: string
  http_status: number | null
  duration_ms: number
  title: string | null
  meta_description: string | null
  h1: string | null
  canonical: string | null
  published_at: string | null
  modified_at: string | null
  outline_json: string
  faqs_json: string
  h2_count: number
  h3_count: number
  table_count: number
  body_text: string
  word_count: number
  content_hash: string
  summary_json: string | null
  eligibility_json: string | null
}

interface ProfileSql {
  id: string
  page_id: string
  snapshot_id: string
  body_json: string
  template_id: string
  template_name: string
  template_hash: string
  template_updated_at: string | null
  created_at: string
}

const SNAPSHOT_SELECT = `SELECT id, page_id, fetched_at, method, http_status, duration_ms, title,
  meta_description, h1, canonical, published_at, modified_at, outline_json, faqs_json, h2_count,
  h3_count, table_count, body_text, word_count, content_hash, summary_json, eligibility_json
  FROM snapshots`

function normalizeSnapshot(record: StoredSnapshot): StoredSnapshot {
  if (!isPageReadMethod(record.method)) throw new StorageError('Invalid read method')
  if (
    record.httpStatus !== null &&
    (!Number.isInteger(record.httpStatus) || record.httpStatus < 100 || record.httpStatus > 599)
  ) {
    throw new StorageError('Invalid http status')
  }
  return {
    ...record,
    id: assertId(record.id),
    pageId: assertId(record.pageId),
    fetchedAt: requireUtcTimestamp(record.fetchedAt),
    title: requireOptionalLabel(record.title, 'snapshot title', 300),
    metaDescription: requireOptionalLabel(record.metaDescription, 'meta description', 500),
    h1: requireOptionalLabel(record.h1, 'h1', 300),
    canonical: requireOptionalLabel(record.canonical, 'canonical', 2000),
    publishedAt: requireOptionalLabel(record.publishedAt, 'published date', 40),
    modifiedAt: requireOptionalLabel(record.modifiedAt, 'modified date', 40),
    outline: record.outline.map((entry) => ({
      level: isOutlineLevel(entry.level) ? entry.level : fail('Invalid heading'),
      text: requireLabel(entry.text, 'heading', 300),
      table: entry.table === true
    })),
    faqs: record.faqs.map((faq) => ({
      question: requireStoredText(faq.question, 'faq question', 500),
      answer: faq.answer.length === 0 ? '' : requireStoredText(faq.answer, 'faq answer', 5000),
      typo: requireOptionalLabel(faq.typo, 'faq typo', 200)
    })),
    h2Count: requireCount(record.h2Count, 'heading count'),
    h3Count: requireCount(record.h3Count, 'heading count'),
    tableCount: requireCount(record.tableCount, 'table count'),
    bodyText: requireStoredText(record.bodyText, 'page body', 500_000),
    wordCount: requireCount(record.wordCount, 'word count'),
    contentHash: requireContentHash(record.contentHash),
    durationMs: requireDuration(record.durationMs),
    summary: record.summary
  }
}

function snapshotFromSql(row: SnapshotSql): StoredSnapshot {
  if (!isPageReadMethod(row.method)) throw new StorageError('Invalid read method')
  const outline = readJson(row.outline_json, 'outline')
  const faqs = readJson(row.faqs_json, 'faqs')
  if (!Array.isArray(outline) || !Array.isArray(faqs)) throw new StorageError('Invalid outline')
  return {
    id: row.id,
    pageId: row.page_id,
    fetchedAt: row.fetched_at,
    method: row.method,
    httpStatus: row.http_status,
    durationMs: row.duration_ms,
    title: row.title,
    metaDescription: row.meta_description,
    h1: row.h1,
    canonical: row.canonical,
    publishedAt: row.published_at,
    modifiedAt: row.modified_at,
    outline: outline as OutlineEntry[],
    faqs: faqs as PageFaq[],
    h2Count: row.h2_count,
    h3Count: row.h3_count,
    tableCount: row.table_count,
    bodyText: row.body_text,
    wordCount: row.word_count,
    contentHash: row.content_hash,
    summary:
      row.summary_json === null
        ? null
        : (readJson(row.summary_json, 'summary') as PagePromiseSummary),
    eligibility: eligibilityFromSql(row.eligibility_json)
  }
}

function profileBody(profile: BuyerProfile): BuyerProfileBody {
  return {
    who: profile.who,
    environment: profile.environment,
    segments: profile.segments,
    triggers: profile.triggers,
    values: profile.values,
    poorFit: profile.poorFit
  }
}

function profileFromSql(row: ProfileSql, promptsStale: boolean): BuyerProfile {
  const body = readJson(row.body_json, 'buyer profile')
  if (!isRecord(body)) throw new StorageError('Invalid buyer profile')
  return {
    id: row.id,
    pageId: row.page_id,
    snapshotId: row.snapshot_id,
    who: textField(body.who),
    environment: textField(body.environment),
    segments: namedList(body.segments),
    triggers: stringList(body.triggers),
    values: stringList(body.values),
    poorFit: namedList(body.poorFit),
    templateId: row.template_id,
    templateName: row.template_name,
    templateHash: row.template_hash,
    templateUpdatedAt: row.template_updated_at,
    createdAt: row.created_at,
    promptsStale
  }
}

function namedList(value: unknown): NamedReason[] {
  if (!Array.isArray(value)) throw new StorageError('Invalid buyer profile')
  return value.map((item) => {
    if (!isRecord(item)) throw new StorageError('Invalid buyer profile')
    return {
      name: stringField(item.name, 'buyer profile'),
      reason: textField(item.reason)
    }
  })
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new StorageError('Invalid buyer profile')
  }
  return value
}

/**
 * A profile part that may be empty: topics written before the who/environment
 * fallback saved "" there, and a segment's reason is optional. Missing reads as "".
 */
function textField(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new StorageError('Invalid buyer profile')
  return value
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new StorageError(`Invalid ${label}`)
  return value
}

function fail(message: string): never {
  throw new StorageError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
