import { claimsCause } from '../engine/checks/cause-rule'
import { normalizeUrl } from '../engine/checks/url'
import { storedCompetitor } from '../engine/checks/competitor-match'
import type { CompetitorContext } from '../engine/competitor-context'
import { wordCount } from '../pipeline/hash'
import { tolerantRange, trimToWords, withinTolerance } from './word-range'
import { NO_CAUSE_RULE } from './blocks'

/**
 * Shared pieces of the results explanations and "what to fix next" prompts
 * (Docs/PROMPT-AUDIT.md, package P5): how stored overview sources are tagged and
 * listed, the overview text with its source markers, the passage check behind
 * every "evidence", the "next action" rules three prompts share, and the reply
 * checks for fix drafts. Pure functions: no database, no clock.
 */

// ---------------------------------------------------------------------------
// The "next action" rules (topic_next_actions, results.topActions, progress.nextFix)
// ---------------------------------------------------------------------------

/** One way to pick what to do next, for a topic, a page's results and its progress. */
export const NEXT_ACTION_RULES = `How to pick the next actions:
- Work from the saved results only. Rank by how many buyer questions an action could move and how close each one is: an overview shows and the page that should answer it is not cited (improve that page) first; then another of the business's pages is cited instead (strengthen the right page, or make the cited page the target); then no page answers it yet (write one). Questions with no AI Overview come last.
- One action may cover several questions when one page or one section can answer them all. Never split one edit into several actions.
- Write each action as one instruction a writer can carry out today: the page (its path) or "a new page", the section to add or rewrite, and the buyer situation it must answer, in the buyer's words. Name who the overview cites now when that shows what is missing.
- Never repeat an action that is already listed, logged or marked done.
- Do not promise that an action will win a citation. ${NO_CAUSE_RULE}`

// ---------------------------------------------------------------------------
// Overview sources, tagged own, competitor or other
// ---------------------------------------------------------------------------

/** A stored `aio_references` row, as the explanations read it. */
export interface StoredReference {
  position: number
  url: string
  domain: string
  title: string | null
  /** The check's class: target, own, competitor or other. */
  classification: string
  /** web, reddit, youtube, linkedin, review, forum or other. */
  sourceType?: string | null
}

/**
 * What a source is to the business: its own site, a direct or partial competitor of the
 * product, a competitor the check stored that the product's list no longer has (an old
 * run), or other.
 */
export type SourceTag = 'own' | 'direct' | 'partial' | 'competitor' | 'other'

export interface TaggedReference extends StoredReference {
  tag: SourceTag
}

const TAG_LABEL: Readonly<Record<SourceTag, string>> = {
  own: 'own site',
  direct: 'direct competitor',
  partial: 'partial competitor',
  competitor: 'competitor',
  other: 'other'
}

/**
 * Tags each source the way the check stored it (Docs/PROMPT-AUDIT.md P9): the check
 * classifies against the competitors of the page's or topic's product, with the same
 * matcher (`competitor-match.ts`), so the prompt text and the numbers always agree. The
 * product's competitors (`competitorContext()`) give a competitor its tier. The own
 * site also comes from the own domain.
 */
export function tagReferences(
  references: readonly StoredReference[],
  context: Pick<CompetitorContext, 'direct' | 'partial'>,
  ownDomain: string
): TaggedReference[] {
  const own = bareDomain(ownDomain)
  return references.map((reference) => {
    const domain = bareDomain(reference.domain)
    let tag: SourceTag = 'other'
    if (
      reference.classification === 'target' ||
      reference.classification === 'own' ||
      (own.length > 0 && (domain === own || domain.endsWith(`.${own}`)))
    ) {
      tag = 'own'
    } else {
      const hit = storedCompetitor(reference, context)
      if (hit !== null) tag = hit.tier ?? 'competitor'
    }
    return { ...reference, tag }
  })
}

