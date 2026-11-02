import { gunzipSync } from 'node:zlib'

/**
 * A small, safe sitemap reader (sitemaps.org protocol). No XML library is
 * installed, so this is a hand-written tokenizer that:
 * - refuses any document with an entity declaration (`<!ENTITY`) and never
 *   expands DTD or external entities; a plain `<!DOCTYPE …>` is skipped,
 * - decodes only the five predefined entities and numeric character references,
 * - runs in linear time (no backtracking regular expressions over the body),
 * - caps the input size, the URLs kept, and the nesting depth,
 * - keeps the entries completed so far when the document is cut off.
 */

export const SITEMAP_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxUrls: 50_000,
  maxChildSitemaps: 1_000
} as const

export interface SitemapLimits {
  maxBytes: number
  maxUrls: number
  maxChildSitemaps: number
}

export interface SitemapUrlEntry {
  loc: string
  lastmod: string | null
}

export type ParsedSitemap =
  | { kind: 'urlset'; urls: SitemapUrlEntry[]; truncated: boolean }
  | { kind: 'index'; sitemaps: SitemapUrlEntry[]; truncated: boolean }

/** A sitemap that cannot be used. The message is plain language and safe to show. */
export class SitemapParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SitemapParseError'
  }
}

/** Deeper nesting than this is not a sitemap. */
const MAX_DEPTH = 64
/** A `<loc>` longer than this is dropped (page URLs are capped at 2,000 characters). */
const MAX_LOC_LENGTH = 2048
const MAX_LASTMOD_LENGTH = 64
const W3C_DATE = /^\d{4}-\d{2}-\d{2}(?:T[0-9:.+\-Z]{1,40})?$/

const NOT_A_SITEMAP = 'This file is not a sitemap.'

export function parseSitemapXml(text: string, limits?: Partial<SitemapLimits>): ParsedSitemap {
  const max: SitemapLimits = { ...SITEMAP_LIMITS, ...limits }
  if (Buffer.byteLength(text, 'utf8') > max.maxBytes) {
    throw new SitemapParseError('The sitemap is too large to read.')
  }
  if (/<!ENTITY/i.test(text)) {
    throw new SitemapParseError('The sitemap declares XML entities, which CiteFox does not read.')
  }
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const reader = new Reader(max)
  reader.run(input)
  return reader.result()
}

/**
 * The sitemap text from a response. A gzip body (`.xml.gz`) is decompressed
 * with an output cap, so a compression bomb fails instead of filling memory.
 */
export function decodeSitemapBody(
  input: { bytes?: Uint8Array; body: string },
  maxBytes: number = SITEMAP_LIMITS.maxBytes
): string {
  const bytes = input.bytes
  if (bytes === undefined || bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return input.body
  }
  let out: Buffer
  try {
    out = gunzipSync(bytes, { maxOutputLength: maxBytes })
  } catch (error) {
    if (isTooLarge(error)) throw new SitemapParseError('The compressed sitemap is too large.')
    throw new SitemapParseError('The compressed sitemap could not be decompressed.')
  }
  return out.toString('utf8')
}

function isTooLarge(error: unknown): boolean {
  if (error instanceof RangeError) return true
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ERR_BUFFER_TOO_LARGE'
}

type Capture = 'loc' | 'lastmod' | null

class Reader {
  private readonly stack: string[] = []
  private root: 'urlset' | 'sitemapindex' | null = null
  private readonly entries: SitemapUrlEntry[] = []
  private truncated = false
  private done = false
  private capture: Capture = null
  private captured = ''
  private loc: string | null = null
  private lastmod: string | null = null
  private inItem = false

  constructor(private readonly max: SitemapLimits) {}

  run(input: string): void {
    let pos = 0
    const length = input.length
    while (pos < length && !this.done) {
      const lt = input.indexOf('<', pos)
      if (lt === -1) {
        this.text(input.slice(pos))
        break
      }
      if (lt > pos) this.text(input.slice(pos, lt))
      const next = this.markup(input, lt)
      if (next === -1) break // cut off mid-markup: keep what was completed
      pos = next
    }
  }

  result(): ParsedSitemap {
    if (this.root === null) throw new SitemapParseError(NOT_A_SITEMAP)
    if (this.root === 'urlset') {
      return { kind: 'urlset', urls: this.entries, truncated: this.truncated }
    }
    return { kind: 'index', sitemaps: this.entries, truncated: this.truncated }
  }

