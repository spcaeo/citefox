import type { EvidencePage } from '../prompts/blocks'
import { cleanPageText } from './competitor-page'
import type { SiteRead } from './records'
import { pathOf } from './site'

/**
 * The site's own pages as evidence for the keyword and competitor steps
 * (Docs/PROMPT-AUDIT.md, package P4): pages that were really read (a "page could not
 * be found" read is dropped), each cut to the paragraphs that share the most words
 * with the step's subject, so a long homepage still shows its relevant parts. Pure.
 *
 * Package P3's `topicEvidence(seed, draft)` picks pages for the topic; this picks the
 * paragraphs within pages, and can take P3's pages once that lands.
 */

const NOT_FOUND =
  /\b(?:404|page (?:could )?not (?:be )?found|page not found|not found|page doesn['’]t exist)\b/iu

/** True when a read is a real page: ok, with words, and not a "not found" page. */
export function isRealRead(read: SiteRead): boolean {
  if (!read.ok || read.wordCount < 5) return false
  const head = `${read.title ?? ''} ${read.h1 ?? ''}`
  return !NOT_FOUND.test(head)
}

const STOP = new Set(
  'a about all also an and any are as at be been but by can do does each for from get has have how i if in into is it its just like make more most my no not of on one or our out so than that the their them then there these they this to up us use was we what when where which who why will with without you your'.split(
    ' '
  )
)

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

/** Paragraphs of a page: Markdown blocks split on blank lines or headings. */
function paragraphs(text: string): string[] {
  return cleanPageText(text, 40000)
    .split(/\n(?=#)|\n{2,}/u)
    .flatMap((block) => (block.length > 900 ? block.split('\n') : [block]))
    .map((block) => block.replace(/\s+/gu, ' ').trim())
    .filter((block) => block.length >= 12)
}

/**
 * Up to `perPage` characters of a page: its opening paragraph, then the paragraphs
 * with the most subject words, put back in page order.
 */
export function relevantExcerpt(text: string, subject: string, perPage: number): string {
  const blocks = paragraphs(text)
  if (blocks.length === 0) return ''
  const wanted = new Set(words(subject))
  const scored = blocks.map((block, index) => {
    const have = words(block)
    const hits = have.filter((word) => wanted.has(word)).length
    return { block, index, score: hits / Math.sqrt(Math.max(1, have.length)) }
  })
  const picked = new Set<number>([0])
  let used = blocks[0]?.length ?? 0
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used >= perPage) break
    if (picked.has(item.index) || item.score === 0) continue
    picked.add(item.index)
    used += item.block.length + 1
  }
  const out = [...picked]
    .sort((a, b) => a - b)
    .map((index) => blocks[index] ?? '')
    .join('\n')
  return out.length <= perPage ? out : `${out.slice(0, perPage - 1).trimEnd()}…`
}

/** The real pages of the site, each cut to what matters for `subject`. */
export function ownEvidencePages(
  reads: readonly SiteRead[],
  subject: string,
  perPage: number
): EvidencePage[] {
  return reads.filter(isRealRead).map((read) => ({
    path: pathOf(read.url),
    title: read.title,
    text: relevantExcerpt(read.text, subject, perPage)
  }))
}