/** `1. simpletexting.com · How to send texts from email · direct competitor · forum`. */
export function referencesBlock(
  references: readonly TaggedReference[],
  snippets: ReadonlyMap<number, string> = new Map()
): string {
  if (references.length === 0) return 'The overview shows no sources.'
  return references
    .map((reference) => {
      const snippet = snippets.get(reference.position)
      const parts = [
        `${reference.position}. ${bareDomain(reference.domain)}`,
        reference.title === null || reference.title.trim().length === 0
          ? null
          : squash(reference.title).slice(0, 140),
        TAG_LABEL[reference.tag],
        reference.sourceType !== undefined &&
        reference.sourceType !== null &&
        reference.sourceType !== 'web' &&
        reference.sourceType !== 'other'
          ? reference.sourceType
          : null,
        reference.url
      ]
      const line = parts.filter((part): part is string => part !== null).join(' · ')
      return snippet === undefined ? line : `${line}\n   Shown from it: ${snippet}`
    })
    .join('\n')
}

/** Facts code can state about who is cited, for "Explain this citation". */
export function citationFacts(references: readonly TaggedReference[]): string[] {
  if (references.length === 0) return []
  const facts: string[] = []
  const first = references[0]
  if (first !== undefined) {
    facts.push(
      `${bareDomain(first.domain)} is cited first${first.tag === 'other' ? '' : ` (${TAG_LABEL[first.tag]})`}.`
    )
  }
  const own = references.filter((reference) => reference.tag === 'own')
  facts.push(
    own.length === 0
      ? `Your site is not among the ${references.length} sources.`
      : `Your site is cited at position ${own.map((reference) => reference.position).join(', ')} of ${references.length}.`
  )
  const rivals = references.filter(
    (reference) =>
      reference.tag === 'direct' || reference.tag === 'partial' || reference.tag === 'competitor'
  )
  if (rivals.length > 0) {
    const names = [...new Set(rivals.map((reference) => bareDomain(reference.domain)))]
    facts.push(
      `${names.length} competitor${names.length === 1 ? '' : 's'} cited: ${names.slice(0, 4).join(', ')}.`
    )
  }
  const community = references.filter(
    (reference) =>
      reference.sourceType === 'reddit' ||
      reference.sourceType === 'forum' ||
      reference.sourceType === 'youtube' ||
      reference.sourceType === 'review'
  )
  if (community.length > 0) {
    facts.push(`${community.length} of ${references.length} sources are forums, reviews or videos.`)
  }
  return facts
}

// ---------------------------------------------------------------------------
// The overview text with its source markers
// ---------------------------------------------------------------------------

/** Characters of overview text sent to Claude. */
export const OVERVIEW_CHARS = 6000

/**
 * The stored overview in reading order, with `[n]` after each passage naming the
 * sources Google showed for it (SerpApi's `reference_indexes`), mapped to the
 * stored source positions. Falls back to the flat text when the raw overview is
 * missing or carries no markers.
 */
export function overviewWithSources(
  rawAioJson: string | null,
  aioText: string | null,
  references: readonly Pick<StoredReference, 'position' | 'url'>[]
): StoredOverviewText {
  const flat = aioText === null ? '' : squash(aioText)
  const overview = rawOverview(rawAioJson)
  const none = new Map<number, string>()
  if (overview === null) return { text: clip(flat, OVERVIEW_CHARS), marked: false, snippets: none }
  const positions = positionsByIndex(overview, references)
  const snippets = snippetsByPosition(overview, references)
  const lines: string[] = []
  let marked = false
  const walk = (blocks: unknown, depth: number): void => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (!isRecord(block)) continue
      const marks = markerOf(block, positions)
      if (marks.length > 0) marked = true
      const title = text(block.title)
      const snippet = text(block.snippet)
      const indent = depth > 0 ? `${'  '.repeat(depth - 1)}- ` : ''
      const body =
        block.type === 'heading'
          ? snippet.length > 0
            ? `## ${snippet}`
            : ''
          : [title, snippet].filter((part) => part.length > 0).join(': ')
      if (body.length > 0)
        lines.push(`${indent}${body}${marks.length > 0 ? ` [${marks.join(', ')}]` : ''}`)
      walk(block.list, depth + 1)
      walk(block.text_blocks, depth)
      if (Array.isArray(block.table)) {
        for (const row of block.table) {
          if (Array.isArray(row))
            lines.push(`${indent}| ${row.map((cell) => text(cell)).join(' | ')} |`)
        }
      }
    }
  }
  walk(overview.text_blocks, 0)
  const joined = lines.join('\n').trim()
  if (joined.length === 0) return { text: clip(flat, OVERVIEW_CHARS), marked: false, snippets }
  return { text: clip(joined, OVERVIEW_CHARS), marked, snippets }
}

