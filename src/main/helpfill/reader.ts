import { foldWord, IMPORT_FIELDS } from '@shared/import-fields'
import { parseRecords, parseRows, sniffDelimiter, stripBom, type Delimiter } from '../import/csv'
import { buildTable, guessMapping } from '../import/table'
import { straightenQuotes } from './quotes'
import type { HelpFillDraftRow, HelpFillSection } from './types'

/**
 * Reads a chatbot's answer into rows (Docs/HELPFILL.md). The answer may be CSV,
 * TSV, semicolon or pipe text, a markdown table, a fenced code block, a plain
 * list (numbered, bulleted or one per line), or several `### SECTION` blocks,
 * with the chatbot's own words around it ("Sure! Here are 15…", "Let me know…").
 * Fields wrapped in typographic quotes (“ ”, or ” ”) read as quoted CSV fields.
 * A table beats a list: when any part of a section holds a table, its lists
 * (notes, sources) are left out. Pure: no database, no clock.
 */

export interface ReadReply {
  rows: HelpFillDraftRow[]
  warnings: string[]
}

interface Chunk {
  title: string | null
  body: string
}

interface Parsed {
  kind: 'table' | 'list' | 'none'
  rows: Record<string, string>[]
}

export const NO_ANSWER =
  'No table or list was found in the answer. Paste the whole reply, or ask the chatbot for CSV.'

export function readReply(text: string, sections: readonly HelpFillSection[]): ReadReply {
  const clean = stripBom(text).replace(/\r\n?/gu, '\n')
  const chunks = splitChunks(clean, sections)
  const rows: HelpFillDraftRow[] = []
  const warnings: string[] = []
  const single = sections.length === 1
  for (const section of sections) {
    const own = single
      ? chunks
      : chunks.filter(
          (chunk) => chunk.title !== null && sectionOf(chunk.title, sections) === section
        )
    const parsed = own.flatMap((chunk) =>
      pieces(chunk.body).map((piece) => parsePiece(piece, section))
    )
    const tables = parsed.filter((item) => item.kind === 'table')
    const chosen = tables.length > 0 ? tables : parsed.filter((item) => item.kind === 'list')
    const found = chosen.flatMap((item) => item.rows)
    for (const values of found) rows.push({ section: single ? null : section.id, values })
    if (!single && found.length === 0) {
      warnings.push(`No ${section.title ?? section.id} section was found in the answer.`)
    }
  }
  if (rows.length === 0 && (single || warnings.length === sections.length)) {
    return { rows, warnings: [NO_ANSWER] }
  }
  return { rows, warnings }
}

// ---------------------------------------------------------------------------
// Sections and pieces
// ---------------------------------------------------------------------------

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u

/**
 * Splits at markdown headings, and (for multi-section kinds) at a line that is only
 * a section's name ("**PRODUCTS**", "Products:"). Headings inside a code fence stay.
 */
function splitChunks(text: string, sections: readonly HelpFillSection[]): Chunk[] {
  const chunks: Chunk[] = []
  let current: Chunk = { title: null, body: '' }
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/u.test(line)) fenced = !fenced
    const title = fenced ? null : headingOf(line, sections)
    if (title !== null) {
      chunks.push(current)
      current = { title, body: '' }
    } else {
      current.body += `${line}\n`
    }
  }
  chunks.push(current)
  return chunks.filter((chunk) => chunk.body.trim().length > 0)
}

function headingOf(line: string, sections: readonly HelpFillSection[]): string | null {
  const heading = HEADING.exec(line)
  if (heading?.[1] !== undefined) return stripMarkdown(heading[1])
  if (sections.length < 2) return null
  const bare = stripMarkdown(line).replace(/:$/u, '').trim()
  if (bare.length === 0 || bare.length > 40) return null
  // A CSV header ("question,stage,product") names columns, not a section.
  if (/[,\t;|]/u.test(bare)) return null
  return sectionOf(bare, sections) === null ? null : bare
}

function sectionOf(title: string, sections: readonly HelpFillSection[]): HelpFillSection | null {
  const folded = foldWord(title)
  if (folded.length === 0) return null
  return (
    sections.find((section) => {
      const names = [section.id, section.title ?? '', ...(section.synonyms ?? [])]
        .map(foldWord)
        .filter((name) => name.length > 0)
      return names.some(
        (name) =>
          folded === name || folded.split(' ').includes(name) || folded.startsWith(`${name} `)
      )
    }) ?? null
  )
}

/** A chunk's fenced blocks and the text around them, each read on its own. */
function pieces(body: string): string[] {
  const out: string[] = []
  const outside: string[] = []
  let inside: string[] | null = null
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/u.test(line)) {
      if (inside === null) inside = []
      else {
        out.push(inside.join('\n'))
        inside = null
      }
      continue
    }
    if (inside !== null) inside.push(line)
    else outside.push(line)
  }
  // An unclosed fence: its lines are still the answer.
  if (inside !== null) out.push(inside.join('\n'))
  out.push(outside.join('\n'))
  return out.filter((piece) => piece.trim().length > 0)
}

