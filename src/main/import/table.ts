import {
  IMPORT_MAX_CELL,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  type ImportColumn,
  type ImportMapping
} from '@shared/ipc'
import {
  BUILT_IN_STAGE_WORDS,
  columnLetter,
  foldWord,
  IMPORT_FIELDS,
  type ImportEntity
} from '@shared/import-fields'

/**
 * A table read from a paste or a file: the header row (when there is one), the data
 * rows, and the guessed column match. The limits (rows, columns, characters per
 * cell) are applied here, each with a plain warning. Pure.
 */

export interface ImportTable {
  header: string[] | null
  /** Data rows, each as wide as the widest row; `rowNumbers[i]` is row i's line in the file. */
  rows: string[][]
  rowNumbers: number[]
  width: number
  warnings: string[]
}

/** Every row as wide as the widest, cells trimmed and cut to the limit, limits warned. */
export function buildTable(raw: readonly (readonly string[])[], hasHeader: boolean): ImportTable {
  const warnings: string[] = []
  let width = raw.reduce((most, row) => Math.max(most, row.length), 0)
  if (width > IMPORT_MAX_COLUMNS) {
    warnings.push(
      `Only the first ${IMPORT_MAX_COLUMNS} columns are read; ${width - IMPORT_MAX_COLUMNS} more were left out.`
    )
    width = IMPORT_MAX_COLUMNS
  }
  let cut = 0
  const cells = raw.map((row) =>
    Array.from({ length: width }, (_, index) => {
      const value = (row[index] ?? '').replace(/\s+/gu, ' ').trim()
      if (value.length <= IMPORT_MAX_CELL) return value
      cut += 1
      return value.slice(0, IMPORT_MAX_CELL)
    })
  )
  if (cut > 0) {
    warnings.push(
      `${cut.toLocaleString('en-US')} ${cut === 1 ? 'cell was' : 'cells were'} longer than ${IMPORT_MAX_CELL} characters and cut.`
    )
  }
  const header = hasHeader ? (cells[0] ?? null) : null
  let rows = hasHeader ? cells.slice(1) : cells
  const first = hasHeader ? 2 : 1
  if (rows.length > IMPORT_MAX_ROWS) {
    warnings.push(
      `Only the first ${IMPORT_MAX_ROWS.toLocaleString('en-US')} rows are read; the rest were left out.`
    )
    rows = rows.slice(0, IMPORT_MAX_ROWS)
  }
  return {
    header,
    rows,
    rowNumbers: rows.map((_, index) => index + first),
    width,
    warnings
  }
}

/** Every synonym of every field of the entity, folded. */
function knownHeaders(entity: ImportEntity): Set<string> {
  return new Set(
    IMPORT_FIELDS[entity].flatMap((field) => [foldWord(field.label), ...field.synonyms])
  )
}

/**
 * True when the first row names columns rather than holding data: at least half of
 * its non-empty cells are known column names (Query, Funnel stage, Landing page…),
 * or it is the only row without a digit above a numeric column.
 */
export function looksLikeHeader(
  raw: readonly (readonly string[])[],
  entity: ImportEntity
): boolean {
  const first = raw[0]
  if (first === undefined || raw.length < 2) {
    return first !== undefined && first.length > 0 && matchesKnown(first, entity) === filled(first)
  }
  const cells = filled(first)
  if (cells === 0) return false
  if (matchesKnown(first, entity) * 2 >= cells) return true
  // "Volume" over 320, 90, 1900: a word above numbers.
  return first.some((cell, index) => {
    const head = cell.trim()
    if (head.length === 0 || /\d/u.test(head)) return false
    const below = raw.slice(1, 6).map((row) => (row[index] ?? '').trim())
    return (
      below.length > 0 &&
      below.every((value) => /^[\d.,%$€£\s-]+$/u.test(value) && value.length > 0)
    )
  })
}

function filled(row: readonly string[]): number {
  return row.filter((cell) => cell.trim().length > 0).length
}

function matchesKnown(row: readonly string[], entity: ImportEntity): number {
  const known = knownHeaders(entity)
  return row.filter((cell) => cell.trim().length > 0 && known.has(foldWord(cell))).length
}

