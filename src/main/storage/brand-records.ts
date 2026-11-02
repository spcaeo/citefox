import {
  BRAND_FACT_MAX_LENGTH,
  BRAND_PROMPT_MAX_LENGTH,
  MAX_BRAND_FACTS,
  isBrandPromptKind,
  type BrandFact,
  type BrandPrompt,
  type BrandPromptKind
} from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { rejectSecret, runWrite } from './record-values'
import { assertId, requireUtcTimestamp } from './values'

/**
 * `brand_prompts` and `brand_facts` in a project database (FR-16.1, FR-16.6).
 * Brand prompts are versioned per page: a save writes the next version and
 * keeps the old rows, because brand captures point at the row they searched.
 */

export interface StoredBrandPromptSet {
  version: number
  savedAt: string
  templateId: string | null
  templateHash: string | null
  prompts: BrandPrompt[]
}

export interface NewBrandPromptSet {
  pageId: string
  savedAt: string
  templateId: string | null
  templateHash: string | null
  prompts: readonly { id: string; kind: BrandPromptKind; language: string; text: string }[]
}

interface BrandPromptSql {
  id: string
  version: number
  position: number
  kind: string
  language: string
  text: string
  saved_at: string
  template_id: string | null
  template_hash: string | null
}

/** The page's latest brand prompts, by language then position. Null before the first save. */
export function getLatestBrandPromptSet(
  db: SqliteDatabase,
  pageId: string
): StoredBrandPromptSet | null {
  const row = db
    .prepare<unknown[], { version: number | null }>(
      `SELECT MAX(version) AS version FROM brand_prompts WHERE page_id = ?`
    )
    .get(assertId(pageId))
  if (row?.version === null || row?.version === undefined) return null
  const rows = db
    .prepare<unknown[], BrandPromptSql>(
      `SELECT id, version, position, kind, language, text, saved_at, template_id, template_hash
       FROM brand_prompts WHERE page_id = ? AND version = ?
       ORDER BY language ASC, position ASC`
    )
    .all(pageId, row.version)
  const first = rows[0]
  if (first === undefined) return null
  return {
    version: first.version,
    savedAt: first.saved_at,
    templateId: first.template_id,
    templateHash: first.template_hash,
    prompts: rows.map(promptFromSql)
  }
}

/**
 * Saves the next version. Positions restart at 1 in each language.
 * Returns the stored set.
 */
export function insertBrandPromptSet(
  db: SqliteDatabase,
  set: NewBrandPromptSet
): StoredBrandPromptSet {
  const pageId = assertId(set.pageId)
  const savedAt = requireUtcTimestamp(set.savedAt)
  if (set.templateHash !== null && !/^[a-f0-9]{64}$/.test(set.templateHash)) {
    throw new StorageError('Invalid template hash')
  }
  if (set.prompts.length === 0) throw new StorageError('Add at least one brand prompt')
  const write = db.transaction(() => {
    const latest = db
      .prepare<unknown[], { version: number | null }>(
        `SELECT MAX(version) AS version FROM brand_prompts WHERE page_id = ?`
      )
      .get(pageId)
    const version = (latest?.version ?? 0) + 1
    const insert = db.prepare(
      `INSERT INTO brand_prompts (
         id, page_id, version, position, kind, language, text, saved_at, template_id, template_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const positions = new Map<string, number>()
    for (const prompt of set.prompts) {
      const language = requireLanguage(prompt.language)
      const position = (positions.get(language) ?? 0) + 1
      positions.set(language, position)
      insert.run(
        assertId(prompt.id),
        pageId,
        version,
        position,
        requireKind(prompt.kind),
        language,
        requirePromptText(prompt.text),
        savedAt,
        set.templateId,
        set.templateHash
      )
    }
  })
  runWrite(() => write(), 'Could not save brand prompts')
  const saved = getLatestBrandPromptSet(db, pageId)
  if (saved === null) throw new StorageError('Could not save brand prompts')
  return saved
}

/** One stored brand prompt by id, any version. */
export function getBrandPrompt(db: SqliteDatabase, id: string): BrandPrompt | null {
  const row = db
    .prepare<unknown[], BrandPromptSql>(
      `SELECT id, version, position, kind, language, text, saved_at, template_id, template_hash
       FROM brand_prompts WHERE id = ?`
    )
    .get(assertId(id))
  return row === undefined ? null : promptFromSql(row)
}

interface BrandFactSql {
  id: string
  text: string
  source: string | null
  added_at: string
}

/** Oldest first, so the list reads in the order the user added it. */
export function listBrandFacts(db: SqliteDatabase): BrandFact[] {
  return db
    .prepare<unknown[], BrandFactSql>(
      `SELECT id, text, source, added_at FROM brand_facts ORDER BY added_at ASC, rowid ASC`
    )
    .all()
    .map((row) => ({ id: row.id, text: row.text, source: row.source, addedAt: row.added_at }))
}

export function insertBrandFact(db: SqliteDatabase, fact: BrandFact): void {
  const text = requireFactText(fact.text)
  const source = fact.source === null ? null : requireSource(fact.source)
  const count = db.prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM brand_facts`).get()
  if ((count?.n ?? 0) >= MAX_BRAND_FACTS) {
    throw new StorageError(`A project keeps at most ${MAX_BRAND_FACTS} brand facts`)
  }
  runWrite(
    () =>
      db
        .prepare(`INSERT INTO brand_facts (id, text, source, added_at) VALUES (?, ?, ?, ?)`)
        .run(assertId(fact.id), text, source, requireUtcTimestamp(fact.addedAt)),
    'Could not save the brand fact'
  )
}

/** Returns false when no fact had that id. */
export function deleteBrandFact(db: SqliteDatabase, id: string): boolean {
  const result = db.prepare(`DELETE FROM brand_facts WHERE id = ?`).run(assertId(id))
  return result.changes === 1
}

function promptFromSql(row: BrandPromptSql): BrandPrompt {
  if (!isBrandPromptKind(row.kind)) throw new StorageError('Invalid brand prompt kind')
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    language: row.language,
    text: row.text
  }
}

function requireKind(value: string): BrandPromptKind {
  if (!isBrandPromptKind(value)) throw new StorageError('Invalid brand prompt kind')
  return value
}

function requireLanguage(value: string): string {
  const language = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (language.length === 0 || language.length > 20 || !/^[a-z0-9-]+$/.test(language)) {
    throw new StorageError('Invalid brand prompt language')
  }
  return language
}

function requirePromptText(value: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length < 3 || text.length > BRAND_PROMPT_MAX_LENGTH) {
    throw new StorageError('Invalid brand prompt')
  }
  rejectSecret(text, 'brand prompt', false)
  return text
}

function requireFactText(value: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (text.length === 0 || text.length > BRAND_FACT_MAX_LENGTH) {
    throw new StorageError(`A brand fact is 1 to ${BRAND_FACT_MAX_LENGTH} characters`)
  }
  rejectSecret(text, 'brand fact', false)
  return text
}

function requireSource(value: string): string {
  const source = value.trim()
  if (source.length === 0 || source.length > 2000 || source.includes('\0')) {
    throw new StorageError('Invalid brand fact source')
  }
  rejectSecret(source, 'brand fact source', false)
  return source
}
