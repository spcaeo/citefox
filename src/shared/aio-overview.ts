/**
 * Reads SerpApi's `ai_overview` object into typed blocks, so the prompt page
 * can show the overview the way Google laid it out (headings, lists, tables,
 * citations) instead of the flattened `aioText`. Pure: no DOM, no Markdown.
 * Text stays plain text; the renderer escapes it.
 */

/** A run of overview text. `bold` is Google's highlighted words. */
export type AioSegment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export interface AioListItem {
  /** A short lead Google shows bold, such as "Pros" in "Pros: …". No trailing colon. */
  label: string | null
  text: AioSegment[]
  /** `AioSource.index` values this item cites, in Google's order. */
  refs: number[]
  /** Nested lists and blocks under the item. */
  children: AioBlock[]
}

export type AioBlock =
  | { kind: 'heading'; text: AioSegment[] }
  | { kind: 'paragraph'; text: AioSegment[]; refs: number[] }
  | { kind: 'list'; items: AioListItem[] }
  | { kind: 'table'; header: string[]; rows: string[][]; refs: number[] }
  | { kind: 'expandable'; title: string; blocks: AioBlock[] }

/** One `references` entry. */
export interface AioSource {
  /** SerpApi's `index`, which `reference_indexes` point at. */
  index: number
  title: string | null
  /** An http(s) link, or null when the entry had none. */
  url: string | null
  snippet: string | null
  /** Site name Google shows, such as "Example Co". */
  source: string | null
  icon: string | null
  thumbnail: string | null
}

export interface AioOverview {
  blocks: AioBlock[]
  sources: AioSource[]
}

/** The longest lead before a colon that still reads as a label ("How it works"). */
const LABEL_MAX_CHARS = 48
const LABEL_MAX_WORDS = 6

/**
 * The overview from a stored sample: the follow-up body (`rawAioJson`) first,
 * then the overview inside the Google search body. Null when neither has blocks.
 */
export function overviewFromSample(sample: {
  rawAioJson: string | null
  rawSearchJson: string | null
}): AioOverview | null {
  for (const raw of [sample.rawAioJson, sample.rawSearchJson]) {
    const overview = parseAiOverview(parseJson(raw))
    if (overview && overview.blocks.length > 0) return overview
  }
  return null
}

/** Reads a whole SerpApi body (`{ai_overview: …}`) or the overview object itself. */
export function parseAiOverview(value: unknown): AioOverview | null {
  const overview = isRecord(value) && isRecord(value.ai_overview) ? value.ai_overview : value
  if (!isRecord(overview)) return null
  if (!Array.isArray(overview.text_blocks) && !Array.isArray(overview.references)) return null
  const sources = readSources(overview.references)
  const known = new Set(sources.map((source) => source.index))
  return { blocks: readBlocks(overview.text_blocks, known), sources }
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw.trim().length === 0) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function readSources(value: unknown): AioSource[] {
  if (!Array.isArray(value)) return []
  const sources: AioSource[] = []
  const seen = new Set<number>()
  value.forEach((entry, position) => {
    if (!isRecord(entry)) return
    const index = isIndex(entry.index) ? entry.index : position
    if (seen.has(index)) return
    seen.add(index)
    sources.push({
      index,
      title: text(entry.title),
      url: httpUrl(entry.link),
      snippet: text(entry.snippet),
      source: text(entry.source),
      icon: httpUrl(entry.source_icon),
      thumbnail: httpUrl(entry.thumbnail)
    })
  })
  return sources
}

function readBlocks(value: unknown, known: ReadonlySet<number>): AioBlock[] {
  if (!Array.isArray(value)) return []
  const blocks: AioBlock[] = []
  for (const entry of value) blocks.push(...readBlock(entry, known))
  return blocks
}

