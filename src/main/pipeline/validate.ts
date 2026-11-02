import { FAQ_DRAFT_MAX_WORDS, FAQ_DRAFT_MIN_WORDS } from '@shared/domain'
import type { CoverageAction, IntentStage, PromptSource } from '@shared/domain'
import Ajv from 'ajv'
import { competitorsNamedAsOptions } from '../assist/definitions/rules'
import { containsSecret } from '../logging/redact'
import type { ValidationProblem } from './errors'
import { wordCount } from './hash'
import {
  BUYER_PROFILE_SCHEMA,
  BUYER_PROMPT_MAX_WORDS,
  BUYER_PROMPT_MIN_WORDS,
  BUYER_PROMPTS_SCHEMA,
  COVERAGE_SCHEMA
} from './schemas'

const ajv = new Ajv({ allErrors: true, strict: false })
const profileSchemaError = compile(BUYER_PROFILE_SCHEMA)
const promptSchemaError = compile(BUYER_PROMPTS_SCHEMA)
const coverageSchemaError = compile(COVERAGE_SCHEMA)

const REQUIRED_SOURCES = ['title_meta_h1', 'trigger_event', 'objection'] as const

/**
 * The sources a set of `count` prompts must use. Three or more prompts use all three; a
 * smaller set (Prompts per page can be 1 or 2) uses the first `count`, in this order.
 */
export function requiredPromptSources(count: number): readonly PromptSource[] {
  return REQUIRED_SOURCES.slice(0, Math.max(0, Math.min(count, REQUIRED_SOURCES.length)))
}

export interface PromptDraft {
  text: string
  label: string
  source: PromptSource
  intentStage: IntentStage
  mappedElement: string
}

export interface CanonicalPrompt extends PromptDraft {}

/**
 * A plan limit written as a company size: "5 to 50 users", "10 seats", "3 licences".
 * Company size is the number of staff (Docs/PROMPT-AUDIT.md, P1).
 */
const SEAT_COUNT =
  /\b\d[\d,.]*\+?(?:\s*(?:-|–|to)\s*\d[\d,.]*\+?)?\s*(?:users?|seats?|licen[cs]es?|logins?)\b/iu

export function validateBuyerProfile(
  value: unknown,
  options: { brands?: readonly string[] } = {}
): ValidationProblem | null {
  return firstProblem(value, profileSchemaError(value), () => {
    const profile = value as { who: string; values: string[]; segments: { name: string }[] }
    if (!/price|\$|cost|pricing/i.test(profile.values.join('\n'))) {
      return { code: 'schema_validation', message: 'What they value must include price.' }
    }
    const seats = SEAT_COUNT.exec(profile.who)?.[0]
    if (seats !== undefined) {
      return {
        code: 'schema_validation',
        message: `Company size is the number of staff, not a plan's seat or user limit ("${seats}").`
      }
    }
    for (const segment of profile.segments) {
      const brand = brandIn(segment.name, options.brands ?? [])
      if (brand !== null) {
        return {
          code: 'schema_validation',
          message: `A segment is a kind of buyer, not a brand ("${segment.name}" names ${brand}).`
        }
      }
    }
    return null
  })
}

/** Names a prompt must never offer as an option, and the competitors it may name. */
export interface PromptCompetitorLists {
  /** Direct and partial competitors. */
  competitors: readonly string[]
  /** What buyers switch from. Never offered as an option. */
  switchingFrom: readonly string[]
  /** Tools used with the product. Never offered as an alternative. */
  integrations: readonly string[]
}

/**
 * Switch-from options and tools a comparison prompt offers as a choice ("vtext or
 * ClickSend", "Zapier vs Textmagic", "alternatives like WIN-911"), as the saved entries.
 * Naming them as the buyer's current setup is fine. The one rule `prompts.more` uses
 * too (assist/definitions/rules.ts).
 */
export function offeredExclusions(
  text: string,
  intentStage: string,
  lists: PromptCompetitorLists
): string[] {
  return intentStage === 'comparison' ? competitorsNamedAsOptions(text, lists) : []
}

/**
 * Product-like names in a prompt that are on no list: CamelCase words
 * ("SimpleTexting") and domains ("example.com"). A warning, not a failure: Claude
 * may know a real competitor the project has not saved.
 */
export function unlistedCompanies(
  text: string,
  known: readonly string[],
  pageText: string
): string[] {
  const knownText = normalizePageQuote([...known, pageText].join('\n'))
  const found = new Set<string>()
  for (const match of text.matchAll(
    /\b(?:[A-Z][a-z]+[A-Z][\w]*|[a-z0-9-]+\.(?:com|io|net|co|org))\b/gu
  )) {
    const name = match[0]
    if (!knownText.includes(name.toLowerCase())) found.add(name)
  }
  return [...found]
}

