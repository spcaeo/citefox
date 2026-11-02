import type { BuyerPrompt, OutlineEntry } from '@shared/domain'
import { getLatestPromptSet } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { HelpFillEvidenceMissing, type HelpFillContext } from '../types'

/**
 * Small pieces the text kinds' evidence shares: the company line, a quoted block,
 * the question's wording, and the part of a stored page read that answers it. A
 * piece with nothing to say returns no lines, so the prompt leaves it out.
 */

/** Characters kept from one quoted block (an overview, a page section). */
export const QUOTE_CHARS = 1500

/** "Company: Example Co (example.com)." */
export function companyLine(context: HelpFillContext): string {
  const brand = context.brands[0]
  return brand === undefined
    ? `Company: ${context.domain}.`
    : `Company: ${brand} (${context.domain}).`
}

/** A block of quoted text between `"""` lines, clipped; no lines when it is empty. */
export function quoted(text: string | null | undefined, max = QUOTE_CHARS): string[] {
  const flat = (text ?? '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
  if (flat.length === 0) return []
  return ['"""', clipText(flat, max), '"""']
}

export function clipText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** The question as the buyer types it (its first wording), or a plain error. */
export function questionOf(
  db: SqliteDatabase,
  pageId: string,
  promptId: string | null,
  brands: readonly string[]
): BuyerPrompt & { wording: string } {
  const set = getLatestPromptSet(db, pageId, brands)
  const prompt = set?.prompts.find((item) => item.id === promptId)
  if (prompt === undefined) {
    throw new HelpFillEvidenceMissing(
      'That question was not found.',
      'Pick one of the questions it should help.'
    )
  }
  return { ...prompt, wording: prompt.variants[0]?.text ?? prompt.label }
}

const STOP = new Set(
  'a an and are as at be by can do does for from how i in is it my of on or our the to what when where which who why with you your'.split(
    ' '
  )
)

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2 && !STOP.has(word))
  )
}

/**
 * The part of a page read that best answers the question: the text under the
 * heading whose section shares the most words with it, else the page's opening.
 * Headings are found in the body text in outline order.
 */
export function sectionFor(
  question: string,
  page: { bodyText: string; outline: readonly OutlineEntry[] },
  max = QUOTE_CHARS
): { heading: string | null; text: string } | null {
  const body = page.bodyText.trim()
  if (body.length === 0) return null
  const cuts: { heading: string; at: number }[] = []
  let from = 0
  for (const entry of page.outline) {
    const heading = entry.text.trim()
    if (heading.length === 0) continue
    const at = body.indexOf(heading, from)
    if (at < 0) continue
    cuts.push({ heading, at })
    from = at + heading.length
  }
  const asked = words(question)
  let best: { heading: string | null; text: string; score: number } = {
    heading: null,
    text: body.slice(0, cuts[0]?.at ?? body.length),
    score: 0
  }
  cuts.forEach((cut, index) => {
    const text = body.slice(cut.at + cut.heading.length, cuts[index + 1]?.at ?? body.length).trim()
    const own = words(`${cut.heading} ${text}`)
    let score = 0
    for (const word of asked) if (own.has(word)) score += 1
    if (score > best.score && text.length > 0) best = { heading: cut.heading, text, score }
  })
  const text = best.text.trim().length > 0 ? best.text : body
  return { heading: best.heading, text: clipText(text.trim(), max) }
}
