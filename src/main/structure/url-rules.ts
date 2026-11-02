import type { ImportRejection } from '@shared/ipc'
import { fieldSpec, foldWord } from '@shared/import-fields'
import { parseRecords } from '../import/csv'

export type { ImportRejection } from '@shared/ipc'

/** Page URLs are capped at this length (section 10 `pages.url`). */
const MAX_URL_LENGTH = 2000
const DEFAULT_MAX_ROWS = 10_000
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\s\u0000-\u001f\u007f]/

/**
 * A page URL as CiteFox stores it, or null. http and https only, no
 * credentials, no `#fragment`. The host is lower-cased; path and query stay.
 */
export function normalizePageUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_URL_LENGTH || BAD_CHARS.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '' || url.hostname.length === 0) return null
  url.hash = ''
  const href = url.href
  return href.length > MAX_URL_LENGTH ? null : href
}

/** `example.com`, `Example.com`, or `https://www.example.com/` → `example.com`. */
export function bareDomain(domain: string): string {
  let host = domain.trim().toLowerCase()
  const scheme = host.indexOf('://')
  if (scheme !== -1) host = host.slice(scheme + 3)
  host = host.split(/[/?#]/)[0] ?? ''
  const at = host.lastIndexOf('@')
  if (at !== -1) host = host.slice(at + 1)
  host = host.replace(/:\d+$/, '').replace(/\.$/, '')
  return stripWww(host)
}

/**
 * True when `url` is on the project domain. `www.` is always the same site.
 * Other subdomains count only when `includeSubdomains` is set.
 */
export function isOwnDomainUrl(url: string, domain: string, includeSubdomains: boolean): boolean {
  const own = bareDomain(domain)
  if (own.length === 0) return false
  let host: string
  try {
    host = stripWww(new URL(url).hostname.toLowerCase().replace(/\.$/, ''))
  } catch {
    return false
  }
  if (host === own) return true
  return includeSubdomains && host.endsWith(`.${own}`)
}

/**
 * Directory segments of a page URL, without the page slug.
 * `/blog/foo/` → `['blog']`, `/industries/healthcare/dentists/` →
 * `['industries', 'healthcare']`, `/pricing/` and `/` → `[]`.
 */
export function folderSegments(url: string): string[] {
  const segments = pathSegments(url)
  return segments.slice(0, Math.max(0, segments.length - 1))
}

/** The top-level folder, like `/blog/`, or `/` for a page at the root. */
export function topFolderOf(url: string): string {
  const first = folderSegments(url)[0]
  return first === undefined ? '/' : `/${first}/`
}

const MONEY_SEGMENTS = new Set([
  'pricing',
  'plans',
  'product',
  'products',
  'feature',
  'features',
  'compare',
  'comparison',
  'alternative',
  'alternatives',
  'vs'
])

/** FR-20.6 money pages: pricing, product, features, compare, and alternatives URLs. */
export function isMoneyPage(url: string): boolean {
  const segments = pathSegments(url).map((segment) => segment.toLowerCase())
  if (segments.some((segment) => MONEY_SEGMENTS.has(segment))) return true
  const slug = segments.at(-1) ?? ''
  return (
    slug.includes('-vs-') ||
    slug.startsWith('vs-') ||
    slug.includes('-alternatives') ||
    slug.includes('pricing')
  )
}

/** A readable name from the slug: `/blog/10dlc-registration-guide/` → `10dlc registration guide`. */
export function slugTitle(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const slug = pathSegments(url).at(-1)
  if (slug === undefined) return parsed.hostname
  let text = slug
  try {
    text = decodeURIComponent(slug)
  } catch {
    // Keep the raw slug when it is not valid percent-encoding.
  }
  const words = text
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim()
  return words.length > 0 ? words : parsed.hostname
}

export interface ImportEntry {
  /** 1-based line (pasted text) or CSV row start line. */
  line: number
  value: string
  /** A CSV's `label` column, when it has one. */
  label?: string
}

/**
 * FR-20.6 pasted URLs or a CSV with a `url` column. `error` is set when the
 * input cannot be used (no `url` column), and also when rows past `maxRows`
 * were left out; the entries read so far are still returned then.
 */
export function parseImportText(
  text: string,
  format: 'lines' | 'csv',
  maxRows: number = DEFAULT_MAX_ROWS
): { entries: ImportEntry[]; error: string | null } {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return format === 'csv' ? parseCsv(body, maxRows) : parseLines(body, maxRows)
}

function parseLines(
  text: string,
  maxRows: number
): { entries: ImportEntry[]; error: string | null } {
  const entries: ImportEntry[] = []
  const lines = text.split(/\r\n|\n|\r/)
  for (let index = 0; index < lines.length; index += 1) {
    const value = (lines[index] ?? '').trim()
    if (value.length === 0 || value.startsWith('#')) continue
    if (entries.length >= maxRows) return { entries, error: tooMany(maxRows) }
    entries.push({ line: index + 1, value })
  }
  return { entries, error: null }
}

function parseCsv(text: string, maxRows: number): { entries: ImportEntry[]; error: string | null } {
  // The shared importer's reader: comma, semicolon or tab, RFC 4180 quoting.
  const records = parseRecords(text, { candidates: [',', ';', '\t'] })
  const header = records[0]
  if (header === undefined) return { entries: [], error: NO_URL_COLUMN }
  const names = new Set(fieldSpec('pages', 'url')?.synonyms ?? ['url'])
  let column = header.cells.findIndex((cell) => names.has(foldWord(cell)))
  let body = records.slice(1)
  if (column === -1) {
    // No header word: a column of web addresses from the first row on.
    column = header.cells.findIndex((cell) => /^(https?:\/\/|www\.)\S+$/iu.test(cell.trim()))
    body = records
  }
  if (column === -1) return { entries: [], error: NO_URL_COLUMN }
  // A `label` column (Import a file sends the matched Label column under that name).
  const labelColumn =
    body === records
      ? -1
      : header.cells.findIndex((cell, index) => index !== column && foldWord(cell) === 'label')
  const entries: ImportEntry[] = []
  for (const record of body) {
    const value = (record.cells[column] ?? '').trim()
    if (value.length === 0) continue
    if (entries.length >= maxRows) return { entries, error: tooMany(maxRows) }
    const label = labelColumn < 0 ? '' : (record.cells[labelColumn] ?? '').trim()
    entries.push(label ? { line: record.line, value, label } : { line: record.line, value })
  }
  return { entries, error: null }
}

const NO_URL_COLUMN = 'No column of web addresses was found. Name it url, or match the columns.'

function tooMany(maxRows: number): string {
  return `Only the first ${maxRows.toLocaleString('en-US')} URLs were read.`
}

/**
 * Checks each entry: a web address, on the project domain. A URL that repeats
 * one already accepted is counted in `duplicates`, not rejected.
 */
export function validateImportEntries(
  entries: readonly ImportEntry[],
  domain: string,
  includeSubdomains: boolean
): {
  accepted: { line: number; url: string; label?: string }[]
  rejected: ImportRejection[]
  duplicates: number
} {
  const accepted: { line: number; url: string; label?: string }[] = []
  const rejected: ImportRejection[] = []
  const seen = new Set<string>()
  let duplicates = 0
  const own = bareDomain(domain)
  for (const entry of entries) {
    const url = normalizePageUrl(entry.value)
    if (url === null) {
      rejected.push({ line: entry.line, value: entry.value, reason: 'Not a web address' })
      continue
    }
    if (!isOwnDomainUrl(url, domain, includeSubdomains)) {
      rejected.push({ line: entry.line, value: entry.value, reason: `Not on ${own}` })
      continue
    }
    if (seen.has(url)) {
      duplicates += 1
      continue
    }
    seen.add(url)
    accepted.push(
      entry.label ? { line: entry.line, url, label: entry.label } : { line: entry.line, url }
    )
  }
  return { accepted, rejected, duplicates }
}

function pathSegments(url: string): string[] {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return []
  }
  return pathname.split('/').filter((segment) => segment.length > 0)
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}
