import type { SqliteDatabase } from '../../storage/database'
import { competitorBlock, productBlock } from '../../prompts/blocks'
import { competitorContext } from '../competitor-context'
import { competitorLabel, storedCompetitor } from './competitor-match'
import type { AioGapPromptSection, ReportReferenceLine } from './report-files'
import { statusLabel } from './report-files'
import { hostOf, normalizeUrl } from './url'

/**
 * What the check reports tell Claude about the page's market position
 * (Docs/PROMPT-AUDIT.md, P6 1 and 2): the page's product and its own competitors
 * (same product, different competitors), each cited source marked as this page, an
 * own page or a named competitor, and per prompt what the overview leans on and what
 * it states that the page does not. Code builds all of it; Claude only reads it.
 */

/** Sources listed per prompt in the summary. */
const SUMMARY_SOURCES = 6
/** Gap facts listed per prompt in the summary. */
const SUMMARY_FACTS = 4

export interface PageCompetitorText {
  /** `{{ product }}`. */
  product: string
  /** `{{ competitors }}`: the product's direct and partial competitors, and what they are not. */
  competitors: string
  /**
   * "competitor: ClickSend, direct" for a source the check stored as a competitor, else
   * null. It follows the stored class (one matcher, `competitor-match.ts`), so the text
   * never calls a source a competitor that the numbers count as other, or the reverse.
   */
  competitorOf: (reference: CompetitorSource) => string | null
}

/** A cited source as the check stored it. */
export type CompetitorSource = Pick<ReportReferenceLine, 'url' | 'classification'>

export function pageCompetitorText(db: SqliteDatabase, pageId: string): PageCompetitorText {
  const context = competitorContext(db, { pageId })
  return {
    product: productBlock(context.product),
    competitors: competitorBlock(context, { withRule: false }),
    competitorOf(reference) {
      const hit = storedCompetitor(reference, context)
      return hit === null ? null : competitorLabel(hit)
    }
  }
}

/** "3. Pricing — https://clicksend.com/us/pricing (competitor: ClickSend, direct)". */
export function referenceText(
  reference: ReportReferenceLine,
  competitorOf: (reference: CompetitorSource) => string | null
): string {
  const whose =
    reference.classification === 'this page'
      ? 'this page'
      : reference.classification === 'own'
        ? 'own page'
        : competitorOf(reference)
  return `${reference.position}. ${reference.title} — ${reference.url}${whose === null ? '' : ` (${whose})`}`
}

/**
 * `{{ prompts }}` for the run summary: per prompt, its status, the sources its overview
 * cites in order, and the facts it states that the page does not, with their sources.
 */
export function promptResultLines(
  prompts: readonly AioGapPromptSection[],
  competitorOf: (reference: CompetitorSource) => string | null
): string {
  return prompts
    .map((prompt) => {
      const lines = [`${prompt.position}. "${prompt.text}" — ${statusLabel(prompt.status)}`]
      if (prompt.references.length > 0) {
        const sources = prompt.references
          .slice(0, SUMMARY_SOURCES)
          .map((reference) => referenceText(reference, competitorOf).replace(/^\d+\. /u, ''))
        lines.push(`   Sources cited, in order: ${sources.join(' | ')}`)
      } else if (prompt.overview === null) {
        lines.push('   No AI Overview.')
      }
      const facts = prompt.facts.slice(0, SUMMARY_FACTS)
      if (facts.length > 0) {
        lines.push('   The overview states, the page does not:')
        for (const fact of facts) {
          lines.push(
            `   - ${fact.fact}${fact.likelySource === null ? '' : ` (${fact.likelySource})`}`
          )
        }
      }
      return lines.join('\n')
    })
    .join('\n')
}

/**
 * A gap fact's likely source, kept only when it names one of the overview's cited
 * sources: that source's URL (matched by URL or by a URL in the text), or its domain.
 * Anything else ("Twilio help article (ref 5)", an uncited site) becomes null.
 */
export function cleanLikelySource(
  value: string | null,
  references: readonly Pick<ReportReferenceLine, 'url'>[]
): string | null {
  if (value === null) return null
  const text = value.trim()
  if (text.length === 0) return null
  const byUrl = new Map(
    references.map((reference) => [normalizeUrl(reference.url) ?? reference.url, reference.url])
  )
  const candidates = [text, ...(text.match(/https?:\/\/[^\s)"'<>]+/gu) ?? [])]
  for (const candidate of candidates) {
    const withScheme = /^https?:\/\//u.test(candidate) ? candidate : `https://${candidate}`
    const key = normalizeUrl(withScheme)
    if (key !== null && byUrl.has(key)) return byUrl.get(key) ?? null
  }
  const domain = text
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/^www\./u, '')
    .replace(/\/+$/u, '')
  const cited = references.find((reference) => hostOf(reference.url) === domain)
  return cited === undefined ? null : domain
}

/**
 * Claude's summary body with its line breaks kept (the numbered next actions), spaces
 * tidied, and no `#` headings, which would end the `## Body` section of the file.
 */
export function summaryBodyText(body: string): string {
  return body
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/gu, ' ')
        .trimEnd()
        .replace(/^#{1,6}\s+/u, '')
    )
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}
