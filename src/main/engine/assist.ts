import { ASSIST_OUTPUT_RULES, WEB_SEARCH_OUTPUT_RULES } from '../assist/preamble'
import { progressRetryNext, progressStep } from '../assist/progress'
import { REDACTED_PROMPT } from '../logging/redact'
import { renderAssistShape, type AssistShape } from './assist-shapes'
import type { SuggestedCompany } from './competitor-guard'
import { isNotAnAnswer } from '../assist/answer-guard'
import { PipelineError } from '../pipeline/errors'
import type { EngineHost } from './host'
import { projectClaudeModel, resolveClaude } from './claude'

/**
 * One Claude JSON call for an assist that is not a stored generation kind.
 * Runs on the project's Claude connection, fallback, and model (FR-11.7, LLM-5);
 * a null project (New project's Fill from website) uses Settings.
 * The prompt ends with the shared output rules (FR-25.5), is not written to
 * the log, and the call is logged in `llm_calls` under `trace.assistId`.
 * `shape` names the reply's JSON keys (no schema is sent to Claude Code); pass null
 * only when the prompt already spells out its own shape.
 * `options.webSearch` allows web search and web fetch for this one call only (batch 2
 * row 5); see `claudePrintArgs` for why that is safe. Every other assist runs tools off.
 */
export async function completeAssist(
  host: EngineHost,
  channel: string,
  prompt: string,
  accept: (value: unknown) => boolean,
  shape: AssistShape | null,
  trace: { assistId: string; projectId: string | null },
  options: AssistCallOptions = {}
): Promise<unknown> {
  const provider = resolveClaude(host, channel, trace.projectId)
  const model = projectClaudeModel(host, trace.projectId)
  // The task stays first (callers and fixtures read its first lines); the rules follow.
  const shapeText = shape === null ? '' : `\n\n${renderAssistShape(shape)}`
  const rules =
    options.rules ?? (options.webSearch === true ? WEB_SEARCH_OUTPUT_RULES : ASSIST_OUTPUT_RULES)
  const ruled = `${prompt}\n\n${rules}${shapeText}`
  let current = ruled
  for (let attempt = 0; attempt < 2; attempt += 1) {
    host.logger.info('claude assist', {
      channel,
      assistId: trace.assistId,
      attempt,
      prompt: REDACTED_PROMPT,
      promptLength: current.length
    })
    let json: unknown
    try {
      const completion = await provider.complete({
        prompt: current,
        schema: null,
        model,
        maxTokens: options.maxTokens ?? 4000,
        ...(options.webSearch === true ? { webSearch: true } : {}),
        ...(options.progress !== undefined ? { progress: options.progress } : {}),
        ...(options.onStart !== undefined ? { onStart: options.onStart } : {}),
        trace: {
          source: 'assist',
          projectId: trace.projectId,
          assistId: trace.assistId,
          templateKind: null,
          templateId: null,
          templateHash: null
        }
      })
      json = completion.json ?? parseJson(completion.text)
    } catch (error) {
      // Which step asked and the short reason; the AI call itself logs its own line.
      host.logger.warn('claude assist failed', {
        channel,
        assistId: trace.assistId,
        attempt,
        reason: errorReason(error)
      })
      const message = error instanceof Error ? error.message : 'The CiteFox AI call failed'
      throw new PipelineError(message, {
        code: 'fetch_failed',
        nextStep: 'Try again.',
        secrets: host.knownSecrets()
      })
    }
    const check = progressStep({ kind: 'check', label: 'Checking the answer' })
    if (accept(json)) {
      check.done()
      return json
    }
    host.logger.warn('claude assist reply did not match the shape', {
      channel,
      assistId: trace.assistId,
      attempt
    })
    if (attempt === 0) {
      check.fail('It did not match the expected shape · asking again')
      progressRetryNext()
    } else {
      check.fail('It did not match the expected shape')
    }
    current = `${ruled}\n\nThe previous reply did not match the JSON shape for this step. Reply with JSON only, using exactly the keys shown.`
  }
  throw new PipelineError('The reply did not match the schema.', {
    code: 'schema_validation',
    nextStep: 'Try again.'
  })
}

/** A short reason code for a log line: the error's own code, else its type. Never its message. */
function errorReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && /^[a-z_]{1,32}$/u.test(code)) return code
  }
  return error instanceof Error ? error.name : typeof error
}

/** Per-call options for {@link completeAssist}. */
export interface AssistCallOptions {
  /** Web search and web fetch for this call only (competitors per product). */
  webSearch?: boolean
  maxTokens?: number
  /** The live step's label and detail, when the assist id's purpose is not enough. */
  progress?: { label?: string; detail?: string }
  /** The call got its turn at the concurrency gate and starts now (see `ClaudeCompletionRequest`). */
  onStart?: () => void
  /** Rules in place of the shared ones (the site read: its own task, not a page in AI Overviews). */
  rules?: string
}

export interface SiteMarket {
  country: string
  language: string
  location: string | null
  reason: string
}

/** One product the site sells (batch 2 row 5). */
export interface SiteProduct {
  name: string
  job: string
  buyer: string
  evidence: { path: string; quote: string } | null
}

/** Step 1 of Fill from my website (no tools): summary, brands, products, market. */
export interface SiteRead {
  summary: string | null
  brands: { name: string; reason: string }[]
  products: SiteProduct[]
  /** Live products the pages compare it with by name; a hint for the competitor search. */
  comparedWith: string[]
  /** Industries, roles, teams and use cases the pages say it is for (may be empty). */
  audiences: SiteAudience[]
  suggestedMarket: SiteMarket | null
}

