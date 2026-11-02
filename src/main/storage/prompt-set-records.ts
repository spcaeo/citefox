import {
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  isIntentStage,
  isPromptSource
} from '@shared/domain'
import type { BuyerPrompt, PromptSetRef, PromptSetView, PromptVariant } from '@shared/domain'
import type { SqliteDatabase } from './database'
import { StorageError } from './errors'
import { recordQuestionChanges } from './tracking-changes'
import { getStoredPage, listPageMarkets, type StoredPage } from './pages'
import {
  assertId,
  requireContentHash,
  requireLabel,
  requireStoredText,
  requireUtcTimestamp
} from './values'

/** `prompt_sets`, `prompts`, and `prompt_variants` rows in a project database. */

export interface NewPromptSet {
  id: string
  pageId: string
  version: number
  savedAt: string
  icpId: string
  templateId: string | null
  templateName: string | null
  templateHash: string | null
  templateUpdatedAt: string | null
  prompts: readonly BuyerPrompt[]
}

export function insertPromptSet(
  db: SqliteDatabase,
  record: NewPromptSet,
  brands: readonly string[]
): PromptSetView {
  const id = assertId(record.id)
  const pageId = assertId(record.pageId)
  const page = getStoredPage(db, pageId)
  if (page === null) throw new StorageError('Could not save prompt set')
  const icpId = assertId(record.icpId)
  const savedAt = requireUtcTimestamp(record.savedAt)
  if (!Number.isInteger(record.version) || record.version < 1) {
    throw new StorageError('Invalid prompt set version')
  }
  const template = normalizeTemplateLink(
    record.templateId,
    record.templateName,
    record.templateHash,
    record.templateUpdatedAt
  )
  const prompts = record.prompts.map((prompt) => normalizePrompt(prompt))
  if (prompts.length === 0) throw new StorageError('Invalid prompt set')
  const positions = new Set(prompts.map((prompt) => prompt.position))
  if (positions.size !== prompts.length) throw new StorageError('Invalid prompt position')
  const before = activeQuestionTexts(db, pageId)
  const write = db.transaction(() => {
    db.prepare(`UPDATE prompt_sets SET is_active = 0 WHERE page_id = ?`).run(pageId)
    db.prepare(
      `INSERT INTO prompt_sets (
         id, page_id, version, saved_at, icp_id, template_id, template_name, template_hash,
         template_updated_at, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      id,
      pageId,
      record.version,
      savedAt,
      icpId,
      template.templateId,
      template.templateName,
      template.templateHash,
      template.templateUpdatedAt
    )
    const insertPrompt = db.prepare(
      `INSERT INTO prompts (
         id, prompt_set_id, position, label, source, intent_stage, mapped_element, enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertVariant = db.prepare(
      `INSERT INTO prompt_variants (prompt_id, market_id, language, text, original_text)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const prompt of prompts) {
      insertPrompt.run(
        prompt.id,
        id,
        prompt.position,
        prompt.label,
        prompt.source,
        prompt.intentStage,
        prompt.mappedElement,
        prompt.enabled ? 1 : 0
      )
      for (const variant of prompt.variants) {
        insertVariant.run(
          prompt.id,
          variant.marketId,
          variant.language,
          variant.text,
          variant.originalText
        )
      }
    }
  })
  try {
    write()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Could not save prompt set')
  }
  recordQuestionChanges(
    db,
    pageId,
    before,
    prompts
      .filter((prompt) => prompt.enabled)
      .map((prompt) => prompt.variants[0]?.text ?? prompt.label),
    savedAt
  )
  return promptSetView(
    db,
    page,
    {
      id,
      version: record.version,
      savedAt,
      icpId,
      templateId: template.templateId,
      templateName: template.templateName,
      templateHash: template.templateHash,
      templateUpdatedAt: template.templateUpdatedAt,
      prompts
    },
    brands
  )
}

/** The active prompt set for the page. */
export function getLatestPromptSet(
  db: SqliteDatabase,
  pageId: string,
  brands: readonly string[]
): PromptSetView | null {
  return readPromptSet(db, pageId, brands, null)
}

/** Saved sets, newest `saved_at` first. */
export function listSavedPromptSets(db: SqliteDatabase, pageId: string): PromptSetRef[] {
  assertId(pageId)
  const rows = db
    .prepare<unknown[], PromptSetRefSql>(
      `SELECT prompt_sets.id, prompt_sets.saved_at, prompt_sets.template_id, prompt_sets.template_name,
              (
                SELECT COUNT(*) FROM prompts WHERE prompts.prompt_set_id = prompt_sets.id
              ) AS prompt_count,
              prompt_sets.is_active
       FROM prompt_sets
       WHERE prompt_sets.page_id = ?
       ORDER BY prompt_sets.saved_at DESC, prompt_sets.rowid DESC`
    )
    .all(pageId)
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.saved_at,
    templateId: row.template_id,
    templateName: row.template_name,
    promptCount: row.prompt_count,
    isActive: row.is_active === 1
  }))
}

/**
 * Makes this saved set the only active one. Does not insert a row.
 * Returns null when that id is not a saved set on the page.
 */
export function activatePromptSet(
  db: SqliteDatabase,
  pageId: string,
  promptSetId: string,
  brands: readonly string[],
  now: string = new Date().toISOString()
): PromptSetView | null {
  assertId(pageId)
  const id = assertId(promptSetId)
  const found = db
    .prepare<unknown[], { id: string }>(`SELECT id FROM prompt_sets WHERE id = ? AND page_id = ?`)
    .get(id, pageId)
  if (found === undefined) return null
  const before = activeQuestionTexts(db, pageId)
  db.transaction(() => {
    db.prepare(`UPDATE prompt_sets SET is_active = 0 WHERE page_id = ?`).run(pageId)
    db.prepare(`UPDATE prompt_sets SET is_active = 1 WHERE id = ?`).run(id)
  })()
  recordQuestionChanges(db, pageId, before, activeQuestionTexts(db, pageId), now)
  return readPromptSet(db, pageId, brands, null)
}

/**
 * The questions that are on in the page's active set, by their wording (each set
 * has its own prompt ids), for the charts' tracking markers.
 */
function activeQuestionTexts(db: SqliteDatabase, pageId: string): string[] {
  return db
    .prepare<unknown[], { text: string }>(
      `SELECT COALESCE(
         (SELECT text FROM prompt_variants WHERE prompt_id = prompts.id ORDER BY rowid LIMIT 1),
         prompts.label
       ) AS text
       FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
       WHERE prompt_sets.page_id = ? AND prompt_sets.is_active = 1 AND prompts.enabled = 1`
    )
    .all(pageId)
    .map((row) => row.text)
}

export function getPromptSetVersion(
  db: SqliteDatabase,
  pageId: string,
  version: number,
  brands: readonly string[]
): PromptSetView | null {
  return readPromptSet(db, pageId, brands, version)
}

export function nextPromptSetVersion(db: SqliteDatabase, pageId: string): number {
  assertId(pageId)
  const row = db
    .prepare<unknown[], { version: number }>(
      `SELECT version FROM prompt_sets WHERE page_id = ? ORDER BY version DESC LIMIT 1`
    )
    .get(pageId)
  return row === undefined ? 1 : row.version + 1
}

function normalizePrompt(prompt: BuyerPrompt): BuyerPrompt {
  if (!isPromptSource(prompt.source)) throw new StorageError('Invalid prompt source')
  if (!isIntentStage(prompt.intentStage)) throw new StorageError('Invalid intent stage')
  if (!Number.isInteger(prompt.position) || prompt.position < 1) {
    throw new StorageError('Invalid prompt position')
  }
  if (prompt.variants.length === 0) throw new StorageError('Invalid prompt variant')
  const seen = new Set<string>()
  return {
    id: assertId(prompt.id),
    position: prompt.position,
    label: requireLabel(prompt.label, 'prompt label', 160),
    source: prompt.source,
    intentStage: prompt.intentStage,
    mappedElement: requireLabel(prompt.mappedElement, 'mapped element', 300),
    enabled: prompt.enabled,
    variants: prompt.variants.map((variant) => normalizeVariant(variant, seen))
  }
}

function normalizeVariant(variant: PromptVariant, seen: Set<string>): PromptVariant {
  const marketId = assertId(variant.marketId)
  if (seen.has(marketId)) throw new StorageError('Invalid prompt variant')
  seen.add(marketId)
  return {
    marketId,
    language: requireLabel(variant.language, 'language', 40),
    text: requireStoredText(variant.text, 'prompt text', 2000),
    originalText:
      variant.originalText === null
        ? null
        : requireStoredText(variant.originalText, 'prompt text', 2000)
  }
}

function normalizeTemplateLink(
  templateId: string | null,
  templateName: string | null,
  templateHash: string | null,
  templateUpdatedAt: string | null
): {
  templateId: string | null
  templateName: string | null
  templateHash: string | null
  templateUpdatedAt: string | null
} {
  if (templateId === null || templateHash === null || templateName === null) {
    return { templateId: null, templateName: null, templateHash: null, templateUpdatedAt: null }
  }
  return {
    templateId: assertId(templateId),
    templateName: requireLabel(templateName, 'template name', 80),
    templateHash: requireContentHash(templateHash),
    templateUpdatedAt: templateUpdatedAt === null ? null : requireUtcTimestamp(templateUpdatedAt)
  }
}

function readPromptSet(
  db: SqliteDatabase,
  pageId: string,
  brands: readonly string[],
  version: number | null
): PromptSetView | null {
  assertId(pageId)
  const page = getStoredPage(db, pageId)
  if (page === null) return null
  const row =
    version === null
      ? db
          .prepare<unknown[], SetSql>(
            `SELECT id, version, saved_at, icp_id, template_id, template_name, template_hash,
                    template_updated_at
             FROM prompt_sets WHERE page_id = ? AND is_active = 1`
          )
          .get(pageId)
      : db
          .prepare<unknown[], SetSql>(
            `SELECT id, version, saved_at, icp_id, template_id, template_name, template_hash,
                    template_updated_at
             FROM prompt_sets WHERE page_id = ? AND version = ?`
          )
          .get(pageId, version)
  if (row === undefined) return null
  const prompts = loadPrompts(db, row.id)
  return promptSetView(
    db,
    page,
    {
      id: row.id,
      version: row.version,
      savedAt: row.saved_at,
      icpId: row.icp_id,
      templateId: row.template_id,
      templateName: row.template_name,
      templateHash: row.template_hash,
      templateUpdatedAt: row.template_updated_at,
      prompts
    },
    brands
  )
}

interface PromptSetRefSql {
  id: string
  saved_at: string
  template_id: string | null
  template_name: string | null
  prompt_count: number
  is_active: number
}

interface SetSql {
  id: string
  version: number
  saved_at: string
  icp_id: string
  template_id: string | null
  template_name: string | null
  template_hash: string | null
  template_updated_at: string | null
}

function loadPrompts(db: SqliteDatabase, promptSetId: string): BuyerPrompt[] {
  const prompts = db
    .prepare<unknown[], PromptSql>(
      `SELECT id, position, label, source, intent_stage, mapped_element, enabled
       FROM prompts WHERE prompt_set_id = ? ORDER BY position ASC`
    )
    .all(promptSetId)
  const variants = db
    .prepare<unknown[], VariantSql>(
      `SELECT prompt_variants.prompt_id, prompt_variants.market_id, prompt_variants.language,
              prompt_variants.text, prompt_variants.original_text
       FROM prompt_variants
       JOIN prompts ON prompts.id = prompt_variants.prompt_id
       WHERE prompts.prompt_set_id = ?`
    )
    .all(promptSetId)
  return prompts.map((prompt) => {
    if (!isPromptSource(prompt.source) || !isIntentStage(prompt.intent_stage)) {
      throw new StorageError('Invalid prompt source')
    }
    return {
      id: prompt.id,
      position: prompt.position,
      label: prompt.label,
      source: prompt.source,
      intentStage: prompt.intent_stage,
      mappedElement: prompt.mapped_element,
      enabled: prompt.enabled === 1,
      variants: variants
        .filter((variant) => variant.prompt_id === prompt.id)
        .map((variant) => ({
          marketId: variant.market_id,
          language: variant.language,
          text: variant.text,
          originalText: variant.original_text
        }))
    }
  })
}

interface PromptSql {
  id: string
  position: number
  label: string
  source: string
  intent_stage: string
  mapped_element: string
  enabled: number
}

interface VariantSql {
  prompt_id: string
  market_id: string
  language: string
  text: string
  original_text: string | null
}

function promptSetView(
  db: SqliteDatabase,
  page: StoredPage,
  set: {
    id: string
    version: number
    savedAt: string
    icpId: string
    templateId: string | null
    templateName: string | null
    templateHash: string | null
    templateUpdatedAt: string | null
    prompts: readonly BuyerPrompt[]
  },
  brands: readonly string[]
): PromptSetView {
  const enabled = set.prompts.filter((prompt) => prompt.enabled).length
  const markets = listPageMarkets(db, page.id).length
  const samples = page.samples
  const brandsClear = set.prompts.every((prompt) =>
    prompt.variants.every((variant) => brandIn(variant.text, brands) === null)
  )
  const names = brands.length === 0 ? 'a brand name' : brands.join(' or ')
  return {
    pageId: page.id,
    promptSetId: set.id,
    version: set.version,
    savedAt: set.savedAt,
    icpId: set.icpId,
    templateId: set.templateId,
    templateName: set.templateName,
    templateHash: set.templateHash,
    templateUpdatedAt: set.templateUpdatedAt,
    dirty: false,
    nextVersion: null,
    prompts: set.prompts,
    brandsClear,
    brandMessage: brandsClear ? `No question contains ${names}.` : `A question contains ${names}.`,
    nextCheck: {
      prompts: enabled,
      markets,
      samples,
      minSearches: enabled * markets * samples * SEARCHES_PER_PROMPT_MIN,
      maxSearches: enabled * markets * samples * SEARCHES_PER_PROMPT_MAX
    }
  }
}

function brandIn(text: string, brands: readonly string[]): string | null {
  const haystack = text.toLowerCase()
  for (const brand of brands) {
    const needle = brand.trim().toLowerCase()
    if (needle.length > 0 && haystack.includes(needle)) return brand
  }
  return null
}
