import { brandNamed } from './brand-mentions'
import { flatName } from './competitor-hosts'

/**
 * "Analyse with Claude" on the prompt page (assist `results.overviewRead`): how one
 * overview positions the brand. Claude answers in the shared assist reply shape with
 * fixed tags; this file reads that reply into {@link OverviewRead} and checks it in
 * code: quotes must appear in the overview, names must be known competitors or
 * listed sources. Items that fail are dropped; a reply with no usable tone or action
 * is rejected so the assist asks again.
 *
 * Reply shape:
 * - `summary`: how the overview positions the brand, in 1 or 2 sentences.
 * - one item tagged `tone`: text `positive`, `neutral`, `negative` or `absent`; detail
 *   the sentence that names the brand, quoted exactly (null when absent).
 * - up to 4 items tagged `competitor: <name>`: text what earns that site its spot,
 *   detail the passage it rests on, quoted.
 * - 3 items tagged `action`: text one concrete change for the page, detail the quoted
 *   passage or the source (domain) it answers.
 * - `caution`: `Confidence: high|medium|low.` and one reason.
 */

export const OVERVIEW_TONES = ['positive', 'neutral', 'negative', 'absent'] as const
export type OverviewTone = (typeof OVERVIEW_TONES)[number]

export const READ_CONFIDENCES = ['high', 'medium', 'low'] as const
export type ReadConfidence = (typeof READ_CONFIDENCES)[number]

/** Most competitor lines and actions kept from one reply. */
export const READ_COMPETITORS_MAX = 4
export const READ_ACTIONS_MAX = 3

export interface OverviewRead {
  /** How the overview positions the brand, 1 or 2 sentences. */
  positioning: string
  tone: { value: OverviewTone; quote: string | null }
  competitors: readonly { name: string; reason: string; quote: string | null }[]
  /** Each tied to a quoted passage or a listed source (`basis`). */
  actions: readonly { text: string; basis: string }[]
  confidence: { level: ReadConfidence; reason: string }
}

/** One saved read, per sample. */
export interface StoredOverviewRead {
  sampleId: string
  /** ISO-8601 UTC. */
  ranAt: string
  read: OverviewRead
}

/** The reply fields this reads: the shared assist reply, without ids. */
export interface ReadReplyLike {
  summary: string | null
  items: readonly { text: string; detail: string | null; tag: string | null }[]
  caution: string | null
}

/** What the checks compare against. */
export interface ReadFacts {
  /** Every passage of the overview, as plain text. */
  overviewText: string
  brandNames: readonly string[]
  /** Competitors of the page's product, and the site names and domains of the listed sources. */
  knownNames: readonly string[]
  /** Site names, domains and URLs of the listed sources, for actions tied to a source. */
  sourceNames: readonly string[]
}

const TONE_TAG = 'tone'
const ACTION_TAG = 'action'
const COMPETITOR_TAG = /^competitor\s*:\s*(.+)$/iu
const CONFIDENCE = /^confidence\s*:?\s*(high|medium|low)\b[\s.:;,–—-]*(.*)$/isu
/** Shortest quote that counts as a quote, in characters. */
const QUOTE_MIN = 8

/**
 * The reply read and checked. `problem` rejects it (the assist asks again);
 * otherwise `dropped` counts the competitor lines and actions left out.
 */
