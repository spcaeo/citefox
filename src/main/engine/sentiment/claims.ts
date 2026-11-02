import Ajv from 'ajv'
import type {
  BrandFact,
  ClaimSourceKind,
  ClaimTone,
  FactProblem,
  SentimentReference
} from '@shared/domain'
import { sha256 } from '../../pipeline/hash'
import {
  SENTIMENT_CLAIMS_V2_SCHEMA,
  SENTIMENT_FACT_CHECK_SCHEMA
} from '../../pipeline/sentiment-templates'
import type { NewSentimentClaim } from '../../storage/sentiment-records'
import { normalizeUrl } from '../checks/url'

/**
 * Matching Claude's `sentiment_claims_v2.md` and `sentiment_fact_check.md` replies to
 * the project's brands and the overview's sources (FR-16.2, FR-16.5). Anything Claude
 * cannot back with the overview is dropped rather than stored: a sentence that is not
 * in the overview word for word, a brand that is not listed, a URL the overview did
 * not cite, or a fact check about a claim that was not sent.
 */

const ajv = new Ajv({ allErrors: true, strict: false })
const claimsValid = ajv.compile(SENTIMENT_CLAIMS_V2_SCHEMA)
const checksValid = ajv.compile(SENTIMENT_FACT_CHECK_SCHEMA)

/** One claim as `sentiment_claims_v2.md` returns it. */
export interface ClaimItem {
  brand: string
  theme: string
  attribute: string
  tone: ClaimTone
  sentence: string
  url: string | null
}

export interface ClaimsReply {
  brandsNamed: string[]
  reason: string
  claims: ClaimItem[]
}

export interface FactCheckReply {
  checks: { claimIndex: number; problem: FactProblem | null }[]
}

export function claimsSchemaError(value: unknown): string | null {
  return claimsValid(value) ? null : 'The reply did not match the schema.'
}

/** Schema, plus every `claimIndex` names one of the `count` claims that were sent. */
export function factCheckSchemaError(value: unknown, count: number): string | null {
  if (!checksValid(value)) return 'The reply did not match the schema.'
  const checks = (value as FactCheckReply).checks
  const outside = checks.find((check) => check.claimIndex >= count)
  if (outside !== undefined) {
    return `claimIndex ${outside.claimIndex} is not one of the ${count} claims (0 to ${count - 1}).`
  }
  return null
}

/**
 * The own brand's key is its first name; each competitor keeps the spelling the
 * project's flat list stores (so the sentiment view's columns match), and also
 * answers to its product name and domain when the page's product lists them.
 */
export interface BrandKeys {
  own: string | null
  aliases: readonly string[]
  competitors: readonly string[]
  /** Other spellings of a competitor (name, domain), by its stored key. */
  competitorAliases?: ReadonlyMap<string, readonly string[]>
}

export function brandKeys(
  brandNames: readonly string[],
  competitors: readonly string[],
  competitorAliases?: ReadonlyMap<string, readonly string[]>
): BrandKeys {
  const names = brandNames.map((name) => name.trim()).filter((name) => name.length > 0)
  return {
    own: names[0] ?? null,
    aliases: names,
    competitors: competitors.map((name) => name.trim()).filter((name) => name.length > 0),
    ...(competitorAliases !== undefined ? { competitorAliases } : {})
  }
}

/** `simpletexting.com`, `SimpleTexting` and `www.SimpleTexting.com` match each other. */
export function brandToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|io|co|net|org|app|ai|us|uk|co\.uk|de|fr|es|mx)(\/.*)?$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The stored brand key for a name Claude wrote, or null when it is not a listed brand. */
export function matchBrand(
  keys: BrandKeys,
  name: string
): { brand: string; isOwn: boolean } | null {
  const token = brandToken(name)
  if (token.length === 0) return null
  if (keys.own !== null && keys.aliases.some((alias) => brandToken(alias) === token)) {
    return { brand: keys.own, isOwn: true }
  }
  const competitor = keys.competitors.find(
    (item) =>
      brandToken(item) === token ||
      (keys.competitorAliases?.get(item) ?? []).some((alias) => brandToken(alias) === token)
  )
  return competitor === undefined ? null : { brand: competitor, isOwn: false }
}

