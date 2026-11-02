import { FAQ_DRAFT_MAX_WORDS, FAQ_DRAFT_MIN_WORDS, type CoverageAction } from '@shared/domain'
import Ajv from 'ajv'
import type { ValidationProblem } from './errors'
import { wordCount } from './hash'
import { COVERAGE_FIXES_SCHEMA, COVERAGE_MATRIX_SCHEMA, PAGE_AUDIT_SCHEMA } from './schemas'
import {
  brandIn,
  firstProblem,
  normalizePageQuote,
  placeOnPage,
  quoteOnPage,
  quotedSpans
} from './validate'

/**
 * Code checks for the three content-gap steps (Docs/PROMPT-AUDIT.md, package P1):
 * `coverage_matrix`, `page_audit` and `coverage_fixes`. Each returns the first
 * problem, which `completeStructured` sends back to Claude once.
 */

const ajv = new Ajv({ allErrors: true, strict: false })
const matrixSchemaError = compile(COVERAGE_MATRIX_SCHEMA)
const auditSchemaError = compile(PAGE_AUDIT_SCHEMA)
const fixesSchemaError = compile(COVERAGE_FIXES_SCHEMA)

/** One `coverage_matrix` row as Claude returns it. */
export interface MatrixDraftRow {
  position: number
  coverage: 'strong' | 'partial' | 'weak' | 'none'
  whereCovered: string[]
  mainGap: string
  priority: 'high' | 'medium' | 'low'
  actions: CoverageAction[]
}

/** One `page_audit` finding as Claude returns it. */
export interface AuditDraftFinding {
  type: 'title_meta_mismatch' | 'factual_claim' | 'missing_promised_section' | 'typo' | 'other'
  text: string
  quote: string
  correction: string | null
  verify: string | null
}

/** One `coverage_fixes` row as Claude returns it. */
export interface FixDraftRow {
  position: number
  currentContent: string
  whatToUpdate: string
  suggestedFaq: { question: string; answer: string }
}

/** What a quote may be checked against: the page, and the buyer prompts it may echo. */
export interface QuoteSources {
  pageText: string
  /** The buyer prompts of the call. A row may quote the buyer's own words. */
  promptText?: string
}

export function validateCoverageMatrix(
  value: unknown,
  options: QuoteSources & { positions: readonly number[] }
): ValidationProblem | null {
  return firstProblem(value, matrixSchemaError(value), () => {
    const rows = (value as { rows: MatrixDraftRow[] }).rows
    const problem = positionProblem(
      rows.map((row) => row.position),
      options.positions,
      'coverage rows'
    )
    if (problem !== null) return problem
    const page = normalizePageQuote(options.pageText)
    const quotable = quoteCheck(options)
    for (const row of rows) {
      if (row.coverage === 'none' && row.whereCovered.length > 0) {
        return {
          code: 'schema_validation',
          message: `Position ${row.position} is none, so whereCovered must be empty.`
        }
      }
      if (row.coverage !== 'none' && row.whereCovered.length === 0) {
        return {
          code: 'schema_validation',
          message: `Position ${row.position} does not say where the page covers it.`
        }
      }
      const missing = row.whereCovered.find((place) => !placeOnPage(page, place))
      if (missing !== undefined) {
        return {
          code: 'quote_not_on_page',
          message: `A quoted heading is not on the page: "${missing}".`
        }
      }
      const span = quotedSpans(row.mainGap).find((item) => !quotable(item))
      if (span !== undefined) {
        return { code: 'quote_not_on_page', message: `A quote is not on the page: "${span}".` }
      }
    }
    return null
  })
}

export function validatePageAudit(
  value: unknown,
  options: { pageText: string }
): ValidationProblem | null {
  return firstProblem(value, auditSchemaError(value), () => {
    const findings = (value as { findings: AuditDraftFinding[] }).findings
    const page = normalizePageQuote(options.pageText)
    for (const finding of findings) {
      if (!quoteOnPage(page, finding.quote)) {
        return {
          code: 'quote_not_on_page',
          message: `A finding's quote is not on the page: "${finding.quote}". Copy the words exactly.`
        }
      }
    }
    return null
  })
}

/**
 * The audit reply without findings whose quote is not on the page. A finding code
 * cannot point to on the page is dropped instead of failing the whole audit (live
 * run on /pricing: one quote copied a markdown link, and the retry answered in
 * prose). Anything that is not an audit-shaped object passes through unchanged.
 */
export function keepOnPageFindings(value: unknown, pageText: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const findings = (value as { findings?: unknown }).findings
  if (!Array.isArray(findings)) return value
  const page = normalizePageQuote(pageText)
  return {
    ...value,
    findings: findings.filter((finding: unknown) => {
      const quote = (finding as { quote?: unknown } | null)?.quote
      return typeof quote !== 'string' || quoteOnPage(page, quote)
    })
  }
}

/** A number the page audit marks wrong, with the word after it ("155 characters"). */
export interface WrongFact {
  number: string
  word: string
}

/**
 * Numbers in a `factual_claim` quote that its correction does not repeat, each with
 * the word that follows it on the page. A draft that writes "155 characters" again
 * repeats the wrong fact.
 */