  /** Handles the markup at `lt`. Returns the position after it, or -1 at end of input. */
  private markup(input: string, lt: number): number {
    if (input.startsWith('<!--', lt)) return after(input, '-->', lt + 4)
    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9)
      if (end === -1) return -1
      this.text(input.slice(lt + 9, end), true)
      return end + 3
    }
    if (input.startsWith('<?', lt)) return after(input, '?>', lt + 2)
    if (input.startsWith('<!', lt)) return skipDeclaration(input, lt + 2)
    if (input.charCodeAt(lt + 1) === 0x2f /* / */) {
      const end = input.indexOf('>', lt + 2)
      if (end === -1) return -1
      this.close(localName(input.slice(lt + 2, end).trim()))
      return end + 1
    }
    const nameEnd = scanName(input, lt + 1)
    if (nameEnd === lt + 1) {
      this.text('<')
      return lt + 1
    }
    const end = tagEnd(input, nameEnd)
    if (end === -1) return -1
    const selfClosing = input.charCodeAt(end - 1) === 0x2f
    const name = localName(input.slice(lt + 1, nameEnd))
    this.open(name)
    if (selfClosing) this.close(name)
    return end + 1
  }

  private open(name: string): void {
    if (this.stack.length === 0) {
      if (this.root !== null) return
      if (name === 'urlset' || name === 'sitemapindex') this.root = name
      else throw new SitemapParseError(NOT_A_SITEMAP)
    }
    if (this.stack.length >= MAX_DEPTH) {
      throw new SitemapParseError('The sitemap is nested too deeply.')
    }
    this.stack.push(name)
    const depth = this.stack.length
    if (depth === 2 && name === this.itemName()) {
      this.inItem = true
      this.loc = null
      this.lastmod = null
    } else if (depth === 3 && this.inItem && (name === 'loc' || name === 'lastmod')) {
      this.capture = name
      this.captured = ''
    }
  }

  private close(name: string): void {
    const index = this.stack.lastIndexOf(name)
    if (index === -1) return // stray closing tag
    while (this.stack.length > index) {
      const depth = this.stack.length
      const popped = this.stack.pop()
      if (depth === 3 && this.capture !== null && popped === this.capture) this.finishCapture()
      else if (depth === 2 && this.inItem && popped === this.itemName()) this.finishItem()
    }
    if (this.stack.length === 0 && this.root !== null) this.done = true
  }

  private text(value: string, raw = false): void {
    if (this.capture === null) return
    const limit = this.capture === 'loc' ? MAX_LOC_LENGTH : MAX_LASTMOD_LENGTH
    if (this.captured.length > limit) return
    const room = limit + 1 - this.captured.length
    this.captured += raw ? value.slice(0, room) : decodeEntities(value.slice(0, room * 10))
  }

  private finishCapture(): void {
    const value = this.captured.trim()
    if (this.capture === 'loc') {
      this.loc = value.length > 0 && value.length <= MAX_LOC_LENGTH ? value : null
    } else if (this.capture === 'lastmod') {
      this.lastmod = W3C_DATE.test(value) ? value : null
    }
    this.capture = null
    this.captured = ''
  }

  private finishItem(): void {
    this.inItem = false
    this.capture = null
    if (this.loc === null) return
    const cap = this.root === 'urlset' ? this.max.maxUrls : this.max.maxChildSitemaps
    if (this.entries.length >= cap) {
      this.truncated = true
      this.done = true
      return
    }
    this.entries.push({ loc: this.loc, lastmod: this.lastmod })
  }

  private itemName(): string {
    return this.root === 'urlset' ? 'url' : 'sitemap'
  }
}

/** Index just past `needle`, searching from `from`, or -1. */
function after(input: string, needle: string, from: number): number {
  const end = input.indexOf(needle, from)
  return end === -1 ? -1 : end + needle.length
}

/** `<!DOCTYPE …>` with an optional internal subset in brackets. Quotes are respected. */
function skipDeclaration(input: string, from: number): number {
  let bracket = 0
  let quote = 0
  for (let index = from; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if (quote !== 0) {
      if (code === quote) quote = 0
    } else if (code === 0x22 || code === 0x27) quote = code
    else if (code === 0x5b) bracket += 1
    else if (code === 0x5d) bracket = Math.max(0, bracket - 1)
    else if (code === 0x3e && bracket === 0) return index + 1
  }
  return -1
}

function scanName(input: string, from: number): number {
  let index = from
  while (index < input.length) {
    const code = input.charCodeAt(index)
    if (
      code === 0x20 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      code === 0x2f ||
      code === 0x3e ||
      code === 0x3c
    ) {
      break
    }
    index += 1
  }
  return index
}

/** Position of the `>` that ends a start tag, skipping quoted attribute values. */
function tagEnd(input: string, from: number): number {
  let quote = 0
  for (let index = from; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    if (quote !== 0) {
      if (code === quote) quote = 0
    } else if (code === 0x22 || code === 0x27) quote = code
    else if (code === 0x3e) return index
  }
  return -1
}

function localName(name: string): string {
  const colon = name.lastIndexOf(':')
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase()
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

/** The five predefined entities and numeric references. Anything else stays literal. */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(
    /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g,
    (whole, body: string) => {
      const named = NAMED[body]
      if (named !== undefined) return named
      const code =
        body.charAt(1) === 'x'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole
      if (code >= 0xd800 && code <= 0xdfff) return whole
      return String.fromCodePoint(code)
    }
  )
}
