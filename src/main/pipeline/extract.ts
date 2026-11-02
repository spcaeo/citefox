import type { OutlineEntry, PageFaq } from '@shared/domain'
import { visibleDates } from '../engine/fix-loop/page-dates'
import { PipelineError } from './errors'
import { contentHash, normalizeBody, wordCount } from './hash'
import {
  decodeEntities,
  outermostElements,
  scanTags,
  visibleTextBetween,
  type HtmlTag
} from './html-scan'

export interface ExtractedPage {
  title: string | null
  metaDescription: string | null
  h1: string | null
  canonical: string | null
  publishedAt: string | null
  modifiedAt: string | null
  outline: OutlineEntry[]
  faqs: PageFaq[]
  h2Count: number
  h3Count: number
  tableCount: number
  bodyText: string
  wordCount: number
  contentHash: string
}

export interface ExtractMeta {
  title?: string | null
  metaDescription?: string | null
  canonical?: string | null
  published?: string | null
  modified?: string | null
}

const TITLE_MAX = 300
const META_MAX = 500
const HEADING_MAX = 300

/**
 * Direct fetch: HTML head, headings, FAQPage JSON-LD, and the visible body (FR-2.2).
 * The body is `<main>`, else the `<article>` that holds the H1, else the longest
 * `<article>`, else the whole document. Parsing is linear (see `html-scan.ts`).
 */
export function extractHtml(html: string): ExtractedPage {
  const tags = scanTags(html)
  const metas = tags.filter((tag) => !tag.closing && tag.name === 'meta')
  const title = clip(rawTitle(tags), TITLE_MAX)
  const metaDescription = clip(metaContent(metas, 'description') ?? '', META_MAX)
  const canonical = clip(canonicalHref(tags) ?? '', 2000)
  const headings = htmlHeadings(html, tags)
  const h1 = clip(headings.find((heading) => heading.level === 1)?.text ?? '', HEADING_MAX)
  const jsonLd = jsonLdValues(tags)
  const jsonLdFaqs = faqsFromJsonLd(jsonLd)
  const faqs = jsonLdFaqs.length > 0 ? jsonLdFaqs : faqsFromHtml(html, tags, headings)
  const body = normalizeBody(mainText(html, tags, headings))
  const visible = visibleDates(body)
  return finish(
    {
      title: emptyToNull(title),
      metaDescription: emptyToNull(metaDescription),
      h1: emptyToNull(h1),
      canonical: emptyToNull(canonical),
      publishedAt: clip(
        metaContent(metas, 'article:published_time') ??
          jsonLdString(jsonLd, 'datePublished') ??
          timeDatetime(tags) ??
          visible.publishedAt ??
          '',
        40
      ),
      modifiedAt: clip(
        metaContent(metas, 'article:modified_time') ??
          metaContent(metas, 'og:updated_time') ??
          jsonLdString(jsonLd, 'dateModified') ??
          visible.modifiedAt ??
          '',
        40
      ),
      outline: outlineFrom(headings),
      tableCount: tags.filter((tag) => !tag.closing && tag.name === 'table').length,
      faqs,
      bodyText: body
    },
    body
  )
}

/** Jina Reader: a JSON envelope with markdown, or markdown on its own. */
export function extractJinaBody(body: string): ExtractedPage {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const data = jinaData(parsed)
      if (data !== null && data.content.length > 0) {
        return extractMarkdown(data.content, {
          title: data.title,
          metaDescription: data.description,
          canonical: data.url,
          published: data.published,
          modified: data.modified
        })
      }
    } catch {
      // Not JSON. Treat the body as markdown.
    }
  }
  return extractMarkdown(body)
}

export function extractMarkdown(markdown: string, meta?: ExtractMeta): ExtractedPage {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const headings: { level: number; text: string }[] = []
  for (const line of lines) {
    const heading = markdownHeading(line)
    if (heading !== null) headings.push(heading)
  }
  const h1 = clip(headings.find((heading) => heading.level === 1)?.text ?? '', HEADING_MAX)
  const body = normalizeBody(markdown)
  const visible = visibleDates(body)
  return finish(
    {
      title: emptyToNull(clip(meta?.title ?? h1, TITLE_MAX)),
      metaDescription: emptyToNull(clip(meta?.metaDescription ?? '', META_MAX)),
      h1: emptyToNull(h1),
      canonical: emptyToNull(clip(meta?.canonical ?? '', 2000)),
      publishedAt: emptyToNull(clip(givenOr(meta?.published, visible.publishedAt), 40)),
      modifiedAt: emptyToNull(clip(givenOr(meta?.modified, visible.modifiedAt), 40)),
      outline: outlineFrom(headings, markdownTableAfter(lines)),
      tableCount: countMarkdownTables(lines),
      faqs: faqsFromMarkdown(lines),
      bodyText: body
    },
    body
  )
}