/** One SerpApi text block, plus any `text_blocks` it nests (except an expandable's own). */
function readBlock(value: unknown, known: ReadonlySet<number>): AioBlock[] {
  if (typeof value === 'string') {
    const snippet = text(value)
    return snippet ? [{ kind: 'paragraph', text: [{ kind: 'text', text: snippet }], refs: [] }] : []
  }
  if (!isRecord(value)) return []
  const type = typeof value.type === 'string' ? value.type : ''
  const refs = readRefs(value.reference_indexes, known)
  const snippet = text(value.snippet)
  const out: AioBlock[] = []

  if (type === 'expandable') {
    const title = text(value.title) ?? snippet ?? 'More'
    const blocks = readBlocks(value.text_blocks, known)
    if (Array.isArray(value.list)) blocks.push(...listBlock(value.list, known))
    return blocks.length > 0 ? [{ kind: 'expandable', title, blocks }] : []
  }
  if (type === 'heading') {
    const heading = snippet ?? text(value.title)
    if (heading) out.push({ kind: 'heading', text: segments(heading, value) })
  } else if (type === 'comparison' || Array.isArray(value.comparison)) {
    const table = comparisonTable(value, refs)
    if (table) out.push(table)
  } else if (type === 'table' || value.table !== undefined || value.detailed !== undefined) {
    if (snippet) out.push({ kind: 'paragraph', text: segments(snippet, value), refs: [] })
    const table = readTable(value, refs)
    if (table) out.push(table)
  } else {
    const title = text(value.title)
    if (title && type !== 'list')
      out.push({ kind: 'heading', text: [{ kind: 'text', text: title }] })
    if (snippet) out.push({ kind: 'paragraph', text: segments(snippet, value), refs })
  }
  if (type !== 'table' && Array.isArray(value.list)) out.push(...listBlock(value.list, known))
  out.push(...readBlocks(value.text_blocks, known))
  return out
}

function listBlock(value: readonly unknown[], known: ReadonlySet<number>): AioBlock[] {
  const items = value
    .map((entry) => readListItem(entry, known))
    .filter((item): item is AioListItem => item !== null)
  return items.length > 0 ? [{ kind: 'list', items }] : []
}

function readListItem(value: unknown, known: ReadonlySet<number>): AioListItem | null {
  if (typeof value === 'string') {
    const snippet = text(value)
    return snippet ? labelled(null, snippet, {}, [], []) : null
  }
  if (!isRecord(value)) return null
  const children: AioBlock[] = []
  if (Array.isArray(value.list)) children.push(...listBlock(value.list, known))
  children.push(...readBlocks(value.text_blocks, known))
  const title = text(value.title)
  const snippet = text(value.snippet)
  const refs = readRefs(value.reference_indexes, known)
  if (!title && !snippet) {
    return children.length > 0 ? { label: null, text: [], refs, children } : null
  }
  return labelled(title ? trimColon(title) : null, snippet ?? '', value, refs, children)
}

/**
 * A list item whose snippet starts "Pros: …" gets "Pros" as its bold label,
 * as Google shows it. An item with its own `title` keeps that as the label.
 */
function labelled(
  title: string | null,
  snippet: string,
  marks: Record<string, unknown>,
  refs: number[],
  children: AioBlock[]
): AioListItem {
  let label = title
  let rest = snippet
  if (label === null) {
    const lead = leadLabel(snippet)
    if (lead) {
      label = lead.label
      rest = lead.rest
    }
  }
  return { label, text: rest ? segments(rest, marks) : [], refs, children }
}

function leadLabel(snippet: string): { label: string; rest: string } | null {
  const match = /^([^:\n]+):\s+(.*)$/s.exec(snippet)
  if (!match) return null
  const label = (match[1] ?? '').trim()
  const words = label.split(/\s+/).length
  if (label.length === 0 || label.length > LABEL_MAX_CHARS || words > LABEL_MAX_WORDS) return null
  if (/[.!?]/.test(label)) return null
  return { label, rest: (match[2] ?? '').trim() }
}

function trimColon(value: string): string {
  return value.replace(/\s*:\s*$/, '')
}

/** A table from `table` (rows of strings), else `detailed` (rows of cells), else `formatted`. */
function readTable(block: Record<string, unknown>, refs: number[]): AioBlock | null {
  const rows =
    stringRows(block.table) ?? stringRows(block.detailed) ?? formattedRows(block.formatted)
  if (!rows || rows.length === 0) return null
  const [header = [], ...body] = rows
  return tableBlock(header, body, refs)
}