/** What {@link overviewWithSources} reads from a stored overview. */
export interface StoredOverviewText {
  /** The overview in reading order, `[n]` after passages when Google showed sources. */
  text: string
  /** True when at least one passage carries a `[n]` marker. */
  marked: boolean
  /** Source position → the snippet Google showed from that source, when stored. */
  snippets: ReadonlyMap<number, string>
}

/** Characters kept from one source's snippet. */
export const SOURCE_SNIPPET_CHARS = 220

function snippetsByPosition(
  overview: Record<string, unknown>,
  references: readonly Pick<StoredReference, 'position' | 'url'>[]
): Map<number, string> {
  const byUrl = new Map(references.map((ref) => [normalizeUrl(ref.url) ?? ref.url, ref.position]))
  const out = new Map<number, string>()
  if (!Array.isArray(overview.references)) return out
  for (const reference of overview.references) {
    if (!isRecord(reference) || typeof reference.link !== 'string') continue
    const position = byUrl.get(normalizeUrl(reference.link) ?? reference.link)
    const snippet = text(reference.snippet)
      .replace(/(?:\.{3}|…)$/u, '')
      .trim()
    if (position !== undefined && snippet.length > 0 && !out.has(position)) {
      out.set(position, clip(snippet, SOURCE_SNIPPET_CHARS))
    }
  }
  return out
}

function rawOverview(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim().length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (isRecord(parsed.ai_overview)) return parsed.ai_overview
  if (isRecord(parsed.body) && isRecord(parsed.body.ai_overview)) return parsed.body.ai_overview
  return Array.isArray(parsed.text_blocks) ? parsed : null
}

/** SerpApi reference `index` → stored position, matched by URL. */
function positionsByIndex(
  overview: Record<string, unknown>,
  references: readonly Pick<StoredReference, 'position' | 'url'>[]
): Map<number, number> {
  const byUrl = new Map(references.map((ref) => [normalizeUrl(ref.url) ?? ref.url, ref.position]))
  const out = new Map<number, number>()
  if (!Array.isArray(overview.references)) return out
  overview.references.forEach((reference, order) => {
    if (!isRecord(reference) || typeof reference.link !== 'string') return
    const index = typeof reference.index === 'number' ? reference.index : order
    const position = byUrl.get(normalizeUrl(reference.link) ?? reference.link)
    if (position !== undefined) out.set(index, position)
  })
  return out
}