export function wrongFacts(findings: readonly AuditDraftFinding[]): WrongFact[] {
  const facts: WrongFact[] = []
  for (const finding of findings) {
    if (finding.type !== 'factual_claim' || finding.correction === null) continue
    const corrected = new Set(finding.correction.match(/\d[\d,.]*/gu) ?? [])
    for (const match of finding.quote.matchAll(/(\d[\d,.]*)\s+([A-Za-z]+)/gu)) {
      const number = match[1] ?? ''
      const word = match[2] ?? ''
      // Wrong only when the correction gives another number for the same thing
      // ("155 characters" → "160 GSM-7 characters"); a number the correction does
      // not touch ("1 credit" beside a wrong character count) stays usable.
      if (
        number.length > 0 &&
        word.length > 0 &&
        !corrected.has(number) &&
        replacesUnit(finding.correction, word)
      ) {
        facts.push({ number, word: word.toLowerCase() })
      }
    }
  }
  return facts
}

/** True when `correction` puts a number at most two words before `word`. */
function replacesUnit(correction: string, word: string): boolean {
  const unit = escapeRegex(word.toLowerCase().replace(/s$/u, ''))
  return new RegExp(`\\d[\\d,.]*\\s+(?:[\\w-]+\\s+){0,2}${unit}s?\\b`, 'iu').test(correction)
}

export function validateCoverageFixes(
  value: unknown,
  options: QuoteSources & {
    positions: readonly number[]
    brands: readonly string[]
    wrongFacts: readonly WrongFact[]
  }
): ValidationProblem | null {
  return firstProblem(value, fixesSchemaError(value), () => {
    const rows = (value as { rows: FixDraftRow[] }).rows
    const problem = positionProblem(
      rows.map((row) => row.position),
      options.positions,
      'fixes'
    )
    if (problem !== null) return problem
    const quotable = quoteCheck(options)
    for (const row of rows) {
      const faq = row.suggestedFaq
      const words = wordCount(faq.answer)
      if (words < FAQ_DRAFT_MIN_WORDS || words > FAQ_DRAFT_MAX_WORDS) {
        return {
          code: 'schema_validation',
          message: `The new FAQ at position ${row.position} is ${words} words. It must be ${FAQ_DRAFT_MIN_WORDS} to ${FAQ_DRAFT_MAX_WORDS}.`
        }
      }
      const brand = brandIn(faq.question, options.brands)
      if (brand !== null) {
        return {
          code: 'brand_in_prompt',
          message: `The FAQ question at position ${row.position} names "${brand}". Write it as the buyer would ask, without the brand.`
        }
      }
      for (const price of faq.answer.match(/[$€£]\s?\d[\d,]*(?:\.\d+)?/gu) ?? []) {
        const compact = price.replace(/\s+/gu, '')
        if (!options.pageText.includes(compact) && !options.pageText.includes(price)) {
          return {
            code: 'schema_validation',
            message: `A draft names a price the page does not confirm (${compact}).`
          }
        }
      }
      for (const fact of options.wrongFacts) {
        const repeated = new RegExp(
          `(?<![\\d.,])${escapeRegex(fact.number)}\\s+${escapeRegex(fact.word)}`,
          'iu'
        )
        if (repeated.test(row.whatToUpdate) || repeated.test(faq.answer)) {
          return {
            code: 'schema_validation',
            message: `Position ${row.position} repeats "${fact.number} ${fact.word}", which the page audit marks wrong. Use the corrected fact, or leave the number out.`
          }
        }
      }
      // whatToUpdate proposes new words, so its quotes are not page quotes.
      const span = quotedSpans(row.currentContent).find((item) => !quotable(item))
      if (span !== undefined) {
        return { code: 'quote_not_on_page', message: `A quote is not on the page: "${span}".` }
      }
    }
    return null
  })
}

function positionProblem(
  got: readonly number[],
  wanted: readonly number[],
  noun: string
): ValidationProblem | null {
  if (got.length !== wanted.length) {
    return {
      code: 'schema_validation',
      message: `Expected ${wanted.length} ${noun} and received ${got.length}.`
    }
  }
  const seen = new Set<number>()
  for (const position of got) {
    if (seen.has(position)) {
      return { code: 'schema_validation', message: `Position ${position} is repeated.` }
    }
    seen.add(position)
  }
  const missing = wanted.find((position) => !seen.has(position))
  if (missing !== undefined) {
    return {
      code: 'schema_validation',
      message: `Position ${missing} is missing. Use the prompt numbers given: ${wanted.join(', ')}.`
    }
  }
  return null
}

function quoteCheck(options: QuoteSources): (span: string) => boolean {
  const page = normalizePageQuote(options.pageText)
  const asked = normalizePageQuote(options.promptText ?? '')
  return (span) => quoteOnPage(page, span) || (asked.length > 0 && quoteOnPage(asked, span))
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function compile(schema: Record<string, unknown>): (value: unknown) => string | null {
  const validate = ajv.compile(schema)
  return (value) => (validate(value) ? null : ajv.errorsText(validate.errors, { separator: '; ' }))
}
