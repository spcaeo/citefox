import type { Delimiter } from '../import/csv'

/**
 * Typographic double quotes used as CSV quotes. A chatbot reply pasted from a chat
 * window often wraps a field in “ ” (or two ” marks) instead of ", so the CSV reader
 * would split the field at its first comma and keep a stray mark. A typographic quote
 * that opens a field and one that closes it (before the delimiter or the line end)
 * become plain quotes; curly quotes inside ordinary text are left alone. Pure.
 */

const TYPOGRAPHIC = /[“”„‟″]/u

/** One line with field-wrapping typographic quotes turned into CSV quotes. */
export function straightenQuotes(line: string, delimiter: Delimiter): string {
  if (!TYPOGRAPHIC.test(line)) return line
  let out = ''
  let start = 0
  while (start <= line.length) {
    let at = start
    while (at < line.length && (line[at] === ' ' || (line[at] === '\t' && delimiter !== '\t'))) {
      at += 1
    }
    const char = line[at] ?? ''
    let end: number
    if (char === '"') {
      // A field already in plain quotes: keep it as it is, through its closing quote.
      end = plainQuoteEnd(line, at, delimiter)
    } else if (TYPOGRAPHIC.test(char)) {
      const close = closingQuote(line, at, delimiter)
      if (close !== null) {
        const inner = line.slice(at + 1, close.quote).replace(/"/gu, '""')
        out += `${line.slice(start, at)}"${inner}"`
        if (close.next >= line.length) return out
        out += delimiter
        start = close.next + 1
        continue
      }
      end = line.indexOf(delimiter, at)
    } else {
      end = line.indexOf(delimiter, at)
    }
    if (end < 0 || end >= line.length) return out + line.slice(start)
    out += line.slice(start, end + 1)
    start = end + 1
  }
  return out
}

/** The delimiter after a plain-quoted field that opens at `open` (or -1). */
function plainQuoteEnd(line: string, open: number, delimiter: Delimiter): number {
  let index = open + 1
  while (index < line.length) {
    if (line[index] === '"') {
      if (line[index + 1] === '"') {
        index += 2
        continue
      }
      break
    }
    index += 1
  }
  return line.indexOf(delimiter, index + 1)
}

/** The typographic quote that closes the field opened at `open`, and where the field ends. */
function closingQuote(
  line: string,
  open: number,
  delimiter: Delimiter
): { quote: number; next: number } | null {
  for (let index = open + 1; index < line.length; index += 1) {
    if (!TYPOGRAPHIC.test(line[index] ?? '')) continue
    let next = index + 1
    while (next < line.length && line[next] === ' ') next += 1
    if (next >= line.length || line[next] === delimiter) return { quote: index, next }
  }
  return null
}