// ---------------------------------------------------------------------------
// One piece: a markdown table, delimited text or a list
// ---------------------------------------------------------------------------

function parsePiece(text: string, section: HelpFillSection): Parsed {
  return markdownTable(text, section) ?? delimited(text, section) ?? list(text, section)
}

const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/u

function markdownTable(text: string, section: HelpFillSection): Parsed | null {
  const lines = text.split('\n').map((line) => line.trim())
  const ruleAt = lines.findIndex((line, index) => index > 0 && TABLE_RULE.test(line))
  if (ruleAt < 1) return null
  const headLine = lines[ruleAt - 1] ?? ''
  if (!headLine.includes('|')) return null
  const body: string[][] = []
  for (const line of lines.slice(ruleAt + 1)) {
    if (!line.includes('|')) break
    if (TABLE_RULE.test(line)) continue
    body.push(tableCells(line))
  }
  const rows = mapRows(tableCells(headLine), body, section)
  return rows.length === 0 ? null : { kind: 'table', rows }
}

function tableCells(line: string): string[] {
  return line
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.replace(/\\\|/gu, '|'))
}

const DELIMITERS: readonly Delimiter[] = [',', '\t', ';', '|']

/**
 * CSV, TSV, semicolon or pipe text. With a header row (its cells name the reply's
 * columns), the rows are the lines under it up to the first blank line. Without
 * one, lines that split evenly are a table matched by their values.
 */
function delimited(text: string, section: HelpFillSection): Parsed | null {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    for (const delimiter of DELIMITERS) {
      if (!line.includes(delimiter)) continue
      const cells = parseRows(straightenQuotes(line, delimiter), { delimiter })[0] ?? []
      if (cells.length < 2 || !isHeader(cells, section)) continue
      const block: string[] = []
      for (const next of lines.slice(index + 1)) {
        if (next.trim().length === 0) {
          if (block.length > 0) break
          continue
        }
        block.push(straightenQuotes(next, delimiter))
      }
      // Cells keep their spaces until rejoined: a space after a comma marks prose.
      const body = parseRecords(block.join('\n'), { delimiter })
        .map((record) =>
          (delimiter === ',' ? rejoinCells(record.cells, cells) : record.cells).map((cell) =>
            cell.trim()
          )
        )
        .filter((row) => !(row.length === 1 && cells.length > 1 && isChatter(row[0] ?? '')))
      const rows = mapRows(cells, body, section)
      if (rows.length > 0) return { kind: 'table', rows }
    }
  }
  // A one-column header ("question") over one item per line.
  const headAt = lines.findIndex((line) => isHeader([line], section) && line.trim().length > 0)
  if (headAt >= 0) {
    const items = lines
      .slice(headAt + 1)
      .filter((line) => line.trim().length > 0 && !isChatter(line))
    const rows = mapRows(
      [lines[headAt] ?? ''],
      items.map((item) => [item]),
      section
    )
    if (rows.length > 0) return { kind: 'table', rows }
  }
  return headerless(lines, section)
}

/**
 * An unquoted number with a thousands comma ("1,000+ employees", "200-2,000") split a
 * row into one cell too many: the two halves are joined again while the row is too wide.
 */
export function rejoinThousands(row: readonly string[], width: number): string[] {
  const out = [...row]
  let index = 0
  while (out.length > width && index < out.length - 1) {
    const left = out[index] ?? ''
    const right = out[index + 1] ?? ''
    if (/\d$/u.test(left) && /^\d{3}(?!\d)/u.test(right)) {
      out.splice(index, 2, `${left},${right}`)
      continue
    }
    index += 1
  }
  return out
}

/** Header words of columns that hold one short value (a stage, a path, a domain). */
const SHORT_COLUMN =
  /^(?:stage|shape|kind|tier|type|tag|page|url|link|path|domain|website|site|source|priority|status|intent)$/u

/** Most extra cells a row may have before it is left as it is (a broken reply). */
const MAX_EXTRA = 8

/**
 * A free-text cell with an unquoted comma ("cards, rewards, and sync") split a row into
 * more cells than its header has. Every way of folding the extra cells back into the
 * columns is scored, and the best one wins: a folded piece that starts with a space
 * (prose after a comma) or a thousands group counts for it; folding into a short
 * column (stage, page, domain…) and leaving a short column holding a sentence count
 * against it. Rows that already fit are returned as they are.
 */