export function columnsOf(table: ImportTable): ImportColumn[] {
  return Array.from({ length: table.width }, (_, index) => ({
    index,
    letter: columnLetter(index),
    header: table.header?.[index] ?? '',
    samples: table.rows
      .map((row) => row[index] ?? '')
      .filter((value) => value.length > 0)
      .slice(0, 3)
  }))
}

const URLISH = /^(?:https?:\/\/|www\.|\/)\S*$|^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/iu
const MARKETISH = /^(?:[a-z]{2}(?:[-_ ·]+[a-z]{2})?)$/iu

/**
 * The column match guessed for a table: a header that names a field wins; columns
 * without one are guessed from their values (URLs → the page, two-letter codes → the
 * market, stage words → the stage, the longest text → the main field). Each field is
 * used once. Unknown columns are not imported.
 */
export function guessMapping(table: ImportTable, entity: ImportEntity): ImportMapping {
  const fields = IMPORT_FIELDS[entity]
  const used = new Set<string>()
  const mapping: (string | null)[] = Array.from({ length: table.width }, () => null)
  if (table.header !== null) {
    table.header.forEach((cell, index) => {
      const key = foldWord(cell)
      if (key.length === 0) return
      const field =
        fields.find((item) => !used.has(item.id) && item.synonyms.includes(key)) ??
        fields.find((item) => !used.has(item.id) && foldWord(item.label) === key)
      if (field === undefined) return
      mapping[index] = field.id
      used.add(field.id)
    })
  }
  const values = (index: number): string[] =>
    table.rows
      .slice(0, 50)
      .map((row) => row[index] ?? '')
      .filter((value) => value.length > 0)
  const share = (index: number, test: (value: string) => boolean): number => {
    const list = values(index)
    return list.length === 0 ? 0 : list.filter(test).length / list.length
  }
  const free = (): number[] =>
    mapping.flatMap((field, index) => (field === null && values(index).length > 0 ? [index] : []))
  const urlField = fields.find(
    (field) => field.id === 'page' || field.id === 'url' || field.id === 'domain'
  )
  const tryAssign = (fieldId: string | undefined, test: (value: string) => boolean): void => {
    if (fieldId === undefined || used.has(fieldId)) return
    if (!fields.some((field) => field.id === fieldId)) return
    const index = free().find((column) => share(column, test) >= 0.8)
    if (index === undefined) return
    mapping[index] = fieldId
    used.add(fieldId)
  }
  // The main field: on a page list or a competitor list it is the URL column.
  const main = fields[0]?.id
  if (main === 'url' || main === 'domain') tryAssign(main, (value) => URLISH.test(value))
  else tryAssign(urlField?.id, (value) => URLISH.test(value))
  tryAssign('stage', (value) => BUILT_IN_STAGE_WORDS[foldWord(value)] !== undefined)
  tryAssign('market', (value) => MARKETISH.test(value.trim()))
  tryAssign('country', (value) => MARKETISH.test(value.trim()))
  if (main !== undefined && !used.has(main)) {
    // The column with the longest text is the question (or name).
    const longest = free()
      .map((index) => ({
        index,
        length: values(index).reduce((sum, value) => sum + value.length, 0) / values(index).length
      }))
      .filter((item) => !values(item.index).every((value) => /^[\d.,%\s-]+$/u.test(value)))
      .sort((left, right) => right.length - left.length)[0]
    if (longest !== undefined) {
      mapping[longest.index] = main
      used.add(main)
    }
  }
  // A page or competitor list: the text column beside the URLs is its label or name.
  const named = fields.find((field) => field.id === 'label' || field.id === 'name')
  if ((main === 'url' || main === 'domain') && named !== undefined && !used.has(named.id)) {
    const text = free().find((index) => share(index, (value) => !URLISH.test(value)) >= 0.8)
    if (text !== undefined) {
      mapping[text] = named.id
      used.add(named.id)
    }
  }
  return mapping
}

/** A key for the headers of a file, so a saved column match is found for the next one like it. */
export function headerSignature(header: readonly string[] | null, width: number): string {
  if (header === null) return `#${width}`
  return header.map((cell) => foldWord(cell)).join('|')
}