/** Whitespace, quotes and case are ignored when checking a sentence is in the overview. */
export function normalizeQuote(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** NFR-7. The same overview text and cited sources hash the same. */
export function aioHash(text: string, references: readonly SentimentReference[]): string {
  return sha256(JSON.stringify({ text, urls: references.map((reference) => reference.url) }))
}

/** Where a claim's source sits, for "What's driving the negative claims". */
export function sourceKindFor(
  url: string | null,
  references: readonly SentimentReference[]
): ClaimSourceKind | null {
  if (url === null) return null
  const key = normalizeUrl(url)
  const reference = references.find((item) => normalizeUrl(item.url) === key)
  if (reference === undefined) return null
  if (reference.classification === 'target') return 'this_page'
  if (reference.classification === 'own') return 'own'
  if (reference.classification === 'competitor') return 'competitor'
  return reference.sourceType
}

export interface ProcessedReply {
  brandsNamed: string[]
  reason: string | null
  claims: Omit<NewSentimentClaim, 'id'>[]
  dropped: number
}

/** Keeps only what the overview backs. Fact problems come later, from the fact check. */
export function processReply(
  reply: ClaimsReply,
  context: {
    keys: BrandKeys
    aioText: string
    references: readonly SentimentReference[]
  }
): ProcessedReply {
  const overview = normalizeQuote(context.aioText)
  const cited = citedUrls(context.references)
  const claims: Omit<NewSentimentClaim, 'id'>[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const claim of reply.claims) {
    const brand = matchBrand(context.keys, claim.brand)
    const sentence = claim.sentence.replace(/\s+/g, ' ').trim()
    if (brand === null || sentence.length === 0 || !overview.includes(normalizeQuote(sentence))) {
      dropped += 1
      continue
    }
    const attribute = clean(claim.attribute, 160)
    const key = `${brand.brand}\n${attribute.toLowerCase()}\n${normalizeQuote(sentence)}`
    if (seen.has(key)) {
      dropped += 1
      continue
    }
    seen.add(key)
    const url =
      claim.url === null ? null : (cited.get(normalizeUrl(claim.url) ?? claim.url) ?? null)
    claims.push({
      brand: brand.brand,
      isOwn: brand.isOwn,
      theme: titleCase(clean(claim.theme, 60)),
      attribute,
      tone: claim.tone,
      sentence,
      url,
      factProblem: null
    })
  }
  const named: string[] = []
  for (const name of reply.brandsNamed) {
    const brand = matchBrand(context.keys, name)
    if (brand !== null && !named.includes(brand.brand)) named.push(brand.brand)
  }
  const reason = reply.reason.replace(/\s+/g, ' ').trim()
  return { brandsNamed: named, reason: reason.length === 0 ? null : reason, claims, dropped }
}

/** The claims the fact check is about: the own brand's, in reply order, numbered from 0. */
export function ownClaims(
  claims: readonly Omit<NewSentimentClaim, 'id'>[]
): Omit<NewSentimentClaim, 'id'>[] {
  return claims.filter((claim) => claim.isOwn)
}

/**
 * Joins the fact check to the claims it was about (FR-16.6). A problem needs brand
 * facts when its basis is `fact`, sits only on an own-brand claim, and may point to
 * fix a cited URL or one of the own pages the check was shown. The first check of a
 * claim wins.
 */
export function applyFactChecks(
  claims: readonly Omit<NewSentimentClaim, 'id'>[],
  reply: FactCheckReply,
  context: {
    facts: readonly BrandFact[]
    references: readonly SentimentReference[]
    /** Own page URLs the check was shown, the tracked page first. */
    ownUrls: readonly string[]
  }
): Omit<NewSentimentClaim, 'id'>[] {
  const own = ownClaims(claims)
  const cited = citedUrls(context.references)
  const ownPages = new Map(context.ownUrls.map((url) => [normalizeUrl(url) ?? url, url] as const))
  const problems = new Map<Omit<NewSentimentClaim, 'id'>, FactProblem>()
  for (const check of reply.checks) {
    const claim = own[check.claimIndex]
    if (claim === undefined || problems.has(claim)) continue
    const problem = keepProblem(check.problem, context.facts, cited, ownPages)
    if (problem !== null) problems.set(claim, problem)
  }
  return claims.map((claim) => {
    const problem = problems.get(claim)
    return problem === undefined ? claim : { ...claim, factProblem: problem }
  })
}

function citedUrls(references: readonly SentimentReference[]): Map<string, string> {
  return new Map(
    references.map((reference) => [normalizeUrl(reference.url) ?? reference.url, reference.url])
  )
}

function keepProblem(
  problem: FactProblem | null,
  facts: readonly BrandFact[],
  cited: ReadonlyMap<string, string>,
  ownPages: ReadonlyMap<string, string>
): FactProblem | null {
  if (problem === null) return null
  if (problem.basis === 'fact' && facts.length === 0) return null
  const why = problem.why.replace(/\s+/g, ' ').trim()
  const correction = problem.correction.replace(/\s+/g, ' ').trim()
  if (why.length === 0 || correction.length === 0) return null
  let sourceToFix: string | null = null
  if (problem.sourceToFix !== null) {
    const key = normalizeUrl(problem.sourceToFix)
    if (key !== null) sourceToFix = cited.get(key) ?? ownPages.get(key) ?? null
  }
  return { basis: problem.basis, why, correction, sourceToFix }
}

function clean(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max).trim() : text
}

/** Themes are grouped by name, so "pricing" and "Pricing" are one theme. */
function titleCase(value: string): string {
  if (value.length === 0) return 'Other'
  return value.charAt(0).toUpperCase() + value.slice(1)
}