export function rejoinCells(row: readonly string[], header: readonly string[]): string[] {
  const width = header.length
  const first = rejoinThousands(row, width)
  const extra = first.length - width
  if (extra <= 0 || width < 1 || extra > MAX_EXTRA) return first
  const short = header.map((cell) => SHORT_COLUMN.test(foldWord(cell).replace(/\s+/gu, '')))
  let best: string[] = first
  let bestScore = Number.NEGATIVE_INFINITY
  for (const spread of spreads(extra, width)) {
    const cells: string[] = []
    let at = 0
    let score = 0
    spread.forEach((more, column) => {
      const parts = first.slice(at, at + more + 1)
      at += more + 1
      parts.slice(1).forEach((part, index) => {
        if (/^\s/u.test(part)) score += 3
        else if (/\d$/u.test(parts[index] ?? '') && /^\d{3}(?!\d)/u.test(part)) score += 3
        else score -= 1
        if (short[column] === true) score -= 4
      })
      const value = parts.join(',')
      if (short[column] === true && value.trim().split(/\s+/u).length > 3) score -= 2
      cells.push(value)
    })
    if (score > bestScore) {
      best = cells
      bestScore = score
    }
  }
  return best
}

/** Every way to hand `extra` more cells to `width` columns, first columns first. */
function spreads(extra: number, width: number): number[][] {
  if (width === 1) return [[extra]]
  const out: number[][] = []
  for (let here = extra; here >= 0; here -= 1) {
    for (const rest of spreads(extra - here, width - 1)) out.push([here, ...rest])
  }
  return out
}

/** Lines that split evenly into two or more cells, read without a header. */
function headerless(lines: readonly string[], section: HelpFillSection): Parsed | null {
  if (section.columns.length < 2) return null
  const kept = lines.filter((line) => line.trim().length > 0 && !isChatter(line))
  // A numbered or bulleted list is a list, even when its items hold commas.
  if (kept.length < 2 || kept.filter((line) => LIST_MARK.test(line)).length >= 2) return null
  const delimiter = headerlessDelimiter(kept)
  if (delimiter === null) return null
  const raw = parseRows(kept.map((line) => straightenQuotes(line, delimiter)).join('\n'), {
    delimiter
  })
  const widths = raw.map((row) => row.length)
  const mode = mostCommon(widths)
  // Every line (or nearly) splits into the same two or more cells.
  if (mode < 2 || widths.filter((width) => width === mode).length * 5 < raw.length * 4) return null
  const rows = mapRows(null, raw, section)
  return rows.length === 0 ? null : { kind: 'table', rows }
}

/** The delimiter that splits the lines evenly once typographic field quotes are plain. */
function headerlessDelimiter(lines: readonly string[]): Delimiter | null {
  for (const delimiter of SNIFF_ORDER) {
    const straight = lines.map((line) => straightenQuotes(line, delimiter)).join('\n')
    if (sniffDelimiter(straight) === delimiter) return delimiter
  }
  return sniffDelimiter(lines.join('\n'))
}

/** `sniffDelimiter`'s own order: a tab wins a tie (a sheet paste). */
const SNIFF_ORDER: readonly Delimiter[] = ['\t', ',', ';', '|']

const LIST_MARK = /^\s*(?:[-*•‣▪◦]|\d{1,3}[.)]|[a-z][.)])\s+/u

