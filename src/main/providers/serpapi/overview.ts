import { isRecord } from '../json-schema'

/** One `ai_overview.references` entry (section 6.1 step 5). */
export interface AiOverviewReference {
  url: string
  title: string | null
}

/**
 * The one reading of a SerpApi `ai_overview` object, shared by checks and the
 * playground. `error` is SerpApi's own error for the overview (FR-5.5: an error,
 * never "no AIO"). `pageToken` is set when the overview must be fetched with
 * `engine=google_ai_overview`.
 */
export interface ParsedAiOverview {
  text: string | null
  references: readonly AiOverviewReference[]
  pageToken: string | null
  error: string | null
}

/** Null when `value` is not an object, which means the response had no overview. */
export function readAiOverview(value: unknown): ParsedAiOverview | null {
  if (!isRecord(value)) return null
  const snippets: string[] = []
  collectBlock(value, snippets)
  const text = snippets.join(' ').replace(/\s+/g, ' ').trim()
  const references: AiOverviewReference[] = []
  if (Array.isArray(value.references)) {
    for (const reference of value.references) {
      if (!isRecord(reference) || typeof reference.link !== 'string') continue
      references.push({
        url: reference.link,
        title: typeof reference.title === 'string' ? reference.title : null
      })
    }
  }
  const token = typeof value.page_token === 'string' ? value.page_token.trim() : ''
  const error = typeof value.error === 'string' ? value.error.trim() : ''
  return {
    text: text.length === 0 ? null : text,
    references,
    pageToken: token.length === 0 ? null : token,
    error: error.length === 0 ? null : error
  }
}

/** True when the overview has text or references CiteFox can score. */
export function overviewHasContent(overview: ParsedAiOverview): boolean {
  return overview.text !== null || overview.references.length > 0
}

/**
 * Text blocks in reading order: headings, paragraphs, list items (their `title`
 * and `snippet`, nested lists included), expandable sections, tables, and
 * comparison blocks. References are not overview text.
 */
function collectBlock(block: unknown, out: string[]): void {
  if (typeof block === 'string') {
    push(out, block)
    return
  }
  if (!isRecord(block)) return
  push(out, block.title)
  push(out, block.snippet)
  if (Array.isArray(block.list)) {
    for (const item of block.list) collectBlock(item, out)
  }
  if (Array.isArray(block.text_blocks)) {
    for (const child of block.text_blocks) collectBlock(child, out)
  }
  collectTable(block.table, out)
  collectComparison(block, out)
}

function collectTable(table: unknown, out: string[]): void {
  if (!Array.isArray(table)) return
  for (const row of table) {
    if (Array.isArray(row)) push(out, row.filter((cell) => typeof cell === 'string').join(' | '))
    else if (isRecord(row)) push(out, Object.values(row).filter(isText).join(' | '))
  }
}

function collectComparison(block: Record<string, unknown>, out: string[]): void {
  if (Array.isArray(block.product_labels)) {
    push(out, block.product_labels.filter(isText).join(' | '))
  }
  if (!Array.isArray(block.comparison)) return
  for (const row of block.comparison) {
    if (!isRecord(row)) continue
    const values = Array.isArray(row.values) ? row.values.filter(isText) : []
    push(out, [row.feature, ...values].filter(isText).join(' | '))
  }
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function push(out: string[], value: unknown): void {
  if (isText(value)) out.push(value.trim())
}

/** Playground text: the overview, then the titles of the links it cites. */
export function overviewSummary(
  overview: Pick<ParsedAiOverview, 'text' | 'references'>
): string | null {
  const titles = overview.references
    .map((reference) => reference.title?.trim() ?? '')
    .filter((title) => title.length > 0)
  const summary = [overview.text ?? '', ...titles].join(' ').replace(/\s+/g, ' ').trim()
  return summary.length === 0 ? null : summary
}
