import type { PageBlock, PageBlockKind } from './ipc/fixLoop'
import { pluralize } from './pluralize'

/**
 * Two reads of one page, block by block (page change history): which blocks are
 * new, gone or reworded, each with the heading it sits under. Noise is not a
 * change: spacing, letter case, curly quotes and dates ("Updated Oct 28, 2026")
 * compare equal, and the footer from its "©" line on is left out. Pure.
 */

export type BlockDiffOp = 'same' | 'added' | 'removed' | 'changed'

export interface BlockDiffItem {
  op: BlockDiffOp
  kind: PageBlockKind
  /** The block on the older read (same, removed, changed). */
  before: string | null
  /** The block on the newer read (same, added, changed). */
  after: string | null
  /** The heading the block sits under, for context. Null above the first heading. */
  section: string | null
}

export interface BlockDiffCounts {
  /** New headings (H2 to H4): new sections. */
  sectionsAdded: number
  sectionsRemoved: number
  /** Headings reworded, the H1 included. */
  headingsChanged: number
  /** Text blocks new, gone or reworded outside new and removed sections. */
  textChanged: number
}

export interface BlockDiff {
  items: BlockDiffItem[]
  counts: BlockDiffCounts
}

export const NO_COUNTS: BlockDiffCounts = {
  sectionsAdded: 0,
  sectionsRemoved: 0,
  headingsChanged: 0,
  textChanged: 0
}