function finish(
  partial: Omit<ExtractedPage, 'wordCount' | 'contentHash' | 'h2Count' | 'h3Count'>,
  body: string
): ExtractedPage {
  if (body.length === 0) {
    throw new PipelineError('The page had no text to read.', {
      code: 'fetch_failed',
      nextStep: 'Read the page again, or turn on the backup page reader in Connections.'
    })
  }
  const faqs = partial.faqs.map((faq) => ({
    question: clip(faq.question, 500),
    answer: clip(faq.answer, 5000),
    typo: faq.question.trim().endsWith('??') ? 'Question ends with ??.' : null
  }))
  return {
    ...partial,
    publishedAt: emptyToNull(partial.publishedAt),
    modifiedAt: emptyToNull(partial.modifiedAt),
    faqs,
    h2Count: partial.outline.filter((entry) => entry.level === 'h2').length,
    h3Count: partial.outline.filter((entry) => entry.level === 'h3').length,
    wordCount: wordCount(body),
    contentHash: contentHash(body)
  }
}

function outlineFrom(
  headings: readonly { level: number; text: string }[],
  tables?: ReadonlySet<string>
): OutlineEntry[] {
  const outline: OutlineEntry[] = []
  for (const heading of headings) {
    if (heading.level !== 2 && heading.level !== 3) continue
    const text = clip(heading.text, HEADING_MAX)
    if (text.length === 0) continue
    outline.push({
      level: heading.level === 2 ? 'h2' : 'h3',
      text,
      table: tables?.has(text) ?? false
    })
  }
  return outline
}

function markdownTableAfter(lines: readonly string[]): Set<string> {
  const tables = new Set<string>()
  let current: string | null = null
  let sawTable = false
  const flush = (): void => {
    if (current !== null && sawTable) tables.add(current)
    sawTable = false
  }
  for (const line of lines) {
    const heading = markdownHeading(line)
    if (heading !== null && (heading.level === 2 || heading.level === 3)) {
      flush()
      current = heading.text
      continue
    }
    if (isTableRow(line)) sawTable = true
  }
  flush()
  return tables
}

interface JinaFields {
  content: string
  title: string | null
  description: string | null
  url: string | null
  published: string | null
  modified: string | null
}

function jinaData(parsed: unknown): JinaFields | null {
  if (!isRecord(parsed)) return null
  const data = isRecord(parsed.data) ? parsed.data : parsed
  const content = typeof data.content === 'string' ? data.content : ''
  if (content.length === 0) return null
  return {
    content,
    title: stringOrNull(data.title),
    description: stringOrNull(data.description),
    url: stringOrNull(data.url),
    published: stringOrNull(data.publishedTime),
    modified: stringOrNull(data.modifiedTime)
  }
}

function isFaqHeading(text: string): boolean {
  return /^faqs?$/i.test(text.trim()) || /frequently asked questions/i.test(text)
}

function faqsFromMarkdown(lines: readonly string[]): PageFaq[] {
  const faqs: PageFaq[] = []
  let inFaq = false
  let question: string | null = null
  let answer: string[] = []
  const flush = (): void => {
    if (question === null) return
    faqs.push({ question, answer: answer.join(' ').trim(), typo: null })
    question = null
    answer = []
  }
  for (const line of lines) {
    const heading = markdownHeading(line)
    if (heading !== null) {
      const { level, text } = heading
      if (level <= 2) {
        flush()
        inFaq = isFaqHeading(text)
        continue
      }
      if (!inFaq) continue
      flush()
      if (text.includes('?')) question = text
      continue
    }
    if (inFaq && question !== null && line.trim().length > 0) answer.push(line.trim())
  }
  flush()
  return faqs.filter((faq) => faq.question.length > 0)
}

function countMarkdownTables(lines: readonly string[]): number {
  let count = 0
  let inTable = false
  for (const line of lines) {
    const row = isTableRow(line)
    if (row && !inTable) {
      count += 1
      inTable = true
    } else if (!row) {
      inTable = false
    }
  }
  return count
}

interface HtmlHeading {
  level: number
  text: string
  /** Index of the open tag in the HTML. */
  start: number
  /** Index after the closing tag. */
  end: number
}