export function validateBuyerPrompts(
  value: unknown,
  options: {
    count: number
    brands: readonly string[]
    canonical: readonly CanonicalPrompt[] | null
    language: string
    canonicalLanguage: string
    /** The page's competitor lists. A comparison prompt never offers a switch-from option or a tool. */
    lists?: PromptCompetitorLists
  }
): ValidationProblem | null {
  return firstProblem(value, promptSchemaError(value), () => {
    const prompts = (value as { prompts: PromptDraft[] }).prompts
    if (prompts.length !== options.count) {
      return {
        code: 'schema_validation',
        message: `Expected ${options.count} prompts and received ${prompts.length}.`
      }
    }
    const sources = new Set(prompts.map((prompt) => prompt.source))
    const required = requiredPromptSources(options.count)
    for (const source of required) {
      if (!sources.has(source)) {
        return {
          code: 'schema_validation',
          message: `Prompts must use ${listSources(required)}.`
        }
      }
    }
    for (let index = 0; index < prompts.length; index += 1) {
      const prompt = prompts[index]
      if (prompt === undefined) continue
      // Out of bounds the whole prompt is rejected. completeStructured retries
      // once with this message. The text is not truncated.
      const textProblem = buyerPromptTextProblem(prompt.text, options.brands)
      if (textProblem !== null) return textProblem
      if (options.lists !== undefined) {
        const offered = offeredExclusions(prompt.text, prompt.intentStage, options.lists)
        if (offered.length > 0) {
          return {
            code: 'schema_validation',
            message: `Prompt ${index + 1} offers ${offered.join(' and ')} as an option. Buyers switch from those or use them with the product; compare kinds of solutions or the listed competitors instead.`
          }
        }
      }
      const canonical = options.canonical?.[index]
      if (canonical === undefined) continue
      if (
        prompt.label !== canonical.label ||
        prompt.source !== canonical.source ||
        prompt.intentStage !== canonical.intentStage ||
        prompt.mappedElement !== canonical.mappedElement
      ) {
        return {
          code: 'schema_validation',
          message: `Prompt ${index + 1} does not match the canonical prompt.`
        }
      }
      if (
        primaryLanguage(options.language) !== primaryLanguage(options.canonicalLanguage) &&
        prompt.text.trim().toLowerCase() === canonical.text.trim().toLowerCase()
      ) {
        return {
          code: 'schema_validation',
          message: `Prompt ${index + 1} repeats the other market instead of writing in ${options.language}.`
        }
      }
    }
    return null
  })
}

export interface CoverageDraftRow {
  position: number
  coverage: string
  whereCovered: string[]
  currentContent: string
  whatToUpdate: string
  mainGap: string
  priority: string
  actions: CoverageAction[]
  suggestedFaq: { question: string; answer: string } | null
}