/** One item per line; when some lines are list items, only those count. */
function list(text: string, section: HelpFillSection): Parsed {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const marked = lines.filter((line) => LIST_MARK.test(line))
  const items = (marked.length >= 2 ? marked : lines).filter((line) => !isChatter(line))
  // One bare sentence is the chatbot talking, not a list.
  if (marked.length < 2 && items.length < 2) return { kind: 'none', rows: [] }
  const main = section.columns[0] ?? 'text'
  const rows = items
    .map((line) => cleanCell(line))
    .filter((value) => value.length > 0 && !isUrlOnly(value) && !isHeader([value], section))
    .map((value) => ({ [main]: value }))
  return { kind: rows.length === 0 ? 'none' : 'list', rows }
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Folded header words for each reply column: its id, its IMPORT_FIELDS label and synonyms. */
function columnWords(section: HelpFillSection): Map<string, string[]> {
  const fields = section.entity === null ? [] : IMPORT_FIELDS[section.entity]
  return new Map(
    section.columns.map((column) => {
      const field = fields.find((item) => item.id === (section.fields?.[column] ?? column))
      const words = [foldWord(column), foldWord(column.replace(/[_-]+/gu, ' '))]
      if (field !== undefined) words.push(foldWord(field.label), ...field.synonyms)
      return [column, [...new Set(words.filter((word) => word.length > 0))]]
    })
  )
}

function headerColumn(cell: string, words: Map<string, string[]>): string | null {
  const folded = foldWord(stripMarkdown(cell))
  if (folded.length === 0) return null
  for (const [column, names] of words) if (names.includes(folded)) return column
  return null
}

/** True when at least half of the non-empty cells name a reply column (and one does). */
function isHeader(cells: readonly string[], section: HelpFillSection): boolean {
  const words = columnWords(section)
  const filled = cells.filter((cell) => cell.trim().length > 0)
  if (filled.length === 0) return false
  const named = filled.filter((cell) => headerColumn(cell, words) !== null).length
  return named > 0 && named * 2 >= filled.length
}

/**
 * Rows as values by reply column. A header names the columns (its own words first,
 * then IMPORT_FIELDS through `guessMapping`); without one, the columns are guessed
 * from the values (URLs are pages, stage words are stages), else taken in order.
 */
function mapRows(
  header: readonly string[] | null,
  body: readonly (readonly string[])[],
  section: HelpFillSection
): Record<string, string>[] {
  if (body.length === 0) return []
  const width = Math.max(header?.length ?? 0, ...body.map((row) => row.length))
  const words = columnWords(section)
  const mapping: (string | null)[] = Array.from({ length: width }, (_, index) =>
    header === null ? null : headerColumn(header[index] ?? '', words)
  )
  if (section.entity !== null) {
    const raw = header === null ? body : [header, ...body]
    const guessed = guessMapping(
      buildTable(
        raw.map((row) => row.map(cleanCell)),
        header !== null
      ),
      section.entity
    )
    const columnOf = (field: string): string =>
      Object.entries(section.fields ?? {}).find(([, id]) => id === field)?.[0] ?? field
    guessed.forEach((guess, index) => {
      const field = guess === null ? null : columnOf(guess)
      if (mapping[index] !== null || field === null || !section.columns.includes(field)) return
      if (mapping.includes(field)) return
      mapping[index] = field
    })
  }
  if (header === null && !mapping.some((field) => field !== null)) {
    section.columns.forEach((column, index) => {
      if (index < width) mapping[index] = column
    })
  }
  const main = section.columns[0] ?? ''
  if (!mapping.includes(main)) {
    // The main value is the first column nobody claimed.
    const free = mapping.findIndex((field) => field === null)
    if (free >= 0) mapping[free] = main
  }
  const rows: Record<string, string>[] = []
  for (const cells of body) {
    const values: Record<string, string> = {}
    mapping.forEach((field, index) => {
      if (field === null) return
      const value = cleanCell(cells[index] ?? '')
      if (value.length > 0 && values[field] === undefined) values[field] = value
    })
    const head = values[main] ?? ''
    if (head.length === 0 || headerColumn(head, words) === main) continue
    rows.push(values)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Cells and chatter
// ---------------------------------------------------------------------------

function stripMarkdown(text: string): string {
  return text
    .replace(
      /\[([^\]]*)\]\(([^)\s]*)\)/gu,
      (_, label: string, href: string) => label.trim() || href
    )
    .replace(/(\*\*|__)(.+?)\1/gu, '$2')
    .replace(/(^|[^\p{L}\p{N}*])\*(?!\s)([^*]+?)\*(?![\p{L}\p{N}])/gu, '$1$2')
    .replace(/`+([^`]*)`+/gu, '$1')
    .replace(/\*\*/gu, '')
    .trim()
}

/** A cell without markdown, citation marks, list numbering or wrapping quotes. */
export function cleanCell(value: string): string {
  let text = stripMarkdown(value.replace(/\s+/gu, ' '))
    .replace(/\s*(?:\[\d{1,3}\])+/gu, '')
    .replace(/\s*【[^】]*】/gu, '')
    .replace(/[¹²³⁰-⁹]+/gu, '')
    .replace(LIST_MARK, '')
    .trim()
  const quoted = /^["“”'‘’](.*)["“”'‘’]$/u.exec(text)
  if (quoted?.[1] !== undefined) text = quoted[1].trim()
  return text
}

const CHATTER =
  /^(?:sure|certainly|of course|absolutely|great|happy to|here(?:'s| is| are)|below (?:is|are)|i(?:'ve| have| hope| can)|hope (?:this|that)|let me know|feel free|would you like|if you(?:'d)? like|want me to|these (?:are|questions|rows)|this (?:list|table)|notes?:|sources?:|references?:|tip:|done[.!]|sorry|unfortunately|as an ai)/iu

function isChatter(line: string): boolean {
  const text = stripMarkdown(line.replace(LIST_MARK, '')).trim()
  if (text.length === 0) return true
  if (/^[-*_=]{3,}$/u.test(text)) return true
  if (/^\[\d{1,3}\]/u.test(text)) return true
  if (text.endsWith(':')) return true
  return CHATTER.test(text)
}

function mostCommon(values: readonly number[]): number {
  const tally = new Map<number, number>()
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
  let best = 0
  let bestCount = 0
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function isUrlOnly(value: string): boolean {
  return /^(?:https?:\/\/|www\.)\S+$/iu.test(value)
}