export function checkOverviewRead(
  reply: ReadReplyLike,
  facts: ReadFacts
): { read: OverviewRead; dropped: number } | { problem: string } {
  const positioning = reply.summary?.trim() ?? ''
  if (positioning.length === 0) {
    return { problem: 'Say in summary how the overview positions the brand.' }
  }
  const confidence = readConfidence(reply.caution)
  if (confidence === null) {
    return { problem: 'Start caution with "Confidence: high", "medium" or "low", then one reason.' }
  }
  const tones = reply.items.filter((item) => tagOf(item) === TONE_TAG)
  const tone = tones[0]
  if (tones.length !== 1 || tone === undefined) return { problem: 'Give exactly one tone item.' }
  const value = tone.text.trim().toLowerCase()
  if (!isTone(value)) return { problem: 'Tone must be positive, neutral, negative or absent.' }
  const named = brandNamed(facts.overviewText, facts.brandNames)
  if (!named && value !== 'absent') {
    return { problem: 'The overview does not name the brand, so tone is "absent".' }
  }
  if (named && value === 'absent') {
    return { problem: 'The overview names the brand; give its tone and quote the sentence.' }
  }
  const toneQuote = value === 'absent' ? null : (tone.detail?.trim() ?? '')
  if (
    toneQuote !== null &&
    (!quoteFound(toneQuote, facts.overviewText) || !brandNamed(toneQuote, facts.brandNames))
  ) {
    return { problem: 'Quote the sentence that names the brand exactly as the overview has it.' }
  }

  let dropped = 0
  const competitors: Array<OverviewRead['competitors'][number]> = []
  const actions: Array<OverviewRead['actions'][number]> = []
  for (const item of reply.items) {
    const tag = tagOf(item)
    const competitor = COMPETITOR_TAG.exec(item.tag?.trim() ?? '')
    if (competitor) {
      const name = knownName(competitor[1] ?? '', facts.knownNames)
      const quote = item.detail?.trim() || null
      if (
        name === null ||
        (quote !== null && !quoteFound(quote, facts.overviewText)) ||
        competitors.length >= READ_COMPETITORS_MAX
      ) {
        dropped += 1
        continue
      }
      competitors.push({ name, reason: item.text.trim(), quote })
    } else if (tag === ACTION_TAG) {
      const basis = item.detail?.trim() ?? ''
      const tied = quoteFound(basis, facts.overviewText) || namesSource(basis, facts.sourceNames)
      if (!tied || actions.length >= READ_ACTIONS_MAX) {
        dropped += 1
        continue
      }
      actions.push({ text: item.text.trim(), basis })
    } else if (tag !== TONE_TAG) {
      dropped += 1
    }
  }
  if (actions.length === 0) {
    return {
      problem: 'Tie each action to a passage quoted exactly from the overview, or a listed source.'
    }
  }
  return {
    read: {
      positioning,
      tone: { value, quote: toneQuote },
      competitors,
      actions,
      confidence
    },
    dropped
  }
}

/**
 * A checked reply (or a saved assist result) as a read, without the checks: the
 * renderer shows a fresh result with this. Null when the tone or confidence is missing.
 */
export function overviewReadFromReply(reply: ReadReplyLike): OverviewRead | null {
  const confidence = readConfidence(reply.caution)
  const tone = reply.items.find((item) => tagOf(item) === TONE_TAG)
  const value = tone?.text.trim().toLowerCase() ?? ''
  if (!reply.summary || confidence === null || !isTone(value)) return null
  const competitors = reply.items.flatMap((item) => {
    const match = COMPETITOR_TAG.exec(item.tag?.trim() ?? '')
    return match
      ? [{ name: (match[1] ?? '').trim(), reason: item.text, quote: item.detail ?? null }]
      : []
  })
  const actions = reply.items
    .filter((item) => tagOf(item) === ACTION_TAG)
    .map((item) => ({ text: item.text, basis: item.detail ?? '' }))
  return {
    positioning: reply.summary,
    tone: { value, quote: value === 'absent' ? null : (tone?.detail ?? null) },
    competitors,
    actions,
    confidence
  }
}

/** A read back in the reply shape, so the assist result carries exactly what was saved. */
export function overviewReadReply(read: OverviewRead): ReadReplyLike & {
  items: { text: string; detail: string | null; tag: string | null }[]
} {
  return {
    summary: read.positioning,
    items: [
      { text: read.tone.value, detail: read.tone.quote, tag: TONE_TAG },
      ...read.competitors.map((line) => ({
        text: line.reason,
        detail: line.quote,
        tag: `competitor: ${line.name}`
      })),
      ...read.actions.map((action) => ({
        text: action.text,
        detail: action.basis,
        tag: ACTION_TAG
      }))
    ],
    caution: `Confidence: ${read.confidence.level}. ${read.confidence.reason}`.trim()
  }
}

