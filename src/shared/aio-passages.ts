import { segmentsText, type AioBlock, type AioListItem, type AioOverview } from './aio-overview'

/**
 * The overview as passages in reading order: each paragraph, heading, list item and
 * table with the citations it carries and the heading it sits under. Ids follow the
 * block tree ("b3", "b10.i0", "b4.0"), and the renderer gives each passage the same id
 * (`data-passage`), so a line in the insights card can point at its passage.
 */

export type PassageKind = 'paragraph' | 'heading' | 'item' | 'table' | 'summary'

export interface AioPassage {
  id: string
  kind: PassageKind
  /** Plain text. A list item's label leads it ("Pros: …"); a table is its cells in rows. */
  text: string
  /** `AioSource.index` values the passage cites. */
  refs: readonly number[]
  /** The heading above it, or null for the passages before the first heading. */
  section: string | null
  /** 1-based place among the passages that are not headings. 0 for a heading. */
  order: number
}

/** The id of the block at `index` under `parent` (null at the top). */
export function blockPassageId(parent: string | null, index: number): string {
  return parent === null ? `b${index}` : `${parent}.${index}`
}

/** The id of list item `index` in the list block `listId`. */
export function itemPassageId(listId: string, index: number): string {
  return `${listId}.i${index}`
}

/** Every passage of the overview, in reading order. */
export function overviewPassages(overview: Pick<AioOverview, 'blocks'>): AioPassage[] {
  const out: AioPassage[] = []
  const state = { section: null as string | null, order: 0 }
  const push = (passage: Omit<AioPassage, 'section' | 'order'>): void => {
    if (passage.text.trim().length === 0 && passage.refs.length === 0) return
    if (passage.kind === 'heading') {
      state.section = passage.text.trim()
      out.push({ ...passage, section: state.section, order: 0 })
      return
    }
    state.order += 1
    out.push({ ...passage, section: state.section, order: state.order })
  }
  walkBlocks(overview.blocks, null, push)
  return out
}

function walkBlocks(
  blocks: readonly AioBlock[],
  parent: string | null,
  push: (passage: Omit<AioPassage, 'section' | 'order'>) => void
): void {
  blocks.forEach((block, index) => {
    const id = blockPassageId(parent, index)
    switch (block.kind) {
      case 'heading':
        push({ id, kind: 'heading', text: segmentsText(block.text), refs: [] })
        return
      case 'paragraph':
        push({ id, kind: 'paragraph', text: segmentsText(block.text), refs: block.refs })
        return
      case 'table':
        push({
          id,
          kind: 'table',
          text: [block.header, ...block.rows]
            .map((row) => row.filter((cell) => cell.length > 0).join(' · '))
            .filter((row) => row.length > 0)
            .join('\n'),
          refs: block.refs
        })
        return
      case 'list':
        block.items.forEach((item, itemIndex) => walkItem(item, itemPassageId(id, itemIndex), push))
        return
      case 'expandable':
        push({ id, kind: 'summary', text: block.title, refs: [] })
        walkBlocks(block.blocks, id, push)
        return
    }
  })
}

function walkItem(
  item: AioListItem,
  id: string,
  push: (passage: Omit<AioPassage, 'section' | 'order'>) => void
): void {
  const body = segmentsText(item.text)
  const text = item.label ? `${item.label}:${body.length > 0 ? ` ${body}` : ''}` : body
  push({ id, kind: 'item', text, refs: item.refs })
  if (item.children.length > 0) walkBlocks(item.children, id, push)
}

/** The sentence around `offset` in a passage, trimmed: the quote a line shows. */
export function sentenceAt(text: string, offset: number): string {
  const breaks = /[.!?](?=\s+[\p{Lu}\p{N}"“(])|\n/gu
  let start = 0
  let end = text.length
  for (const match of text.matchAll(breaks)) {
    const at = match.index + match[0].length
    if (at <= offset) start = at
    else {
      end = at
      break
    }
  }
  return text.slice(start, end).trim()
}

/** A short handle for a passage: its heading, else its first words. */
export function passageLabel(passage: Pick<AioPassage, 'section' | 'text'>, words = 7): string {
  if (passage.section) return passage.section
  const parts = passage.text.trim().split(/\s+/u)
  const lead = parts.slice(0, words).join(' ')
  return parts.length > words ? `${lead}…` : lead
}

/** An overview from the flattened text alone: one paragraph per line, no citations. */
export function overviewFromText(text: string): Pick<AioOverview, 'blocks'> {
  const blocks: AioBlock[] = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ kind: 'paragraph', text: [{ kind: 'text', text: line }], refs: [] }))
  return { blocks }
}