/** One industry, role, team or use case the pages name, with the words that show it. */
export interface SiteAudience {
  name: string
  evidence: { path: string; quote: string } | null
}

/** Most audiences kept from one read. */
export const MAX_AUDIENCES = 10

/** Most products asked about: one web-search call each. */
export const MAX_PRODUCTS = 3

export function parseSiteRead(value: unknown): SiteRead | null {
  if (!isRecord(value) || !Array.isArray(value.brands) || !Array.isArray(value.products)) {
    return null
  }
  const brands: SiteRead['brands'] = []
  for (const entry of value.brands) {
    if (!isRecord(entry)) return null
    const name = text(entry.name)
    const reason = text(entry.reason)
    if (name === null || reason === null) return null
    brands.push({ name, reason })
  }
  const products: SiteProduct[] = []
  for (const entry of value.products) {
    if (!isRecord(entry)) return null
    // "[mainly in the US]": the shared rules bracket unconfirmed facts; a product line drops them.
    const unbracket = (value: unknown): unknown =>
      typeof value === 'string' ? value.replace(/\[([^\]]*)\]/gu, '$1') : value
    const name = text(unbracket(entry.name))
    const job = text(unbracket(entry.job))
    const buyer = text(unbracket(entry.buyer))
    if (name === null || job === null || buyer === null) return null
    products.push({ name, job, buyer, evidence: evidenceOf(entry.evidence) })
  }
  if (value.summary !== null && value.summary !== undefined && typeof value.summary !== 'string') {
    return null
  }
  const said = typeof value.summary === 'string' ? text(value.summary) : null
  // Claude talking about itself ("I can't open the site") is not a summary.
  const summary = said !== null && isNotAnAnswer(said) ? null : said
  const market = parseMarket(value.suggestedMarket)
  if (market === undefined) return null
  const comparedWith = Array.isArray(value.comparedWith)
    ? value.comparedWith
        .map((entry) => text(entry))
        .filter((entry): entry is string => entry !== null && entry.length <= 80)
        .slice(0, 20)
    : []
  return {
    summary,
    brands,
    products: products.slice(0, MAX_PRODUCTS),
    comparedWith,
    audiences: audiencesOf(value.audiences),
    suggestedMarket: market
  }
}

/** The optional `audiences` list; a malformed entry is skipped, never a failed read. */
function audiencesOf(value: unknown): SiteAudience[] {
  if (!Array.isArray(value)) return []
  const out: SiteAudience[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const name = text(entry.name)
    if (name === null || name.length > 120) continue
    out.push({ name, evidence: evidenceOf(entry.evidence) })
  }
  return out.slice(0, MAX_AUDIENCES)
}

/** Step 3 of Fill from my website (no tools): what buyers switch from, and integrations. */
export function parseSwitching(
  value: unknown
): { switchingFrom: SuggestedCompany[]; integrations: SuggestedCompany[] } | null {
  if (!isRecord(value)) return null
  const switchingFrom = parseCompanies(value.switchingFrom)
  const integrations = parseCompanies(value.integrations)
  if (switchingFrom === null || integrations === null) return null
  return { switchingFrom, integrations }
}

/** A market object, null, or undefined when it is malformed. */
function parseMarket(value: unknown): SiteMarket | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined
  const country = text(value.country)
  const language = text(value.language)
  const reason = text(value.reason)
  if (country === null || language === null || reason === null) return undefined
  if (
    value.location !== null &&
    value.location !== undefined &&
    typeof value.location !== 'string'
  ) {
    return undefined
  }
  const location = typeof value.location === 'string' ? text(value.location) : null
  return { country, language, location, reason }
}

function evidenceOf(value: unknown): { path: string; quote: string } | null {
  if (!isRecord(value)) return null
  const path = text(value.path)
  const quote = text(value.quote)
  return path !== null && quote !== null ? { path, quote } : null
}

/**
 * Competitors, switching-from options or integrations: `{name, domain|null, reason,
 * evidence:{path, quote}}` each. Evidence may be null; the guard then cannot use it.
 */
export function parseCompanies(value: unknown): SuggestedCompany[] | null {
  if (!Array.isArray(value)) return null
  const items: SuggestedCompany[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const name = text(entry.name)
    const reason = text(entry.reason)
    if (name === null || reason === null) return null
    if (entry.domain !== null && entry.domain !== undefined && typeof entry.domain !== 'string') {
      return null
    }
    const domain = typeof entry.domain === 'string' ? text(entry.domain) : null
    const evidence = evidenceOf(entry.evidence)
    // Optional lookup candidate (Fill from my website); never shown until verified.
    const officialDomain =
      typeof entry.officialDomain === 'string' ? text(entry.officialDomain) : null
    items.push(
      officialDomain === null
        ? { name, domain, reason, evidence }
        : { name, domain, reason, evidence, officialDomain }
    )
  }
  return items
}

/**
 * The reply as JSON. A web-search reply may wrap the JSON in a sentence or a code fence
 * ("Here is what I found: ```json {…} ```"): the fenced block, else the outermost
 * `{…}`, is used. Anything else is null and the reply is asked again.
 */
export function parseJson(textValue: string): unknown {
  const attempt = (value: string): unknown => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  const whole = attempt(textValue.trim())
  if (whole !== null) return whole
  const fences = [...textValue.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)]
  for (const fence of fences.reverse()) {
    const fenced = attempt((fence[1] ?? '').trim())
    if (fenced !== null) return fenced
  }
  const start = textValue.indexOf('{')
  const end = textValue.lastIndexOf('}')
  return start >= 0 && end > start ? attempt(textValue.slice(start, end + 1)) : null
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 8000) return null
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