/** A saved read from stored JSON, or null when it does not have the shape. */
export function readStoredOverviewRead(value: unknown): OverviewRead | null {
  if (!isRecord(value)) return null
  const tone = isRecord(value.tone) ? value.tone : null
  const confidence = isRecord(value.confidence) ? value.confidence : null
  if (
    typeof value.positioning !== 'string' ||
    tone === null ||
    typeof tone.value !== 'string' ||
    !isTone(tone.value) ||
    confidence === null ||
    typeof confidence.level !== 'string' ||
    !isConfidence(confidence.level) ||
    !Array.isArray(value.competitors) ||
    !Array.isArray(value.actions)
  ) {
    return null
  }
  return {
    positioning: value.positioning,
    tone: { value: tone.value, quote: typeof tone.quote === 'string' ? tone.quote : null },
    competitors: value.competitors.filter(isRecord).flatMap((line) =>
      typeof line.name === 'string' && typeof line.reason === 'string'
        ? [
            {
              name: line.name,
              reason: line.reason,
              quote: typeof line.quote === 'string' ? line.quote : null
            }
          ]
        : []
    ),
    actions: value.actions
      .filter(isRecord)
      .flatMap((action) =>
        typeof action.text === 'string' && typeof action.basis === 'string'
          ? [{ text: action.text, basis: action.basis }]
          : []
      ),
    confidence: {
      level: confidence.level,
      reason: typeof confidence.reason === 'string' ? confidence.reason : ''
    }
  }
}

/**
 * True when the quote is in the overview: case, curly quotes, spacing and citation
 * markers ("[3]") ignored. An ellipsis splits it into parts that must appear in order.
 */
export function quoteFound(quote: string, overviewText: string): boolean {
  const haystack = normalizeQuote(overviewText)
  const parts = normalizeQuote(quote)
    .split(/\s*(?:\.\.\.|…)\s*/u)
    .map((part) => part.replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/gu, ''))
    .filter((part) => part.length > 0)
  if (parts.join(' ').length < QUOTE_MIN) return false
  let from = 0
  for (const part of parts) {
    const at = haystack.indexOf(part, from)
    if (at === -1) return false
    from = at + part.length
  }
  return true
}

function normalizeQuote(value: string): string {
  return value
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/gu, ' ')
    .replace(/[‘’`´]/gu, "'")
    .replace(/[“”«»]/gu, '"')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The known name a reply's name stands for, as the list spells it. */
function knownName(value: string, known: readonly string[]): string | null {
  const flat = flatName(value)
  if (flat.length === 0) return null
  return known.find((name) => flatName(name) === flat) ?? null
}

/**
 * True when the text is a listed source: its site name exactly ("Example Co"), or text
 * that carries its domain or URL ("example.com/pricing", "source 3, example.com").
 */
function namesSource(text: string, sources: readonly string[]): boolean {
  const lower = text
    .toLowerCase()
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’.]+$/gu, '')
  return sources.some((entry) => {
    const name = entry.trim().toLowerCase()
    if (name.length < 3) return false
    return name.includes('.') ? lower.includes(name) : lower === name
  })
}

function readConfidence(caution: string | null): OverviewRead['confidence'] | null {
  const match = CONFIDENCE.exec(caution?.trim() ?? '')
  const level = match?.[1]?.toLowerCase() ?? ''
  if (!match || !isConfidence(level)) return null
  return { level, reason: (match[2] ?? '').trim() }
}

function tagOf(item: { tag: string | null }): string {
  return item.tag?.trim().toLowerCase() ?? ''
}

function isTone(value: string): value is OverviewTone {
  return (OVERVIEW_TONES as readonly string[]).includes(value)
}

function isConfidence(value: string): value is ReadConfidence {
  return (READ_CONFIDENCES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
