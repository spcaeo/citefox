import type { PageBlock, PageBlockKind } from '@shared/ipc'

/**
 * A page as blocks in reading order (headings, paragraphs, list items, quotes,
 * code and tables), for the Page edits tab and its prompt. A site read keeps the
 * page's markdown; a tracked page's snapshot keeps plain text and its outline, so
 * a line equal to an outline heading becomes that heading.
 */

/** Most blocks a page keeps; the rest of a very long page is left out. */
export const MAX_PAGE_BLOCKS = 250
/** Characters one block keeps. */
export const BLOCK_TEXT_MAX = 2000

type Draft = { kind: PageBlockKind; text: string }

/** Blocks from markdown (a site read). */
export function blocksFromMarkdown(markdown: string): PageBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: Draft[] = []
  let paragraph: string[] = []
  let table: string[] = []
  let code: string[] | null = null
  const flushParagraph = (): void => {
    if (paragraph.length > 0) out.push({ kind: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushTable = (): void => {
    if (table.length > 0) out.push({ kind: 'table', text: table.join('\n') })
    table = []
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (code !== null) {
      if (/^\s*```/.test(line)) {
        out.push({ kind: 'code', text: code.join('\n') })
        code = null
      } else code.push(raw)
      continue
    }
    if (/^\s*```/.test(line)) {
      flushParagraph()
      flushTable()
      code = []
      continue
    }
    const trimmed = line.trim()
    if (trimmed.startsWith('|')) {
      flushParagraph()
      table.push(trimmed)
      continue
    }
    flushTable()
    if (trimmed.length === 0) {
      flushParagraph()
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      out.push({ kind: headingKind(heading[1]?.length ?? 2), text: heading[2] ?? '' })
      continue
    }
    const item = /^(?:[-*+]|\d{1,3}[.)])\s+(.+)$/.exec(trimmed)
    if (item) {
      flushParagraph()
      out.push({ kind: 'li', text: item[1] ?? '' })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flushParagraph()
      const last = out.at(-1)
      if (last?.kind === 'quote' && paragraph.length === 0) last.text += ` ${quote[1] ?? ''}`
      else out.push({ kind: 'quote', text: quote[1] ?? '' })
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      continue
    }
    paragraph.push(trimmed)
  }
  if (code !== null) out.push({ kind: 'code', text: code.join('\n') })
  flushParagraph()
  flushTable()
  return finish(out.map((block) => ({ ...block, text: cleanInline(block) })))
}

/**
 * Blocks from plain text and its outline (a tracked page's snapshot): a line equal
 * to the H1 or to an h2/h3 outline entry becomes that heading; the rest are paragraphs.
 */
export function blocksFromText(
  text: string,
  outline: readonly { level: string; text: string }[],
  h1: string | null = null
): PageBlock[] {
  const kinds = new Map<string, PageBlockKind>()
  const h1Key = squash(h1 ?? '').toLowerCase()
  if (h1Key.length > 0) kinds.set(h1Key, 'h1')
  for (const entry of outline) {
    const key = squash(entry.text).toLowerCase()
    if (entry.level !== 'h2' && entry.level !== 'h3') continue
    if (key.length > 0 && !kinds.has(key)) kinds.set(key, entry.level)
  }
  const out: Draft[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split(/\n+/)) {
    const line = squash(raw)
    if (line.length === 0) continue
    out.push({ kind: kinds.get(line.toLowerCase()) ?? 'p', text: line })
  }
  return finish(out)
}

/** Numbered lines for the prompt: `b3 [h2] Pricing`. */
export function blocksForPrompt(blocks: readonly PageBlock[]): string {
  return blocks.map((block) => `${block.id} [${block.kind}] ${block.text}`).join('\n')
}

function headingKind(level: number): PageBlockKind {
  if (level <= 1) return 'h1'
  if (level === 2) return 'h2'
  if (level === 3) return 'h3'
  return 'h4'
}

/** Links become their text; images go (their alt text is not page copy); emphasis marks go. Code and tables stay. */
function cleanInline(block: Draft): string {
  if (block.kind === 'code' || block.kind === 'table') return block.text
  return squash(
    block.text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
  )
}

/**
 * The page's own content: what comes before its H1 is the site's menu, search and
 * table of contents, so it is left out; so are image captions ("Image 2: …").
 */
function finish(drafts: readonly Draft[]): PageBlock[] {
  const h1 = drafts.findIndex((block) => block.kind === 'h1')
  return drafts
    .slice(Math.max(0, h1))
    .filter((block) => !/^Image \d+:/u.test(block.text.trim()))
    .filter((block) => block.text.trim().length > 0)
    .slice(0, MAX_PAGE_BLOCKS)
    .map((block, index) => ({
      id: `b${index + 1}`,
      kind: block.kind,
      text: block.text.length > BLOCK_TEXT_MAX ? block.text.slice(0, BLOCK_TEXT_MAX) : block.text
    }))
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