function htmlHeadings(html: string, tags: readonly HtmlTag[]): HtmlHeading[] {
  const headings: HtmlHeading[] = []
  let open: { name: string; level: number; start: number; contentStart: number } | null = null
  for (const tag of tags) {
    const level = headingLevel(tag.name)
    if (level === null) continue
    if (!tag.closing) {
      if (open === null) open = { name: tag.name, level, start: tag.start, contentStart: tag.end }
      continue
    }
    if (open === null || open.name !== tag.name) continue
    const text = visibleTextBetween(html, tags, open.contentStart, tag.start)
    if (text.length > 0) headings.push({ level: open.level, text, start: open.start, end: tag.end })
    open = null
  }
  return headings
}

function headingLevel(name: string): number | null {
  if (name.length !== 2 || name[0] !== 'h') return null
  const level = Number(name[1])
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null
}

function mainText(
  html: string,
  tags: readonly HtmlTag[],
  headings: readonly HtmlHeading[]
): string {
  const main = outermostElements(html, tags, 'main')[0]
  if (main !== undefined) return visibleTextBetween(html, tags, main.contentStart, main.contentEnd)
  const articles = outermostElements(html, tags, 'article')
  if (articles.length === 0) return visibleTextBetween(html, tags, 0, html.length)
  const h1 = headings.find((heading) => heading.level === 1)
  const holder =
    h1 === undefined
      ? undefined
      : articles.find((range) => h1.start >= range.contentStart && h1.start < range.contentEnd)
  if (holder !== undefined) {
    return visibleTextBetween(html, tags, holder.contentStart, holder.contentEnd)
  }
  let best = ''
  for (const range of articles) {
    const text = visibleTextBetween(html, tags, range.contentStart, range.contentEnd)
    if (text.length > best.length) best = text
  }
  return best
}

function jsonLdValues(tags: readonly HtmlTag[]): unknown[] {
  const values: unknown[] = []
  for (const tag of tags) {
    if (tag.name !== 'script' || tag.rawText === null) continue
    if ((tag.attrs.type ?? '').trim().toLowerCase() !== 'application/ld+json') continue
    try {
      values.push(JSON.parse(tag.rawText) as unknown)
    } catch {
      // A broken JSON-LD block is ignored. The FAQ heading is the other source.
    }
  }
  return values
}

function faqsFromJsonLd(values: readonly unknown[]): PageFaq[] {
  const faqs: PageFaq[] = []
  for (const value of values) collectFaq(value, faqs)
  return faqs
}