/** Word overlap (Dice) at which a removed and an added block read as one reworded block. */
const PAIR_AT = 0.4

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+\\d{4})?\\b`, 'gi'),
  new RegExp(`\\b${MONTH}\\s+\\d{4}\\b`, 'gi'),
  /\b\d{4}-\d{2}-\d{2}(?:t[\d:.]+z?)?\b/gi,
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
  /\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi
]

/** The page's own content: the footer, from its "©" or "Copyright" line on, is left out. */
export function contentBlocks(blocks: readonly PageBlock[]): PageBlock[] {
  const footer = blocks.findIndex(
    (block, index) => index > 0 && /^(?:©|\(c\)\s|copyright\b)/i.test(block.text.trim())
  )
  return footer < 0 ? [...blocks] : blocks.slice(0, footer)
}

/** What a block is compared by: words only, with every date the same. */
export function blockKey(text: string): string {
  let key = text
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .toLowerCase()
  for (const pattern of DATE_PATTERNS) key = key.replace(pattern, '#date')
  return key.replace(/\s+/g, ' ').trim()
}

export function isHeading(kind: PageBlockKind): boolean {
  return kind === 'h1' || kind === 'h2' || kind === 'h3' || kind === 'h4'
}

/** The older read's blocks against the newer read's. Footers are dropped first. */
export function diffBlocks(older: readonly PageBlock[], newer: readonly PageBlock[]): BlockDiff {
  const a = contentBlocks(older)
  const b = contentBlocks(newer)
  const steps = lcsSteps(
    a.map((block) => `${headingClass(block.kind)}|${blockKey(block.text)}`),
    b.map((block) => `${headingClass(block.kind)}|${blockKey(block.text)}`)
  )
  const items: BlockDiffItem[] = []
  let removed: PageBlock[] = []
  let added: PageBlock[] = []
  const flush = (): void => {
    items.push(...hunkItems(removed, added))
    removed = []
    added = []
  }
  for (const step of steps) {
    if (step.op === 'removed') removed.push(a[step.at] as PageBlock)
    else if (step.op === 'added') added.push(b[step.at] as PageBlock)
    else {
      flush()
      const block = b[step.at] as PageBlock
      items.push({
        op: 'same',
        kind: block.kind,
        before: (a[step.from] as PageBlock).text,
        after: block.text,
        section: null
      })
    }
  }
  flush()
  return withSections(items)
}

/** True when nothing but noise changed. */
export function isTrivial(diff: Pick<BlockDiff, 'counts'>): boolean {
  const { counts } = diff
  return (
    counts.sectionsAdded + counts.sectionsRemoved + counts.headingsChanged + counts.textChanged ===
    0
  )
}

/** "2 sections are new, 1 heading changed." One sentence, for the banner and the list. */
export function diffSentence(counts: BlockDiffCounts): string {
  const parts: string[] = []
  if (counts.sectionsAdded > 0) {
    parts.push(
      counts.sectionsAdded === 1 ? '1 section is new' : `${counts.sectionsAdded} sections are new`
    )
  }
  if (counts.sectionsRemoved > 0) {
    parts.push(
      counts.sectionsRemoved === 1
        ? '1 section was removed'
        : `${counts.sectionsRemoved} sections were removed`
    )
  }
  if (counts.headingsChanged > 0) {
    parts.push(`${pluralize(counts.headingsChanged, 'heading')} changed`)
  }
  if (counts.textChanged > 0) {
    parts.push(`text changed in ${pluralize(counts.textChanged, 'place')}`)
  }
  if (parts.length === 0) return 'Only small changes, such as dates or spacing.'
  const sentence =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `${capitalise(sentence ?? '')}.`
}

/** The headings of the sections that changed, in page order, at most `max`. */
export function changedSections(diff: BlockDiff, max = 4): string[] {
  const out: string[] = []
  for (const item of diff.items) {
    if (item.op === 'same') continue
    const name = isHeading(item.kind) ? (item.after ?? item.before) : item.section
    if (name && !out.includes(name)) out.push(name)
    if (out.length >= max) break
  }
  return out
}

/**
 * A short fix description from a change: the sentence, then the sections it
 * touched ("Changed: Pricing, FAQ."). For "Log as fix".
 */
export function fixTextFor(diff: BlockDiff): string {
  const sections = changedSections(diff)
  const sentence = diffSentence(diff.counts)
  return sections.length === 0 ? sentence : `${sentence} Changed: ${sections.join(', ')}.`
}

type Step =
  | { op: 'same'; from: number; at: number }
  | { op: 'removed'; at: number }
  | { op: 'added'; at: number }

/** The longest common run of keys, as same / removed / added steps in reading order. */
function lcsSteps(a: readonly string[], b: readonly string[]): Step[] {
  const n = a.length
  const m = b.length
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0)
    }
  }
  const steps: Step[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      steps.push({ op: 'same', from: i, at: j })
      i += 1
      j += 1
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      steps.push({ op: 'removed', at: i })
      i += 1
    } else {
      steps.push({ op: 'added', at: j })
      j += 1
    }
  }
  for (; i < n; i += 1) steps.push({ op: 'removed', at: i })
  for (; j < m; j += 1) steps.push({ op: 'added', at: j })
  return steps
}

/**
 * One run of removed and added blocks between unchanged ones. A removed block and
 * a later added block of the same class (heading or text) whose words mostly
 * match read as one reworded block; order is kept.
 */
function hunkItems(removed: readonly PageBlock[], added: readonly PageBlock[]): BlockDiffItem[] {
  const pairOf = new Map<number, number>()
  let next = 0
  removed.forEach((block, r) => {
    for (let k = next; k < added.length; k += 1) {
      const other = added[k] as PageBlock
      if (headingClass(other.kind) !== headingClass(block.kind)) continue
      if (dice(block.text, other.text) >= PAIR_AT) {
        pairOf.set(r, k)
        next = k + 1
        return
      }
    }
  })
  const paired = new Set(pairOf.values())
  const items: BlockDiffItem[] = []
  let r = 0
  let k = 0
  while (r < removed.length || k < added.length) {
    const partner = pairOf.get(r)
    if (r < removed.length && partner === undefined) {
      const block = removed[r] as PageBlock
      items.push({
        op: 'removed',
        kind: block.kind,
        before: block.text,
        after: null,
        section: null
      })
      r += 1
    } else if (k < added.length && (!paired.has(k) || partner !== k)) {
      const block = added[k] as PageBlock
      items.push({ op: 'added', kind: block.kind, before: null, after: block.text, section: null })
      k += 1
    } else {
      const before = removed[r] as PageBlock
      const after = added[k] as PageBlock
      items.push({
        op: 'changed',
        kind: after.kind,
        before: before.text,
        after: after.text,
        section: null
      })
      r += 1
      k += 1
    }
  }
  return items
}

/** Each item's section, and the counts (text inside a new or removed section counts once, as that section). */
function withSections(items: BlockDiffItem[]): BlockDiff {
  const counts = { ...NO_COUNTS }
  let section: string | null = null
  let sectionOp: BlockDiffOp = 'same'
  const out = items.map((item): BlockDiffItem => {
    if (isHeading(item.kind)) {
      if (item.kind !== 'h1') {
        section = item.after ?? item.before
        sectionOp = item.op
      }
      if (item.op === 'changed') counts.headingsChanged += 1
      else if (item.kind !== 'h1' && item.op === 'added') counts.sectionsAdded += 1
      else if (item.kind !== 'h1' && item.op === 'removed') counts.sectionsRemoved += 1
      else if (item.kind === 'h1' && item.op !== 'same') counts.headingsChanged += 1
      return { ...item, section: item.kind === 'h1' ? null : section }
    }
    const inMovedSection = sectionOp === 'added' || sectionOp === 'removed'
    if (item.op !== 'same' && !inMovedSection) counts.textChanged += 1
    return { ...item, section }
  })
  return { items: out, counts }
}

function headingClass(kind: PageBlockKind): 'heading' | 'text' {
  return isHeading(kind) ? 'heading' : 'text'
}

function words(text: string): Set<string> {
  return new Set(
    blockKey(text)
      .split(/[^\p{L}\p{N}#']+/u)
      .filter((word) => word.length > 0)
  )
}

function dice(left: string, right: string): number {
  const a = words(left)
  const b = words(right)
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return (2 * shared) / (a.size + b.size)
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`
}