function markerOf(block: Record<string, unknown>, positions: Map<number, number>): number[] {
  if (!Array.isArray(block.reference_indexes)) return []
  const found = block.reference_indexes
    .filter((value): value is number => typeof value === 'number')
    .map((index) => positions.get(index))
    .filter((value): value is number => value !== undefined)
  return [...new Set(found)].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Reply checks
// ---------------------------------------------------------------------------

/**
 * The evidence as written when it is a passage of one of the sources (the overview
 * or the page), compared without case, quotes, punctuation runs or ellipses. A
 * paraphrase dressed as a quote returns null, so the UI never shows invented proof.
 */
export function verifiedPassage(
  evidence: string | null,
  sources: readonly string[]
): string | null {
  if (evidence === null) return null
  const trimmed = evidence.trim()
  if (trimmed.length === 0) return null
  const parts = trimmed
    .split(/\s*(?:\.\.\.|…)\s*/u)
    .map(comparable)
    .filter((part) => part.length > 0)
  if (parts.length === 0) return null
  const haystacks = sources.map(comparable)
  const found = parts.every(
    (part) => part.split(' ').length >= 3 && haystacks.some((hay) => hay.includes(part))
  )
  return found ? trimmed : null
}

/** The first string that claims a change caused a citation, as a retry message, else null. */
export function causeProblem(texts: readonly string[]): string | null {
  const bad = texts.find((value) => claimsCause(value))
  return bad === undefined
    ? null
    : `This line credits a change with a citation: "${clip(squash(bad), 160)}". Say what the overview shows instead; timing is not proof.`
}

/**
 * FAQ answers and section bodies in a drafted fix, as the prompt asks. Code accepts
 * about 10% either side (`prompts/word-range.ts`): the ranges guide, never fail.
 */
export const FIX_FAQ_WORDS = { min: 40, max: 70 } as const
export const FIX_SECTION_WORDS = { min: 60, max: 120 } as const

/** The drafted block's first line and its body lines (labels such as "A:" removed). */
function draftParts(draft: string): { head: string; body: string[] } {
  const lines = draft
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const head = (lines[0] ?? '').replace(/^(?:Q|Question)\s*:\s*/iu, '')
  const body = lines.slice(1)
  if (body[0] !== undefined) body[0] = body[0].replace(/^(?:A|Answer)\s*:\s*/iu, '')
  return { head, body }
}

/** The range for the block: an FAQ answer when the first line is a question, else a section. */
function draftRange(head: string): typeof FIX_FAQ_WORDS | typeof FIX_SECTION_WORDS {
  return head.endsWith('?') ? FIX_FAQ_WORDS : FIX_SECTION_WORDS
}

/** The block needs a first line (question or heading) and text after it. Always checked. */
export function fixDraftShapeProblem(draft: string): string | null {
  return draftParts(draft).body.length === 0
    ? 'Put the question or heading on the first line and the answer or section text after it.'
    : null
}

/** The answer or body's word count, when it is more than about 10% outside its range. */
export function fixDraftWordsProblem(draft: string): string | null {
  const { head, body } = draftParts(draft)
  const words = wordCount(body.join(' '))
  const range = draftRange(head)
  if (withinTolerance(words, range)) return null
  return head.endsWith('?')
    ? `The FAQ answer has ${words} words; write ${range.min} to ${range.max} after the question line.`
    : `The section has ${words} words after its heading; write ${range.min} to ${range.max}.`
}

/**
 * A drafted block is an FAQ (the buyer's question on the first line, then the
 * answer) or a section (a heading line, then the body). Returns the retry message
 * when it has no body, or the answer or body is well outside its word range.
 */
export function fixDraftProblem(draft: string): string | null {
  return fixDraftShapeProblem(draft) ?? fixDraftWordsProblem(draft)
}

/** The block with an answer or body still over its tolerant maximum cut at a sentence end. */
export function trimFixDraft(draft: string): string {
  const { head, body } = draftParts(draft)
  if (body.length === 0) return draft
  const max = tolerantRange(draftRange(head)).max
  if (wordCount(body.join(' ')) <= max) return draft
  const lines = draft.split('\n')
  const first = lines.findIndex((line) => line.trim().length > 0)
  return [...lines.slice(0, first + 1), trimToWords(lines.slice(first + 1).join('\n'), max)].join(
    '\n'
  )
}

/** A buyer question (a line or sentence ending in "?") that names a brand, else null. */
export function brandInQuestion(
  texts: readonly string[],
  brands: readonly string[]
): string | null {
  const names = brands.map(flat).filter((name) => name.length > 2)
  if (names.length === 0) return null
  for (const value of texts) {
    const questions = value.match(/[^.!?\n]*\?/gu) ?? []
    for (const question of questions) {
      const hay = flat(question)
      const brand = brands.find((_, index) => {
        const name = names[index]
        return name !== undefined && hay.includes(name)
      })
      if (brand !== undefined) {
        return `Leave the brand name "${brand}" out of the buyer's question "${clip(squash(question), 120)}".`
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `www.SimpleTexting.com` → `simpletexting.com`. */
export function bareDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/[/:?#].*$/u, '')
}

function flat(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '')
}

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"‘’'`*]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function squash(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

function text(value: unknown): string {
  return typeof value === 'string' ? squash(value) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
