/**
 * A forward-only HTML tag scanner for page extraction.
 *
 * Regular expressions such as `<script\b[^>]*type=...[^>]*>` backtrack
 * polynomially on hostile HTML and can freeze the main thread. This scanner
 * moves one cursor forward with `indexOf` and per-character loops, so its cost
 * is linear in the input. It is not a full HTML parser: it finds tags, their
 * attributes, and the raw text of script, style, noscript, title, and textarea.
 */

export interface HtmlTag {
  /** Lowercase tag name. */
  name: string
  closing: boolean
  attrs: Readonly<Record<string, string>>
  /** Index of `<`. */
  start: number
  /** Index after `>`. For a raw-text tag, the index after its closing tag. */
  end: number
  /** Content of a raw-text tag. Null for every other tag. */
  rawText: string | null
}

const RAW_TEXT = new Set(['script', 'style', 'noscript', 'title', 'textarea'])
/** Raw-text elements whose text still counts as visible, as it always has. */
const KEPT_RAW_TEXT = new Set(['title', 'textarea'])

/** Name of a comment entry. It is listed so its text is never read as visible. */
export const COMMENT = '#comment'
/** Name of a doctype or processing-instruction entry. */
export const DECLARATION = '#declaration'

/**
 * Every tag in document order, plus comment and declaration entries.
 * A trailing tag with no closing `>` ends the scan and stays as text.
 */
export function scanTags(html: string): HtmlTag[] {
  const tags: HtmlTag[] = []
  let index = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open === -1) break
    if (html.startsWith('<!--', open)) {
      // An unclosed comment runs to the end of the document, as in a browser.
      const close = html.indexOf('-->', open + 4)
      const end = close === -1 ? html.length : close + 3
      tags.push(markup(COMMENT, open, end))
      index = end
      continue
    }
    const next = html[open + 1] ?? ''
    if (next === '!' || next === '?') {
      const close = html.indexOf('>', open)
      if (close === -1) break
      tags.push(markup(DECLARATION, open, close + 1))
      index = close + 1
      continue
    }
    const closing = next === '/'
    const nameStart = closing ? open + 2 : open + 1
    let nameEnd = nameStart
    while (nameEnd < html.length && isNameChar(html.charCodeAt(nameEnd))) nameEnd += 1
    if (nameEnd === nameStart || !isLetter(html.charCodeAt(nameStart))) {
      index = open + 1
      continue
    }
    const tagEnd = endOfTag(html, nameEnd)
    if (tagEnd === -1) break
    const name = html.slice(nameStart, nameEnd).toLowerCase()
    const attrs = closing ? {} : parseAttributes(html.slice(nameEnd, tagEnd - 1))
    if (!closing && RAW_TEXT.has(name)) {
      const closeAt = rawTextEnd(html, name, tagEnd)
      const rawEnd = closeAt === -1 ? html.length : closeAt
      const after = closeAt === -1 ? html.length : html.indexOf('>', closeAt)
      tags.push({
        name,
        closing,
        attrs,
        start: open,
        end: after === -1 ? html.length : after + 1,
        rawText: html.slice(tagEnd, rawEnd)
      })
      index = after === -1 ? html.length : after + 1
      continue
    }
    tags.push({ name, closing, attrs, start: open, end: tagEnd, rawText: null })
    index = tagEnd
  }
  return tags
}

function markup(name: string, start: number, end: number): HtmlTag {
  return { name, closing: false, attrs: {}, start, end, rawText: null }
}

/** A start and an end index of the content between an open tag and its matching close. */
export interface ElementRange {
  name: string
  /** Index of the open tag in the scanned list. */
  tagIndex: number
  contentStart: number
  contentEnd: number
}

/**
 * Outermost elements with this name. A nested element of the same name stays inside
 * its parent. An element that never closes runs to the end of the document.
 */
export function outermostElements(
  html: string,
  tags: readonly HtmlTag[],
  name: string
): ElementRange[] {
  const ranges: ElementRange[] = []
  let depth = 0
  let current: { tagIndex: number; contentStart: number } | null = null
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag === undefined || tag.name !== name) continue
    if (!tag.closing) {
      if (depth === 0) current = { tagIndex: index, contentStart: tag.end }
      depth += 1
      continue
    }
    if (depth === 0) continue
    depth -= 1
    if (depth === 0 && current !== null) {
      ranges.push({ name, ...current, contentEnd: tag.start })
      current = null
    }
  }
  if (current !== null) ranges.push({ name, ...current, contentEnd: html.length })
  return ranges
}

/**
 * Visible text between two indexes: tags become spaces, and script, style, and
 * noscript content is dropped. Entities are decoded and whitespace collapsed.
 */
export function visibleTextBetween(
  html: string,
  tags: readonly HtmlTag[],
  from: number,
  to: number
): string {
  const pieces: string[] = []
  let cursor = from
  for (const tag of tags) {
    if (tag.end <= from) continue
    if (tag.start >= to) break
    if (tag.start > cursor) pieces.push(html.slice(cursor, tag.start))
    if (tag.rawText !== null && KEPT_RAW_TEXT.has(tag.name)) pieces.push(tag.rawText)
    cursor = Math.max(cursor, tag.end)
  }
  if (cursor < to) pieces.push(html.slice(cursor, to))
  return collapse(decodeEntities(pieces.join(' ')))
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Index after the `>` that ends the tag, honouring quoted attribute values. -1 if none. */
function endOfTag(html: string, from: number): number {
  let quote = ''
  for (let index = from; index < html.length; index += 1) {
    const char = html[index]
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '>') return index + 1
  }
  return -1
}

/** Index of `</name` after `from`, matched case-insensitively. -1 if none. */
function rawTextEnd(html: string, name: string, from: number): number {
  const pattern = new RegExp(`</${name}(?![A-Za-z0-9-])`, 'gi')
  pattern.lastIndex = from
  const match = pattern.exec(html)
  return match === null ? -1 : match.index
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  let index = 0
  const length = source.length
  while (index < length) {
    while (index < length && isSpaceOrSlash(source[index] ?? '')) index += 1
    const nameStart = index
    while (index < length && !isAttrNameEnd(source[index] ?? '')) index += 1
    if (index === nameStart) {
      index += 1
      continue
    }
    const name = source.slice(nameStart, index).toLowerCase()
    while (index < length && isSpace(source[index] ?? '')) index += 1
    let value = ''
    if (source[index] === '=') {
      index += 1
      while (index < length && isSpace(source[index] ?? '')) index += 1
      const quote = source[index]
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, index + 1)
        const end = close === -1 ? length : close
        value = source.slice(index + 1, end)
        index = end + 1
      } else {
        const valueStart = index
        while (index < length && !isSpace(source[index] ?? '')) index += 1
        value = source.slice(valueStart, index)
      }
    }
    if (!Object.prototype.hasOwnProperty.call(attrs, name)) attrs[name] = value
  }
  return attrs
}

function isNameChar(code: number): boolean {
  return isLetter(code) || (code >= 48 && code <= 57) || code === 45
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isSpace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f'
}

function isSpaceOrSlash(char: string): boolean {
  return isSpace(char) || char === '/'
}

function isAttrNameEnd(char: string): boolean {
  return isSpace(char) || char === '/' || char === '=' || char === '>'
}