export function validateCoverage(
  value: unknown,
  options: {
    count: number
    pageText: string
    /** The buyer prompts. A row may quote the buyer's own words from them. */
    promptText?: string
  }
): ValidationProblem | null {
  return firstProblem(value, coverageSchemaError(value), () => {
    const matrix = value as { rows: CoverageDraftRow[]; findings: { detail: string }[] }
    if (matrix.rows.length !== options.count) {
      return {
        code: 'schema_validation',
        message: `Expected ${options.count} coverage rows and received ${matrix.rows.length}.`
      }
    }
    const page = normalizePageQuote(options.pageText)
    const asked = normalizePageQuote(options.promptText ?? '')
    const quotable = (span: string): boolean =>
      quoteOnPage(page, span) || (asked.length > 0 && quoteOnPage(asked, span))
    const positions = new Set<number>()
    for (const row of matrix.rows) {
      if (positions.has(row.position)) {
        return { code: 'schema_validation', message: `Position ${row.position} is repeated.` }
      }
      positions.add(row.position)
      if (row.coverage !== 'none' && row.whereCovered.length === 0) {
        return {
          code: 'schema_validation',
          message: `Position ${row.position} does not say where the page covers it.`
        }
      }
      const missingPlace = row.whereCovered.find((place) => !placeOnPage(page, place))
      if (missingPlace !== undefined) {
        return {
          code: 'quote_not_on_page',
          message: `A quoted heading is not on the page: "${missingPlace}".`
        }
      }
      if (row.coverage !== 'strong' && row.suggestedFaq === null) {
        return {
          code: 'schema_validation',
          message: `Position ${row.position} is ${row.coverage}, so it needs a new FAQ draft (a question and a ${FAQ_DRAFT_MIN_WORDS} to ${FAQ_DRAFT_MAX_WORDS} word answer).`
        }
      }
      const needsFaq = row.actions.includes('new_faq') || row.actions.includes('optional_faq')
      if (needsFaq && row.suggestedFaq === null) {
        return {
          code: 'schema_validation',
          message: `Position ${row.position} recommends a new FAQ but does not include one.`
        }
      }
      if (row.suggestedFaq !== null) {
        const count = wordCount(row.suggestedFaq.answer)
        if (count < FAQ_DRAFT_MIN_WORDS || count > FAQ_DRAFT_MAX_WORDS) {
          return {
            code: 'schema_validation',
            message: `The new FAQ at position ${row.position} is ${count} words. It must be ${FAQ_DRAFT_MIN_WORDS} to ${FAQ_DRAFT_MAX_WORDS}.`
          }
        }
        const prices = row.suggestedFaq.answer.match(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g) ?? []
        for (const price of prices) {
          const compact = price.replace(/\s+/g, '')
          if (!options.pageText.includes(compact) && !options.pageText.includes(price)) {
            return {
              code: 'schema_validation',
              message: `A draft names a price the page does not confirm (${compact}).`
            }
          }
        }
      }
      // whatToUpdate proposes new words ("the words to use"), so its quotes are not page quotes.
      const prose = [row.mainGap, row.currentContent, ...row.whereCovered].join('\n')
      for (const span of quotedSpans(prose)) {
        if (!quotable(span)) {
          return {
            code: 'quote_not_on_page',
            message: `A quoted heading is not on the page: "${span}".`
          }
        }
      }
    }
    for (const finding of matrix.findings) {
      for (const span of quotedSpans(finding.detail)) {
        if (!quoteOnPage(page, span)) {
          return {
            code: 'quote_not_on_page',
            message: `A quoted heading is not on the page: "${span}".`
          }
        }
      }
    }
    for (let position = 1; position <= options.count; position += 1) {
      if (!positions.has(position)) {
        return { code: 'schema_validation', message: `Position ${position} is missing.` }
      }
    }
    return null
  })
}

export function firstProblem(
  value: unknown,
  schemaProblem: string | null,
  domain: () => ValidationProblem | null
): ValidationProblem | null {
  if (schemaProblem !== null) return { code: 'schema_validation', message: schemaProblem }
  if (containsSecret(JSON.stringify(value), { hexKeys: false })) {
    return { code: 'schema_validation', message: 'The reply contained a secret and was rejected.' }
  }
  return domain()
}

/**
 * The checks one buyer prompt's wording must pass: 8 to 32 words (Google reads at most
 * 32) and no brand name. The set check above and the prompt detail editor use it.
 */
export function buyerPromptTextProblem(
  text: string,
  brands: readonly string[]
): ValidationProblem | null {
  const words = wordCount(text)
  if (words > BUYER_PROMPT_MAX_WORDS) {
    return {
      code: 'schema_validation',
      message: `A buyer prompt is ${words} words. Google reads at most ${BUYER_PROMPT_MAX_WORDS}, so keep it to ${BUYER_PROMPT_MAX_WORDS} or fewer.`
    }
  }
  if (words < BUYER_PROMPT_MIN_WORDS) {
    return {
      code: 'schema_validation',
      message: `A buyer prompt is ${words} words. Write it as a full situational question of at least ${BUYER_PROMPT_MIN_WORDS} words.`
    }
  }
  const brand = brandIn(text, brands)
  if (brand !== null) {
    return {
      code: 'brand_in_prompt',
      message: `A buyer prompt contains the brand name "${brand}".`
    }
  }
  return null
}

export function brandIn(text: string, brands: readonly string[]): string | null {
  const haystack = text.toLowerCase()
  for (const brand of brands) {
    const needle = brand.trim().toLowerCase()
    if (needle.length > 0 && haystack.includes(needle)) return brand
  }
  return null
}

/**
 * Page text as a quote check reads it. Claude writes straight quotes and plain dashes
 * even when the page uses typographic ones (sender’s, “running late”), and spacing and
 * capitalisation shift when a heading is copied, so those differences do not count.
 */
