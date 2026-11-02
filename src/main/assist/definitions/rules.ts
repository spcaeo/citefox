import { questionMergeKey } from '@shared/question-text'
import { wordCount } from '../../pipeline/hash'
import type { AssistReply } from '../types'

/** Reply checks several shipped assists share. Each returns a sentence or null. */

export const BUYER_PROMPT_MIN_WORDS = 8
export const BUYER_PROMPT_MAX_WORDS = 32

export const PROMPT_STAGES = ['problem', 'solution', 'comparison', 'objection', 'trigger'] as const

/** The owner's method: long situational prompts that never name the brand. */
export function checkBuyerPrompts(
  texts: readonly string[],
  brands: readonly string[]
): string | null {
  for (const text of texts) {
    const words = wordCount(text)
    if (words < BUYER_PROMPT_MIN_WORDS || words > BUYER_PROMPT_MAX_WORDS) {
      return `Write every prompt in ${BUYER_PROMPT_MIN_WORDS} to ${BUYER_PROMPT_MAX_WORDS} words.`
    }
    const brand = brandIn(text, brands)
    if (brand !== null) return `Leave the brand name "${brand}" out of every prompt.`
  }
  return null
}

/**
 * A new question that repeats a saved one, or an earlier one in the reply, with only the
 * case, spacing, punctuation, an article, a plural or a year changed (`questionMergeKey`).
 */
export function checkNoRepeats(texts: readonly string[], saved: readonly string[]): string | null {
  const seen = new Set(saved.map(questionMergeKey).filter((key) => key.length > 0))
  for (const text of texts) {
    const key = questionMergeKey(text)
    if (key.length === 0) continue
    if (seen.has(key)) {
      const shown = text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text
      return `"${shown}" repeats a saved prompt. Write a different situation instead.`
    }
    seen.add(key)
  }
  return null
}

export function brandIn(text: string, brands: readonly string[]): string | null {
  const lower = text.toLowerCase()
  return brands.find((name) => name.trim().length > 0 && lower.includes(name.toLowerCase())) ?? null
}

/** Every item's tag must be one of `allowed`. */
export function checkTags(
  reply: AssistReply,
  allowed: readonly string[],
  sentence: string
): string | null {
  return reply.items.every((item) => item.tag !== null && allowed.includes(item.tag.toLowerCase()))
    ? null
    : sentence
}

/** "Q: …" on the first line, the answer after it. */
export function faqAnswerWords(text: string): number {
  const lines = text.split('\n')
  return wordCount(
    lines
      .slice(1)
      .join(' ')
      .replace(/^\s*A:\s*/i, '')
  )
}

/** What {@link competitorNamedAsOption} reads: the page's switch-from options and tools. */
export interface NotOptions {
  switchingFrom: readonly string[]
  integrations: readonly string[]
}

