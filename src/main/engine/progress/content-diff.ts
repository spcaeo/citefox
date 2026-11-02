import type { ContentDiff, ContentFieldChange, DiffLine, OutlineEntry } from '@shared/domain'
import type { StoredSnapshot } from '../../storage/snapshot-records'
import { contentChangeBetween } from '../checks/score'

/**
 * FR-15.1 "Compare content". A readable diff of two page reads: title, meta
 * description, H1, the outline, FAQs, and the body by sentence. Pure: the
 * caller loads both snapshots. Text stays untrusted; the renderer escapes it.
 */

/** Lines per side the body diff looks at. Longer bodies are cut and flagged. */
export const MAX_DIFF_LINES = 1500

export function diffSnapshots(
  pageId: string,
  from: StoredSnapshot,
  to: StoredSnapshot
): ContentDiff {
  const fromBody = bodyLines(from.bodyText)
  const toBody = bodyLines(to.bodyText)
  const bodyTruncated = fromBody.length > MAX_DIFF_LINES || toBody.length > MAX_DIFF_LINES
  return {
    pageId,
    from: stamp(from),
    to: stamp(to),
    summary: contentChangeBetween(facts(from), facts(to)).summary,
    fields: [
      field('title', 'Title', from.title, to.title),
      field('meta_description', 'Meta description', from.metaDescription, to.metaDescription),
      field('h1', 'H1', from.h1, to.h1)
    ],
    outline: diffLines(from.outline.map(outlineLine), to.outline.map(outlineLine)),
    faqs: diffLines(faqLines(from), faqLines(to)),
    body: diffLines(fromBody.slice(0, MAX_DIFF_LINES), toBody.slice(0, MAX_DIFF_LINES)),
    bodyTruncated
  }
}

/** Paragraphs, then sentences, trimmed. Blank lines are dropped. */
export function bodyLines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Longest-common-subsequence diff. The shared head and tail are matched first,
 * so a small edit in a long page only compares the changed middle.
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1
  }
  const lines: DiffLine[] = before.slice(0, head).map((text) => ({ op: 'same', text }))
  lines.push(
    ...middleDiff(before.slice(head, before.length - tail), after.slice(head, after.length - tail))
  )
  lines.push(...before.slice(before.length - tail).map((text): DiffLine => ({ op: 'same', text })))
  return lines
}

function middleDiff(before: readonly string[], after: readonly string[]): DiffLine[] {
  const rows = before.length
  const cols = after.length
  if (rows === 0) return after.map((text) => ({ op: 'added', text }))
  if (cols === 0) return before.map((text) => ({ op: 'removed', text }))
  // table[i][j] = LCS length of before[i..] and after[j..].
  const width = cols + 1
  const table = new Uint32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    const left = before[i] ?? ''
    const right = after[j] ?? ''
    if (left === right) {
      lines.push({ op: 'same', text: left })
      i += 1
      j += 1
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      lines.push({ op: 'removed', text: left })
      i += 1
    } else {
      lines.push({ op: 'added', text: right })
      j += 1
    }
  }
  for (; i < rows; i += 1) lines.push({ op: 'removed', text: before[i] ?? '' })
  for (; j < cols; j += 1) lines.push({ op: 'added', text: after[j] ?? '' })
  return lines
}

function outlineLine(entry: OutlineEntry): string {
  const table = entry.table ? ' (table)' : ''
  if (entry.level === 'h2') return `H2 ${entry.text}${table}`
  if (entry.level === 'h3') return `  H3 ${entry.text}${table}`
  if (entry.level === 'box') return `  Box: ${entry.text}${table}`
  if (entry.level === 'cta') return `  Button: ${entry.text}${table}`
  return `  ${entry.text}${table}`
}

function faqLines(snapshot: StoredSnapshot): string[] {
  return snapshot.faqs.flatMap((faq) => [`Q: ${faq.question}`, `A: ${faq.answer}`])
}

function field(
  name: ContentFieldChange['field'],
  label: string,
  before: string | null,
  after: string | null
): ContentFieldChange {
  return { field: name, label, before, after, changed: (before ?? '') !== (after ?? '') }
}

function stamp(snapshot: StoredSnapshot): ContentDiff['from'] {
  return {
    id: snapshot.id,
    fetchedAt: snapshot.fetchedAt,
    wordCount: snapshot.wordCount,
    faqCount: snapshot.faqs.length
  }
}

export function facts(snapshot: StoredSnapshot): {
  faqs: number
  words: number
  h2: number
  h3: number
} {
  return {
    faqs: snapshot.faqs.length,
    words: snapshot.wordCount,
    h2: snapshot.h2Count,
    h3: snapshot.h3Count
  }
}
