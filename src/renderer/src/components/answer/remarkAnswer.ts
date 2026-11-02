import { brandRuns, type BrandLens } from '@shared/brand-mentions'
import type { Plugin } from 'unified'

/** One source a citation chip opens. */
export interface Cite {
  url: string
  /** The link text, which is the page title the engine showed. */
  title: string
}

/** Class on a section title promoted to a heading. */
export const SECTION_CLASS = 'ans-sub'
/** Class on the span that stands in for a run of citation links. */
export const CITES_CLASS = 'ans-cites'
/** Longest line, in characters and words, that still reads as a section title. */
const TITLE_MAX_CHARS = 80
const TITLE_MAX_WORDS = 12
/** Text before a citation ends a sentence or a clause: "… alerts." "… (2026):" */
const SENTENCE_END = /[.!?:;)\]"'”’]\s*$/

type MdNode = {
  type: string
  value?: string
  url?: string
  depth?: number
  children?: MdNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
    hChildren?: unknown[]
  }
}

/**
 * Shapes a parsed AI answer the way the engine showed it: short standalone
 * lines become section headings, links an answer puts after a sentence become
 * source chips, and the brand and own site are marked in yellow.
 */
export const remarkAnswer: Plugin<[{ lens: BrandLens | null }]> =
  ({ lens }) =>
  (tree) => {
    const root = tree as MdNode
    promoteSectionTitles(root)
    groupCitations(root, false)
    if (lens) markBrand(root, lens)
  }

/** Reads the cites a chip span carries. Malformed data gives none. */
export function readCites(value: unknown): Cite[] {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Cite =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Cite).url === 'string' &&
        typeof (item as Cite).title === 'string'
    )
  } catch {
    return []
  }
}

/**
 * A top-level paragraph of one short line with no closing punctuation and
 * something under it, such as "Comparison Summary", is a section title. Google's
 * overviews, as cloro stores them, have no `#` headings; an answer that has
 * them (ChatGPT) keeps its bold lines as they are.
 */
function promoteSectionTitles(root: MdNode): void {
  const blocks = root.children ?? []
  if (blocks.some((block) => block.type === 'heading')) return
  blocks.forEach((block, index) => {
    if (block.type !== 'paragraph' || index === blocks.length - 1) return
    if (!(block.children ?? []).every(isPlainPhrasing)) return
    const text = textOf(block).trim()
    if (text === '' || text.includes('\n') || text.length > TITLE_MAX_CHARS) return
    if (text.split(/\s+/).length > TITLE_MAX_WORDS || /[.!?:;,]$/.test(text)) return
    block.type = 'heading'
    block.depth = 1
    block.data = { hProperties: { className: [SECTION_CLASS] } }
  })
}

function isPlainPhrasing(node: MdNode): boolean {
  if (node.type === 'text') return true
  if (node.type === 'strong' || node.type === 'emphasis') {
    return (node.children ?? []).every(isPlainPhrasing)
  }
  return false
}

/**
 * Turns each run of citation links into one chip span. A run is links with
 * nothing but spaces between them. It is a citation when it follows a finished
 * sentence, when several links sit together, or when it ends a paragraph or a
 * list line after some text. A link inside a sentence, or a link on its own
 * line, stays an ordinary link. In a table cell only the first two rules apply.
 */
function groupCitations(node: MdNode, inCell: boolean): void {
  const children = node.children
  if (!children) return
  const cell = inCell || node.type === 'tableCell'
  for (const child of children) groupCitations(child, cell)
  if (!children.some((child) => child.type === 'link')) return
  const out: MdNode[] = []
  let index = 0
  while (index < children.length) {
    const child = children[index]
    if (child?.type !== 'link') {
      if (child) out.push(child)
      index += 1
      continue
    }
    const run: MdNode[] = []
    let end = index
    while (end < children.length) {
      const next = children[end]
      if (next?.type === 'link') {
        run.push(next)
        end += 1
      } else if (
        next?.type === 'text' &&
        isBlank(next.value) &&
        children[end + 1]?.type === 'link'
      ) {
        end += 1
      } else {
        break
      }
    }
    const before = out.map(textOf).join('')
    const after = children.slice(end).map(textOf).join('')
    const hasText = before.trim() !== ''
    const endsBlock = after.trim() === ''
    const isCitation =
      hasText && (SENTENCE_END.test(before) || run.length > 1 || (!cell && endsBlock))
    if (isCitation) out.push(citeNode(run))
    else out.push(...children.slice(index, end))
    index = end
  }
  node.children = out
}

function citeNode(links: readonly MdNode[]): MdNode {
  const seen = new Set<string>()
  const cites: Cite[] = []
  for (const link of links) {
    const url = link.url ?? ''
    if (url === '' || seen.has(url)) continue
    seen.add(url)
    cites.push({ url, title: textOf(link).trim() })
  }
  return {
    type: 'citeGroup',
    data: {
      hName: 'span',
      hProperties: { className: [CITES_CLASS], dataCites: JSON.stringify(cites) },
      hChildren: []
    }
  }
}

/** Wraps every brand name and own-domain mention in plain text in a yellow mark. */
function markBrand(node: MdNode, lens: BrandLens): void {
  const children = node.children
  if (!children) return
  const out: MdNode[] = []
  for (const child of children) {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      markBrand(child, lens)
      out.push(child)
      continue
    }
    for (const run of brandRuns(child.value, lens)) {
      out.push(
        run.marked
          ? {
              type: 'brandMark',
              data: { hName: 'mark', hProperties: { className: ['aio-brand'] } },
              children: [{ type: 'text', value: run.text }]
            }
          : { type: 'text', value: run.text }
      )
    }
  }
  node.children = out
}

function textOf(node: MdNode): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(textOf).join('')
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}
