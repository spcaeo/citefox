import type { AioReference, IntentStage, PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import { resultOf } from '../../metrics/rows'
import type { PreparedPage } from '../prepare'
import type { ExportCheck, ExportPage } from '../types'
import type { ReportMarketFacts } from './input'
import type { FunnelStage, ReportMarket, ReportPage, ReportReference, ReportRow } from './types'

const AIO_STATUSES: ReadonlySet<PromptCheckStatus> = new Set([
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited'
])

const EXCERPT_CHARS = 600

/** One page in one market: its latest full check, the full check before it, and its history. */
export interface ScopeSlice {
  page: ExportPage
  marketId: string
  current: ExportCheck
  previous: ExportCheck | null
  /** Every finished check in the data window, oldest first, partial ones included. */
  history: readonly ExportCheck[]
}

/** The previous full check's result for the same prompt, page and market. */
export interface PreviousResult {
  status: PromptCheckStatus
  named: boolean
  cited: boolean
  position: number | null
  aioText: string | null
  checkedAt: string
}

export interface ScopeData {
  rows: ReportRow[]
  references: ReportReference[]
  slices: ScopeSlice[]
  /** Full overview text per row id, for answer shape. */
  aioText: ReadonlyMap<string, string>
  previous: ReadonlyMap<string, PreviousResult>
  /** Every check of every slice in the window, for the cover's data window. */
  windowChecks: readonly ExportCheck[]
}

export function isAioStatus(status: PromptCheckStatus): boolean {
  return AIO_STATUSES.has(status)
}

export function funnelStage(stage: IntentStage): FunnelStage | null {
  if (stage === 'problem' || stage === 'trigger') return 'TOFU'
  if (stage === 'solution' || stage === 'comparison') return 'MOFU'
  if (stage === 'objection') return 'BOFU'
  return null
}

/**
 * Rows for the report: for each prepared page and market, the latest full check among the
 * selected checks. Partial checks never enter headline totals (SRS section 7.4).
 */
export function collectScope(pages: readonly PreparedPage[]): ScopeData {
  const rows: ReportRow[] = []
  const references: ReportReference[] = []
  const slices: ScopeSlice[] = []
  const aioText = new Map<string, string>()
  const previous = new Map<string, PreviousResult>()
  const windowChecks: ExportCheck[] = []
  for (const prepared of pages) {
    for (const market of prepared.markets) {
      const history = byTime(
        prepared.page.markets.find((slice) => slice.marketId === market.marketId)?.checks ?? []
      )
      windowChecks.push(...history)
      const selected = byTime(market.checks.map((item) => item.check))
      const current = [...selected].reverse().find((check) => !check.metrics.partial)
      if (current === undefined) continue
      const before =
        [...history]
          .reverse()
          .find((check) => !check.metrics.partial && check.finishedAt < current.finishedAt) ?? null
      slices.push({
        page: prepared.page,
        marketId: market.marketId,
        current,
        previous: before,
        history
      })
      const previousRows = new Map((before?.prompts ?? []).map((row) => [row.promptId, row]))
      const previousText = new Map(
        (before?.details ?? []).map((detail) => [detail.promptId, detail.aioText])
      )
      const details = new Map(current.details.map((detail) => [detail.promptId, detail]))
      for (const source of current.prompts) {
        const id = `r${rows.length + 1}`
        const text = details.get(source.promptId)?.aioText ?? null
        const row = toRow(id, source, prepared.page.pageId, market.marketId, current, text)
        rows.push(row)
        if (text !== null && text.trim().length > 0 && row.aio) aioText.set(id, text)
        for (const reference of uniqueReferences(source.references)) {
          references.push(toReference(id, reference))
        }
        const prior = previousRows.get(source.promptId)
        if (before !== null && prior !== undefined) {
          previous.set(id, {
            status: prior.status,
            named: prior.named === true,
            cited: citesYou(prior),
            position: prior.position,
            aioText: previousText.get(source.promptId) ?? null,
            checkedAt: before.finishedAt
          })
        }
      }
    }
  }
  return { rows, references, slices, aioText, previous, windowChecks }
}

function toRow(
  id: string,
  source: PromptCheckRow,
  pageId: string,
  marketId: string,
  check: ExportCheck,
  text: string | null
): ReportRow {
  const aio = isAioStatus(source.status)
  const result = resultOf(source)
  const cited = result === 'target' || result === 'other'
  const named = aio && source.named === true
  return {
    id,
    promptId: source.promptId,
    pageId,
    marketId,
    runId: check.metrics.runId,
    number: source.promptPosition,
    label: source.label,
    text: source.text,
    stage: source.intentStage,
    funnel: funnelStage(source.intentStage),
    source: source.source,
    status: source.status,
    aio,
    cited,
    pageCited: result === 'target',
    named,
    wrongPage: result === 'other',
    notVisible: aio && !cited && !named,
    citedUrl: source.citedUrl,
    position: source.position,
    topDomains: topDomains(source.references),
    checkedAt: source.checkedAt ?? check.finishedAt,
    aioExcerpt: aio && text !== null ? clip(text.replace(/\s+/g, ' ').trim(), EXCERPT_CHARS) : null
  }
}

/**
 * "Cited" has one meaning everywhere (Docs/METRICS.md): an AI answer showed and a page of
 * yours is among its sources. The same rule as Summary and `reports:metrics`.
 */
export function citesYou(row: Pick<PromptCheckRow, 'status' | 'references' | 'named'>): boolean {
  const result = resultOf(row)
  return result === 'target' || result === 'other'
}

export function toReference(rowId: string, reference: AioReference): ReportReference {
  return {
    rowId,
    position: reference.position,
    url: reference.url,
    normalizedUrl: reference.normalizedUrl,
    domain: reference.domain,
    title: reference.title,
    classification: reference.classification,
    untracked: reference.untracked,
    sourceType: reference.sourceType
  }
}

/** One reference per normalized URL, the best (lowest) position kept. */
export function uniqueReferences(references: readonly AioReference[]): AioReference[] {
  const best = new Map<string, AioReference>()
  for (const reference of references) {
    const found = best.get(reference.normalizedUrl)
    if (found === undefined || reference.position < found.position) {
      best.set(reference.normalizedUrl, reference)
    }
  }
  return [...best.values()].sort((left, right) => left.position - right.position)
}

function topDomains(references: readonly AioReference[]): string[] {
  const domains: string[] = []
  for (const reference of [...references].sort((a, b) => a.position - b.position)) {
    if (domains.includes(reference.domain)) continue
    domains.push(reference.domain)
    if (domains.length === 3) break
  }
  return domains
}

function byTime(checks: readonly ExportCheck[]): ExportCheck[] {
  return [...checks].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt))
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

/** `US-EN`, `US · EN` and the flag for a market. Falls back to the slice code `us-en`. */
export function reportMarket(
  marketId: string,
  sliceCode: string,
  facts: readonly ReportMarketFacts[]
): ReportMarket {
  const found = facts.find((market) => market.id === marketId)
  const [codeCountry, codeLanguage] = sliceCode.split('-')
  const country = (found?.country ?? codeCountry ?? marketId).toUpperCase()
  const language = (found?.language ?? codeLanguage ?? '').toUpperCase()
  return {
    id: marketId,
    code: language.length > 0 ? `${country}-${language}` : country,
    label: language.length > 0 ? `${country} · ${language}` : country,
    flag: flagOf(country)
  }
}

function flagOf(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return ''
  const base = 0x1f1e6
  return String.fromCodePoint(
    base + (country.charCodeAt(0) - 65),
    base + (country.charCodeAt(1) - 65)
  )
}

/** `/blog/x` from a URL. The URL itself when it does not parse. */
export function urlPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

export function trackedPage(page: ExportPage): ReportPage {
  return {
    id: page.pageId,
    url: page.url,
    path: urlPath(page.url),
    title: page.title,
    role: 'tracked'
  }
}
