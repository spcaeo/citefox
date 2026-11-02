import type { ImportCounts, ImportFixKind, ImportResult, ImportRow } from '@shared/ipc'
import { IMPORT_NOUN, type ImportEntity } from '@shared/import-fields'
import { pluralize } from '@shared/pluralize'
import type { ChipTone } from '../ui'

/**
 * Words and small rules of the import steps (ImportMap.dc.html). Pure, so the
 * drawer, Add questions and their tests share them.
 */

export type ImportStep = 'choose' | 'match' | 'check'

export const IMPORT_STEPS: readonly { id: ImportStep; label: string }[] = [
  { id: 'choose', label: 'Choose file' },
  { id: 'match', label: 'Match columns' },
  { id: 'check', label: 'Check rows' }
]

export function isImportStep(value: string | null | undefined): value is ImportStep {
  return value === 'choose' || value === 'match' || value === 'check'
}

/** The result filter on the URL (`import.f`): a result, or all rows. */
export type ImportFilter = ImportResult | 'all'

export function isImportFilter(value: string | null | undefined): value is ImportFilter {
  return (
    value === 'all' ||
    value === 'new' ||
    value === 'keyword' ||
    value === 'similar' ||
    value === 'duplicate' ||
    value === 'fix'
  )
}

export const RESULT_LABEL: Readonly<Record<ImportResult, string>> = {
  new: 'New',
  keyword: 'Keyword',
  similar: 'Similar',
  duplicate: 'Duplicate',
  fix: 'Needs a fix'
}

export const RESULT_TONE: Readonly<Record<ImportResult, ChipTone>> = {
  new: 'ok',
  keyword: 'info',
  similar: 'warn',
  duplicate: 'bad',
  fix: 'bad'
}

const FIX_LABEL: Readonly<Record<ImportFixKind, string>> = {
  empty: 'No question',
  stage: 'Stage unknown',
  // Not set up in the project, or not checked in the page or topic the row goes to.
  market: 'Market not set',
  page: 'Another site',
  topic: 'No such topic',
  brand: 'Names your brand',
  long: 'Too long',
  short: 'Too short',
  invalid: 'Not valid',
  limit: 'No room'
}

/** The pill a row shows: its result, or for a row that needs a fix, what to fix. */
export function resultPill(row: Pick<ImportRow, 'result' | 'fix'>): {
  label: string
  tone: ChipTone
} {
  if (row.result === 'fix' && row.fix !== null) return { label: FIX_LABEL[row.fix], tone: 'bad' }
  return { label: RESULT_LABEL[row.result], tone: RESULT_TONE[row.result] }
}

/** Rows that are added: new questions and keywords. */
export function addCount(counts: Pick<ImportCounts, 'new' | 'keyword'>): number {
  return counts.new + counts.keyword
}

/**
 * The footer's first line, counts that add up to the file:
 * "100 to add · 4 duplicates skipped · 2 similar merged · 5 to decide · 3 need a fix".
 * Near duplicates merged (a year, an article or a plural apart) are counted on their own.
 */
export function summaryParts(counts: ImportCounts): string[] {
  const parts = [`${addCount(counts).toLocaleString('en-US')} to add`]
  const merged = Math.min(counts.merged ?? 0, counts.duplicate)
  const exact = counts.duplicate - merged
  if (exact > 0) parts.push(`${pluralize(exact, 'duplicate')} skipped`)
  if (merged > 0) parts.push(`${merged.toLocaleString('en-US')} similar merged`)
  if (counts.similar > 0) parts.push(`${counts.similar.toLocaleString('en-US')} to decide`)
  if (counts.fix > 0) {
    parts.push(`${counts.fix.toLocaleString('en-US')} ${counts.fix === 1 ? 'needs' : 'need'} a fix`)
  }
  return parts
}

/** "questions", "competitors". */
export function nounOf(entity: ImportEntity, count = 2): string {
  const [one, many] = IMPORT_NOUN[entity]
  return count === 1 ? one : many
}

/** "Import questions from a file". */
export function importHeading(entity: ImportEntity): string {
  return `Import ${nounOf(entity)} from a file`
}

/** Bytes as "84 KB" or "2.4 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A dropped file's bytes as base64 (what `import:read` takes; never a path). */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk))
  }
  return btoa(binary)
}

/** The rows a filter shows. */
export function filterRows(rows: readonly ImportRow[], filter: ImportFilter): readonly ImportRow[] {
  return filter === 'all' ? rows : rows.filter((row) => row.result === filter)
}

/** Market codes as "CA and GB". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}
