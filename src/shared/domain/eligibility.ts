/**
 * Whether Google may show and quote a page in AI Overviews, from the HTML and
 * headers of a direct page read. AI Overviews follow Google Search's own controls
 * (noindex, nosnippet, max-snippet, data-nosnippet). Google-Extended in robots.txt
 * does not control them, so it is not checked.
 */

export const ELIGIBILITY_CODES = ['noindex', 'nosnippet', 'max_snippet', 'data_nosnippet'] as const
export type EligibilityCode = (typeof ELIGIBILITY_CODES)[number]

/** Where the page says it: a robots or googlebot meta tag, the X-Robots-Tag header, or the body HTML. */
export type EligibilityWhere = 'meta' | 'header' | 'html'

export interface EligibilityIssue {
  code: EligibilityCode
  where: EligibilityWhere
  /** The directive as the page has it, such as `max-snippet:20` or `noindex`. */
  detail: string
}

/** Null on a page read means the read did not see the HTML (Jina Reader, a supplied file). */
export interface PageEligibility {
  issues: readonly EligibilityIssue[]
}

/** A max-snippet under this many characters leaves too little for an AI Overview to quote. */
export const MIN_SNIPPET_CHARS = 50

/** data-nosnippet covering this share of the page's visible text (or more) hides its main content. */
export const NOSNIPPET_SHARE = 0.5

export function isEligibilityCode(value: unknown): value is EligibilityCode {
  return typeof value === 'string' && (ELIGIBILITY_CODES as readonly string[]).includes(value)
}