/** The first string under `key`, walking arrays, objects, and `@graph` a few levels deep. */
function jsonLdString(values: readonly unknown[], key: string): string | null {
  const walk = (value: unknown, depth: number): string | null => {
    if (depth > 8) return null
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1)
        if (found !== null) return found
      }
      return null
    }
    if (!isRecord(value)) return null
    const direct = stringOrNull(value[key])
    if (direct !== null) return direct
    for (const nested of Object.values(value)) {
      const found = walk(nested, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  return walk(values, 0)
}

function collectFaq(value: unknown, faqs: PageFaq[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFaq(item, faqs)
    return
  }
  if (!isRecord(value)) return
  const type = value['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.includes('FAQPage') && Array.isArray(value.mainEntity)) {
    for (const entity of value.mainEntity) faqFromQuestion(entity, faqs)
  }
  if (isRecord(value['@graph'])) collectFaq(value['@graph'], faqs)
  if (Array.isArray(value['@graph'])) collectFaq(value['@graph'], faqs)
}

function faqFromQuestion(value: unknown, faqs: PageFaq[]): void {
  if (!isRecord(value) || typeof value.name !== 'string') return
  const answer = isRecord(value.acceptedAnswer) ? value.acceptedAnswer.text : null
  faqs.push({
    question: collapse(decodeEntities(value.name)),
    answer: typeof answer === 'string' ? htmlToText(answer) : '',
    typo: null
  })
}

/** JSON-LD answers often carry HTML. Tags become spaces; entities are decoded. */
function htmlToText(value: string): string {
  return collapse(decodeEntities(value.replace(/<[^>]*>/g, ' ')))
}

/** The FAQ heading's section: from it to the next heading at its level or above. */
interface FaqSection {
  heading: HtmlHeading
  end: number
}

function faqSection(html: string, headings: readonly HtmlHeading[]): FaqSection | null {
  const index = headings.findIndex((heading) => heading.level <= 3 && isFaqHeading(heading.text))
  const heading = headings[index]
  if (heading === undefined) return null
  const next = headings.slice(index + 1).find((item) => item.level <= heading.level)
  return { heading, end: next?.start ?? html.length }
}

/**
 * FAQs on a page without FAQPage JSON-LD (FR-2.2), in order of preference:
 * `<details>`/`<summary>` accordions (the summary is the question, the rest the answer),
 * then question headings inside the FAQ section with the content up to the next heading.
 * A question-shaped heading elsewhere in the body is not an FAQ.
 */
function faqsFromHtml(
  html: string,
  tags: readonly HtmlTag[],
  headings: readonly HtmlHeading[]
): PageFaq[] {
  const section = faqSection(html, headings)
  const accordions = faqsFromDetails(html, tags, section)
  if (accordions.length > 0) return accordions
  if (section === null) return []
  const inside = headings.filter(
    (heading) =>
      heading.start > section.heading.start &&
      heading.start < section.end &&
      heading.level > section.heading.level
  )
  const faqs: PageFaq[] = []
  inside.forEach((heading, index) => {
    if (!heading.text.includes('?')) return
    const until = Math.min(inside[index + 1]?.start ?? section.end, section.end)
    faqs.push({
      question: heading.text,
      answer: visibleTextBetween(html, tags, heading.end, until),
      typo: null
    })
  })
  return faqs
}

function faqsFromDetails(
  html: string,
  tags: readonly HtmlTag[],
  section: FaqSection | null
): PageFaq[] {
  const summaries = outermostElements(html, tags, 'summary')
  const faqs: PageFaq[] = []
  for (const details of outermostElements(html, tags, 'details')) {
    const opened = tags[details.tagIndex]?.start ?? details.contentStart
    if (section !== null && (opened < section.heading.start || opened >= section.end)) continue
    const summary = summaries.find(
      (item) => item.contentStart >= details.contentStart && item.contentEnd <= details.contentEnd
    )
    if (summary === undefined) continue
    const question = visibleTextBetween(html, tags, summary.contentStart, summary.contentEnd)
    if (question.length === 0 || (section === null && !question.includes('?'))) continue
    const closing = tags.find(
      (tag) => tag.closing && tag.name === 'summary' && tag.start === summary.contentEnd
    )
    const answer = visibleTextBetween(
      html,
      tags,
      closing?.end ?? summary.contentEnd,
      details.contentEnd
    )
    faqs.push({ question, answer, typo: null })
  }
  return faqs
}

function rawTitle(tags: readonly HtmlTag[]): string {
  const title = tags.find((tag) => tag.name === 'title' && tag.rawText !== null)
  return collapse(decodeEntities(title?.rawText ?? ''))
}

function metaContent(metas: readonly HtmlTag[], name: string): string | null {
  const wanted = name.toLowerCase()
  for (const meta of metas) {
    const names = [meta.attrs.name, meta.attrs.property]
    if (!names.some((value) => (value ?? '').trim().toLowerCase() === wanted)) continue
    const value = (meta.attrs.content ?? '').trim()
    if (value.length > 0) return decodeEntities(value)
  }
  return null
}

function canonicalHref(tags: readonly HtmlTag[]): string | null {
  for (const tag of tags) {
    if (tag.closing || tag.name !== 'link') continue
    if ((tag.attrs.rel ?? '').trim().toLowerCase() !== 'canonical') continue
    const href = (tag.attrs.href ?? '').trim()
    if (href.length > 0) return decodeEntities(href)
  }
  return null
}

function timeDatetime(tags: readonly HtmlTag[]): string | null {
  for (const tag of tags) {
    if (tag.closing || tag.name !== 'time') continue
    const value = (tag.attrs.datetime ?? '').trim()
    if (value.length > 0) return decodeEntities(value)
  }
  return null
}

/** A `#` heading line, or null. Parsed without a backtracking pattern. */
function markdownHeading(line: string): { level: number; text: string } | null {
  let level = 0
  while (level < line.length && line[level] === '#') level += 1
  if (level < 1 || level > 6) return null
  const rest = line.slice(level)
  if (!/^\s/.test(rest)) return null
  const text = rest.trim()
  return text.length === 0 ? null : { level, text }
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length >= 2 && trimmed.startsWith('|') && trimmed.endsWith('|')
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clip(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd()
}

/** A date the reader gave (Jina's envelope), else the one the page text states. */
function givenOr(given: string | null | undefined, visible: string | null): string {
  const trimmed = (given ?? '').trim()
  return trimmed.length > 0 ? trimmed : (visible ?? '')
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null
  return value.length === 0 ? null : value
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
