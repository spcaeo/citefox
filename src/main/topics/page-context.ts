import { normalizeUrl } from '../engine/checks/url'
import type { SqliteDatabase } from '../storage/database'
import { getLatestSnapshot } from '../storage/snapshot-records'
import { listSiteReads } from './records'

/**
 * What the page prompts (Docs/PROMPT-AUDIT.md, package P5) read about one of the
 * business's pages: its head and headings, the part of its text that matches a
 * question, and the opening lines used to match candidates. A tracked page reads
 * its latest snapshot; any other page reads the topic site reads, so a page that
 * is not tracked yet still gives Claude its real headings and text.
 */

/** One page as the prompts see it. */
export interface PageRead {
  url: string
  title: string | null
  h1: string | null
  metaDescription: string | null
  headings: readonly string[]
  faqs: readonly string[]
  text: string
}

/** Characters of page text a candidate line carries in the page match. */
export const CANDIDATE_TEXT_CHARS = 200
/** Characters of the section that matches the question. */
export const MATCHED_SECTION_CHARS = 1600
/** Characters of the page's opening. */
export const PAGE_OPENING_CHARS = 700
/** Characters of the whole page text sent to the fix draft. */
export const FIX_PAGE_CHARS = 6000

/** The page behind a target: its snapshot when tracked, else its site read. Null when never read. */
export function readPage(
  db: SqliteDatabase,
  target: { pageId: string | null; url: string | null }
): PageRead | null {
  if (target.pageId !== null) {
    const snapshot = getLatestSnapshot(db, target.pageId)
    if (snapshot !== null) {
      return {
        url: target.url ?? '',
        title: snapshot.title,
        h1: snapshot.h1,
        metaDescription: snapshot.metaDescription,
        headings: snapshot.outline.map((entry) => entry.text),
        faqs: snapshot.faqs.map((faq) => faq.question),
        text: snapshot.bodyText
      }
    }
  }
  if (target.url === null) return null
  const key = urlKey(target.url)
  const read = listSiteReads(db)
    .filter((item) => item.ok && urlKey(item.url) === key)
    .at(-1)
  if (read === undefined) return null
  return {
    url: read.url,
    title: read.title,
    h1: read.h1,
    metaDescription: read.metaDescription,
    headings: read.outline,
    faqs: [],
    text: read.text
  }
}

/** Opening text per candidate URL (normalised), from snapshots and site reads. */
export function candidateOpenings(
  db: SqliteDatabase,
  candidates: readonly { pageId: string | null; url: string }[]
): Map<string, string> {
  const reads = new Map<string, string>()
  for (const read of listSiteReads(db)) if (read.ok) reads.set(urlKey(read.url), read.text)
  const out = new Map<string, string>()
  for (const candidate of candidates) {
    const key = urlKey(candidate.url)
    const snapshot = candidate.pageId === null ? null : getLatestSnapshot(db, candidate.pageId)
    const text = snapshot?.bodyText ?? reads.get(key) ?? ''
    const opening = clip(squash(text), CANDIDATE_TEXT_CHARS)
    if (opening.length > 0) out.set(key, opening)
  }
  return out
}

/** `Title: … / H1: … / Headings: a | b | c`, or a plain "not read" line. */
export function pageHead(page: PageRead | null, url: string | null): string {
  if (page === null) {
    return url === null ? 'No page yet.' : `Not read yet (${url}). Its headings are not known.`
  }
  const lines = [
    `Title: ${page.title ?? 'none'}`,
    `H1: ${page.h1 ?? 'none'}`,
    page.metaDescription === null ? null : `Meta description: ${squash(page.metaDescription)}`,
    `Headings: ${page.headings.length === 0 ? 'none found' : page.headings.slice(0, 30).join(' | ')}`,
    page.faqs.length === 0 ? null : `FAQ questions: ${page.faqs.slice(0, 12).join(' | ')}`
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

/**
 * The page's head, its opening and the section whose heading shares the most
 * words with the question, for the citation diagnosis. A page that was never
 * read says so, so the diagnosis does not guess what it covers.
 */
export function pageForQuestion(
  page: PageRead | null,
  url: string | null,
  question: string
): string {
  const head = pageHead(page, url)
  if (page === null) return head
  const text = squash(page.text)
  if (text.length === 0) return `${head}\nText: not stored.`
  const opening = clip(text, PAGE_OPENING_CHARS)
  const section = matchedSection(page, text, question)
  return [
    head,
    `Opening: ${opening}`,
    section === null
      ? 'Section that matches the question: no heading shares its words.'
      : `Section that matches the question (${section.heading}): ${section.text}`
  ].join('\n')
}

/** The page's head and text, for the fix draft. */
export function pageForFix(page: PageRead | null, url: string | null): string {
  const head = pageHead(page, url)
  if (page === null) return head
  const text = squash(page.text)
  return `${head}\nText: ${text.length === 0 ? 'not stored.' : clip(text, FIX_PAGE_CHARS)}`
}

function matchedSection(
  page: PageRead,
  text: string,
  question: string
): { heading: string; text: string } | null {
  const wanted = new Set(words(question))
  let best: { heading: string; score: number } | null = null
  for (const heading of page.headings) {
    const score = words(heading).filter((word) => wanted.has(word)).length
    if (score > 0 && (best === null || score > best.score)) best = { heading, score }
  }
  if (best === null) return null
  const at = text.toLowerCase().indexOf(best.heading.toLowerCase().trim())
  if (at < 0)
    return { heading: best.heading, text: 'its text was not found in the stored page text.' }
  return { heading: best.heading, text: clip(text.slice(at), MATCHED_SECTION_CHARS) }
}

const STOP = new Set(
  'a an and are as at be by can do does for from how i in is it my of on or our so that the their them they this to us we what when where which who why with without you your'.split(
    ' '
  )
)

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

function urlKey(url: string): string {
  return normalizeUrl(url) ?? url
}

function squash(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