function stringRows(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null
  const rows: string[][] = []
  for (const row of value) {
    if (Array.isArray(row)) rows.push(row.map(cellText))
    else if (isRecord(row)) rows.push(Object.values(row).map(cellText))
  }
  return rows.some((row) => row.some((cell) => cell.length > 0)) ? rows : null
}

/** `formatted` as an array of objects: the keys become the header. */
function formattedRows(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null
  const objects = value.filter(isRecord)
  const first = objects[0]
  if (!first) return null
  const keys = Object.keys(first)
  return [keys.map(humanKey), ...objects.map((row) => keys.map((key) => cellText(row[key])))]
}

function comparisonTable(block: Record<string, unknown>, refs: number[]): AioBlock | null {
  if (!Array.isArray(block.comparison)) return null
  const labels = Array.isArray(block.product_labels) ? block.product_labels.map(cellText) : []
  const body: string[][] = []
  for (const row of block.comparison) {
    if (!isRecord(row)) continue
    const values = Array.isArray(row.values) ? row.values.map(cellText) : []
    body.push([cellText(row.feature), ...values])
  }
  if (body.length === 0) return null
  return tableBlock(['', ...labels], body, refs)
}

/** Pads the header and rows to the widest row; rows can carry more cells than the header. */
function tableBlock(header: string[], body: string[][], refs: number[]): AioBlock {
  const width = Math.max(header.length, ...body.map((row) => row.length))
  const pad = (row: string[]): string[] => [...row, ...Array<string>(width - row.length).fill('')]
  return { kind: 'table', header: pad(header), rows: body.map(pad), refs }
}

function cellText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number') return String(value)
  if (isRecord(value)) return cellText(value.snippet ?? value.text ?? value.title)
  return ''
}

function humanKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function readRefs(value: unknown, known: ReadonlySet<number>): number[] {
  if (!Array.isArray(value)) return []
  const refs: number[] = []
  for (const entry of value) {
    if (isIndex(entry) && known.has(entry) && !refs.includes(entry)) refs.push(entry)
  }
  return refs
}

interface Mark {
  start: number
  end: number
  segment: AioSegment
}

/**
 * Splits a snippet into plain, bold, code and link runs from SerpApi's
 * `snippet_links`, `snippet_inline_code` and `snippet_highlighted_words`. Each
 * listed string marks its next unclaimed occurrence; links win over code,
 * code over bold, and marks never overlap.
 */
export function segments(snippet: string, marks: Record<string, unknown>): AioSegment[] {
  const claimed: Mark[] = []
  const claim = (needle: string, make: (found: string) => AioSegment): void => {
    if (needle.length === 0) return
    for (let at = snippet.indexOf(needle); at !== -1; at = snippet.indexOf(needle, at + 1)) {
      const end = at + needle.length
      if (claimed.some((mark) => at < mark.end && end > mark.start)) continue
      claimed.push({ start: at, end, segment: make(snippet.slice(at, end)) })
      return
    }
  }
  if (Array.isArray(marks.snippet_links)) {
    for (const link of marks.snippet_links) {
      if (!isRecord(link)) continue
      const label = text(link.text)
      const href = httpUrl(link.link)
      if (label && href) claim(label, (found) => ({ kind: 'link', text: found, href }))
    }
  }
  for (const code of strings(marks.snippet_inline_code)) {
    claim(code, (found) => ({ kind: 'code', text: found }))
  }
  for (const word of strings(marks.snippet_highlighted_words)) {
    claim(word, (found) => ({ kind: 'bold', text: found }))
  }
  claimed.sort((a, b) => a.start - b.start)
  const out: AioSegment[] = []
  let cursor = 0
  for (const mark of claimed) {
    if (mark.start > cursor) out.push({ kind: 'text', text: snippet.slice(cursor, mark.start) })
    out.push(mark.segment)
    cursor = mark.end
  }
  if (cursor < snippet.length) out.push({ kind: 'text', text: snippet.slice(cursor) })
  return out
}

/** The plain text of some segments, for labels and tests. */
export function segmentsText(parts: readonly AioSegment[]): string {
  return parts.map((part) => part.text).join('')
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
