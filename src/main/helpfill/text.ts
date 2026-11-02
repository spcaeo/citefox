import { HELPFILL_TEXT_MAX, type HelpFillResult } from '@shared/ipc'
import { stripBom } from '../import/csv'
import type { HelpFillContext, HelpFillKindDef } from './types'

/**
 * Text kinds (Docs/HELPFILL.md "Text kinds"): the answer is one block of text, such
 * as a rewritten page section, a pitch email or a report summary. The reader keeps
 * the answer and takes out what the chatbot said around it ("Sure! Here is the
 * rewritten section:", "Let me know if…", Perplexity's [1] marks and source list).
 * Pure: no database, no clock.
 */

export const NO_TEXT = 'No answer was found in the paste. Paste the whole reply.'

/** A thank-you or yes the chatbot opens with. */
const ACK = /^(?:sure|certainly|of course|absolutely|okay|ok|happy to help|great question)\b/iu

/** "Here is the rewritten section", "I've kept your facts". */
const HERE =
  /^(?:here(?:'s| is| are)|below (?:is|are)|i(?:'ve| have) (?:rewritten|written|drafted|kept|made|revised|updated))\b/iu

/** A closing paragraph the chatbot adds after the answer. */
const CLOSING =
  /^(?:let me know|i hope|hope (?:this|that)|feel free|would you like|if you(?:'d| would)? like|want me to|i can (?:also|adjust|make)|happy to|notes?:|why this works|what i changed|changes made|sources?:|references?:|citations?:)/iu

/** A bare label line before the answer: "**Rewritten section:**", "### Your new pitch". */
const LABEL =
  /^(?:#{1,6}\s*)?[*_]*(?:the\s+)?(?:rewritten|revised|updated|new|improved|suggested|draft(?:ed)?|final|your)\s+(?:[\p{L}-]+\s+){0,3}(?:section|version|text|draft|pitch|email|summary|answer|copy|content|paragraph)\b[*_]*:?[*_]*\s*$/iu

/** Perplexity's inline source marks, such as [1] or [2][3]. */
const SOURCE_MARK = /\s?\[\d{1,3}\](?!\()/gu

export interface ReadText {
  text: string
  warnings: string[]
}

export function readTextReply(raw: string, maxChars: number): ReadText {
  const most = Math.min(maxChars, HELPFILL_TEXT_MAX)
  let text = stripBom(raw).replace(/\r\n?/gu, '\n')
  text = fenced(text) ?? text
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/[ \t]+$/gmu, '').trim())
    .filter((paragraph) => paragraph.length > 0)
  while (paragraphs.length > 1 && isOpening(paragraphs[0] ?? '')) paragraphs.shift()
  while (paragraphs.length > 1 && isClosing(paragraphs.at(-1) ?? '')) paragraphs.pop()
  const body = paragraphs
    .join('\n\n')
    .replace(SOURCE_MARK, '')
    .replace(/^\s*[-*_]{3,}\s*$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (body.length === 0) return { text: '', warnings: [NO_TEXT] }
  if (body.length <= most) return { text: body, warnings: [] }
  return {
    text: `${body.slice(0, most - 1).trimEnd()}…`,
    warnings: [`Only the first ${most.toLocaleString('en-US')} characters were kept.`]
  }
}

/**
 * The inside of the code fence when the answer is in one (the longest, if several),
 * else null. A fence holding only a line or two of a longer answer is not the answer.
 */
function fenced(text: string): string | null {
  const blocks = [...text.matchAll(/^\s*(```|~~~)[^\n]*\n([\s\S]*?)\n\s*\1\s*$/gmu)].map(
    (match) => match[2] ?? ''
  )
  const longest = blocks.sort((left, right) => right.length - left.length)[0]
  if (longest === undefined || longest.trim().length === 0) return null
  const outside = text.length - longest.length
  return longest.length >= outside * 0.5 ? longest : null
}

/** One or two lines, each a thank-you, a "here is", a label or a short line ending in a colon. */
function isOpening(paragraph: string): boolean {
  const lines = paragraph.split('\n')
  return lines.length <= 2 && lines.every(isOpeningLine)
}

function isOpeningLine(line: string): boolean {
  const first = plain(line)
  if (LABEL.test(line.trim()) || ACK.test(first) || HERE.test(first)) return true
  return first.endsWith(':') && first.length <= 100
}

function isClosing(paragraph: string): boolean {
  const first = plain(paragraph.split('\n')[0] ?? '')
  if (CLOSING.test(first)) return true
  // A source list: every line a link or a [n] reference.
  const lines = paragraph.split('\n').map((line) => line.trim())
  return lines.every((line) => /^(?:\[\d{1,3}\]|[-*]\s*)?\s*\S*https?:\/\/\S+$/u.test(line))
}

function plain(line: string): string {
  return line
    .replace(/^#{1,6}\s*/u, '')
    .replace(/[*_`]/gu, '')
    .trim()
}

/**
 * The result of a text kind, from Read the answer or Describe: the text once as a row
 * (`values.text`), the kind's own check applied, and the banner counts (1 read, 1 ready).
 */
export function settleText(
  definition: HelpFillKindDef,
  context: HelpFillContext,
  read: ReadText,
  evidence: readonly string[]
): HelpFillResult {
  let text = read.text
  const warnings = [...read.warnings]
  if (text.length > 0 && definition.text?.check !== undefined) {
    const checked = definition.text.check(text, evidence, context)
    text = checked.text
    warnings.push(...checked.warnings)
  }
  const ready = text.length > 0 ? 1 : 0
  return {
    kind: definition.kind,
    rows: ready === 1 ? [{ id: 'row-1', section: null, values: { text } }] : [],
    setAside: [],
    counts: { read: read.text.length > 0 ? 1 : 0, tracked: 0, repeats: 0, setAside: 0, ready },
    noun: definition.noun,
    brand: context.brands[0] ?? null,
    warnings,
    text
  }
}
