/**
 * The one delimited-text reader for every import (crosscut §5.3): CSV, TSV (a paste
 * from Google Sheets or Excel is TSV), semicolon CSV from European Excel and
 * pipe-separated text. RFC 4180 quoting with doubled quotes, line breaks inside
 * quotes, CRLF, LF or CR, and a leading BOM. `export/csv.ts`, the topic wizard's CSV
 * and the Import pages CSV all read through here. Pure.
 */

export type Delimiter = ',' | ';' | '\t' | '|'

const DELIMITERS: readonly Delimiter[] = ['\t', ',', ';', '|']
/** Lines looked at when guessing the delimiter. */
const SNIFF_LINES = 20

export interface CsvRecord {
  /** 1-based line the record starts on. */
  line: number
  cells: string[]
}

export interface ParseOptions {
  /** Unset: guessed from the first lines. Null: one value per line. */
  delimiter?: Delimiter | null
  /** Delimiters the guess may pick. Default: tab, comma, semicolon and pipe. */
  candidates?: readonly Delimiter[]
  /** Keep records whose cells are all blank. Default false. */
  keepEmpty?: boolean
}

/** Text without a leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * The delimiter that splits the first lines most evenly: present on most lines, the
 * same number of times on each. Quoted text is skipped while counting. Null when no
 * candidate is on most lines: the text is one value per line (a list of questions
 * with the odd comma in them stays whole).
 */
export function sniffDelimiter(
  text: string,
  candidates: readonly Delimiter[] = DELIMITERS
): Delimiter | null {
  const lines = unquotedLines(stripBom(text)).slice(0, SNIFF_LINES)
  let best: Delimiter | null = null
  let bestScore = 0
  for (const delimiter of candidates) {
    const counts = lines.map((line) => line.split(delimiter).length - 1)
    const withIt = counts.filter((count) => count > 0)
    if (withIt.length === 0 || withIt.length * 5 < lines.length * 3) continue
    const mode = mostCommon(withIt)
    const steady = counts.filter((count) => count === mode).length
    // Lines that split the same way count most; a tab wins a tie (a sheet paste).
    const score = steady * 10 + withIt.length + (delimiter === '\t' ? 0.5 : 0)
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

/** Splits text into records. Cells keep their spaces; callers trim. */
export function parseRecords(text: string, options: ParseOptions = {}): CsvRecord[] {
  const source = stripBom(text)
  const delimiter =
    options.delimiter === undefined ? sniffDelimiter(source, options.candidates) : options.delimiter
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let recordLine = 1
  const pushRecord = (): void => {
    cells.push(cell)
    if (options.keepEmpty === true || cells.some((value) => value.trim().length > 0)) {
      records.push({ line: recordLine, cells })
    }
    cells = []
    cell = ''
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index)
    if (quoted) {
      if (char === '"') {
        if (source.charAt(index + 1) === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else {
        if (char === '\n' || (char === '\r' && source.charAt(index + 1) !== '\n')) line += 1
        cell += char
      }
      continue
    }
    if (char === '"' && cell.trim().length === 0) {
      quoted = true
      cell = ''
    } else if (char === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source.charAt(index + 1) === '\n') index += 1
      pushRecord()
      line += 1
      recordLine = line
    } else cell += char
  }
  if (cell.length > 0 || cells.length > 0) pushRecord()
  return records
}

/** Rows of trimmed cells, blank rows left out. */
export function parseRows(text: string, options: ParseOptions = {}): string[][] {
  return parseRecords(text, options).map((record) => record.cells.map((cell) => cell.trim()))
}

/**
 * Bytes as text: UTF-16 when the file starts with its BOM (Excel's "Unicode text"),
 * else UTF-8, falling back to Windows-1252 when UTF-8 leaves replacement characters
 * (an old Excel CSV with accents).
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('�')) return stripBom(utf8)
  return new TextDecoder('windows-1252').decode(bytes)
}

function mostCommon(values: readonly number[]): number {
  const tally = new Map<number, number>()
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
  let best = values[0] ?? 0
  let bestCount = 0
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/** Physical lines with quoted text blanked out, so a comma inside quotes is not counted. */
function unquotedLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < text.length && lines.length < SNIFF_LINES; index += 1) {
    const char = text.charAt(index)
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') index += 1
      if (current.trim().length > 0) lines.push(current)
      current = ''
    } else current += char
  }
  if (current.trim().length > 0) lines.push(current)
  return lines
}