export function normalizePageQuote(text: string): string {
  return stripMarkdown(text)
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * A Jina Reader page is markdown: `[Datadog](https://… "Datadog")` reads as "Datadog" and
 * `**bold**` as "bold". Claude quotes the text a reader sees, so links, images and emphasis
 * markers are reduced to their text before a quote is matched.
 */
function stripMarkdown(text: string): string {
  return text.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1').replace(/\*\*|__|`/g, '')
}

/** True when `span` is on the page, given the page from `normalizePageQuote`. */
export function quoteOnPage(normalizedPage: string, span: string): boolean {
  // An ellipsis or closing punctuation inside the quote marks is not part of the page words.
  const needle = normalizePageQuote(span)
    .replace(/^(?:\.\.\.|\u2026)\s*/, '')
    .replace(/\s*(?:\.\.\.|\u2026)$/, '')
    .replace(/[.,;:!?]+$/, '')
    .trim()
  return needle.length > 0 && normalizedPage.includes(needle)
}

/**
 * Prose fields (mainGap, currentContent, a finding's detail) sometimes put a paraphrase in
 * double quotes. Rather than fail the whole matrix, a quoted span that is on neither the
 * page nor the buyer prompts loses its quote marks, so it no longer reads as a page quote.
 * Places (whereCovered) are left alone: a place that is not on the page still fails.
 */
export function unquoteOffPage<T>(value: T, options: { pageText: string; promptText?: string }): T {
  if (!isRecord(value) || !Array.isArray(value.rows)) return value
  const page = normalizePageQuote(options.pageText)
  const asked = normalizePageQuote(options.promptText ?? '')
  const clean = (text: unknown): unknown => {
    if (typeof text !== 'string') return text
    return text.replace(/"([^"\n]*)"/g, (whole, span: string) => {
      if (span.length < 12) return whole
      if (quoteOnPage(page, span) || (asked.length > 0 && quoteOnPage(asked, span))) return whole
      return span
    })
  }
  // Only fields the reply has are rewritten: a key added as undefined would fail a
  // schema with additionalProperties false (the split gap steps have no findings).
  const cleanFields = (record: Record<string, unknown>, fields: readonly string[]): unknown => {
    const out: Record<string, unknown> = { ...record }
    for (const field of fields) if (field in record) out[field] = clean(record[field])
    return out
  }
  const rows = value.rows.map((row: unknown) =>
    isRecord(row) ? cleanFields(row, ['mainGap', 'currentContent']) : row
  )
  if (!Array.isArray(value.findings)) return { ...value, rows } as T
  const findings = value.findings.map((finding: unknown) =>
    isRecord(finding) ? cleanFields(finding, ['detail']) : finding
  )
  return { ...value, rows, findings } as T
}

/**
 * Parts every page has, named the way the template lists them ("the H1", "the intro",
 * "a call to action"). They point at a part of the page rather than quote it.
 */
const PAGE_PARTS = new Set([
  'title',
  'title tag',
  'meta description',
  'h1',
  'intro',
  'introduction',
  'conclusion',
  'faq',
  'faqs',
  'faq section',
  'table',
  'cta',
  'call to action'
])

/**
 * A "where covered" place is on the page when its text is, also after a short label
 * such as "H3:", "FAQ:" or "Step 3:" and any surrounding quotes are removed. The rest
 * must still be copied from the page, so a made-up place is still rejected.
 */
export function placeOnPage(normalizedPage: string, place: string): boolean {
  if (PAGE_PARTS.has(normalizePageQuote(place))) return true
  if (quoteOnPage(normalizedPage, place)) return true
  const labelled = /^[^:"\u201C\u201D]{1,40}:\s*(.+)$/s.exec(place.trim())
  if (labelled === null || labelled[1] === undefined) return false
  const rest = labelled[1].trim().replace(/^["\u201C\u201D]+|["\u201C\u201D]+$/g, '')
  return quoteOnPage(normalizedPage, rest)
}

/**
 * Text inside straight double quotes, 12 characters or longer. Quotes are paired in
 * order first, so the words between two short quotes (`"??" ... a single "?"`) are
 * never read as a quote.
 */
export function quotedSpans(text: string): string[] {
  const spans: string[] = []
  for (const match of text.matchAll(/"([^"\n]*)"/g)) {
    const span = match[1]
    if (span !== undefined && span.length >= 12) spans.push(span)
  }
  return spans
}

function primaryLanguage(tag: string): string {
  return tag.split('-')[0]?.toLowerCase() ?? tag.toLowerCase()
}

function compile(schema: Record<string, unknown>): (value: unknown) => string | null {
  const validate = ajv.compile(schema)
  return (value) => (validate(value) ? null : ajv.errorsText(validate.errors, { separator: '; ' }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function listSources(sources: readonly string[]): string {
  if (sources.length <= 2) return sources.join(' and ')
  return `${sources.slice(0, -1).join(', ')}, and ${sources.at(-1)}`
}