/** "alternatives like X": X is offered as an alternative. */
const OFFERED_BEFORE =
  /\balternatives? (?:like|such as)\s+(?:the\s+|a\s+|an\s+)?(?:[\w&'’.-]+\s+){0,2}$/iu
const CHOICE_BEFORE =
  /(?:\bvs\.?|\bversus|\bor|\bcompared (?:to|with)|\bthan|\bbetween|\bswitch(?:ing)? to|\bmove to|\bgo with)\s+(?:the\s+|a\s+|an\s+)?(?:[\w&'’.-]+\s+){0,2}$/iu
const CHOICE_AFTER =
  /^(?:['’]s)?(?:\s+[\w&'’.-]+){0,2}\s+(?:vs\.?|versus|or|compared (?:to|with)|and\b[^.?!]{0,40}\bwhich)\b/iu
/** A mention after these is the buyer's situation, not an option ("switching from vtext"). */
const SITUATION_BEFORE =
  /\b(?:from|replac(?:e|es|ed|ing)|instead of|alternatives? (?:to|for)|in|into|inside|with|via|through|using|after|since|without|like)\s+(?:the\s+|my\s+|our\s+)?(?:[\w&'’.-]+\s+){0,3}$/iu

/**
 * The switch-from option or tool a prompt offers as something to choose ("vtext or
 * ClickSend", "Zapier vs Textmagic"), or null. Naming one as the buyer's situation is
 * fine ("our Verizon vtext gateway shut down", "we send from Outlook"). Shared by
 * `prompts.more` and the page pipeline's buyer prompts (Docs/PROMPT-AUDIT.md P1, P7).
 */
export function competitorNamedAsOption(text: string, context: NotOptions): string | null {
  return competitorsNamedAsOptions(text, context)[0] ?? null
}

/** Every switch-from option and tool a prompt offers as a choice, as the saved entries. */
export function competitorsNamedAsOptions(text: string, context: NotOptions): string[] {
  const offered: string[] = []
  for (const entry of [...context.switchingFrom, ...context.integrations]) {
    const name = entry.trim()
    if (!offered.includes(name) && offersEntry(text, name)) offered.push(name)
  }
  return offered
}

function offersEntry(text: string, entry: string): boolean {
  for (const key of optionKeys(entry)) {
    const pattern = new RegExp(`(?<![\\w.-])${escapeRegExp(key)}(?![\\w-])`, 'giu')
    for (const match of text.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      const before = text.slice(Math.max(0, start - 60), start)
      const after = text.slice(end, end + 60)
      if (OFFERED_BEFORE.test(before)) return true
      if (SITUATION_BEFORE.test(before)) continue
      if (CHOICE_BEFORE.test(before) || CHOICE_AFTER.test(after)) return true
    }
  }
  return false
}

/**
 * Words that name an entry in a prompt: its domains and their first label
 * ("Verizon vtext.com gateway" gives `vtext.com`, `vtext` and `Verizon`), its
 * capitalised names ("AT&T email-to-text gateway (txt.att.net)" gives `AT&T` and
 * `txt.att.net`; "Microsoft Outlook" gives itself and `Outlook`), or the entry itself
 * when it is a short name ("Gmail", "WIN-911").
 */
export function optionKeys(entry: string): string[] {
  const clean = entry.trim()
  const domains = [...clean.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/giu)].map((m) => m[0])
  const keys = new Set<string>()
  for (const domain of domains) {
    keys.add(domain)
    const label = domain.split('.')[0] ?? ''
    if (label.length >= 4) keys.add(label)
  }
  if (domains.length === 0 && clean.length > 0 && clean.split(/\s+/u).length <= 3) keys.add(clean)
  for (const name of capitalisedNames(clean)) keys.add(name)
  return [...keys]
}

/**
 * Capitalised names in a saved list entry: each run of capitalised words at the start
 * of a piece (pieces split on commas, slashes, "and", "or" and parentheses), plus the
 * run's last word when it is 4 letters or more. Runs shorter than 3 characters give
 * nothing.
 */
function capitalisedNames(entry: string): string[] {
  const names = new Set<string>()
  const inside = [...entry.matchAll(/\(([^)]*)\)/gu)].map((match) => match[1] ?? '')
  const outside = entry.replace(/\([^)]*\)/gu, ' ')
  for (const piece of [outside, ...inside].flatMap((part) =>
    part.split(/[,;/]|\s+(?:and|or)\s+/u)
  )) {
    const trimmed = piece.trim()
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu.test(trimmed)) {
      names.add(trimmed)
      continue
    }
    const run: string[] = []
    for (const token of trimmed.split(/\s+/u)) {
      if (!/^[A-Z0-9][\w&.'-]*$/u.test(token)) break
      run.push(token)
    }
    if (run.length === 0) continue
    const full = run.join(' ')
    if (full.length >= 3) names.add(full)
    const last = run.at(-1) ?? ''
    if (run.length > 1 && last.length >= 4) names.add(last)
  }
  return [...names]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
