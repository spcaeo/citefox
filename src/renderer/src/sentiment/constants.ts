import type { BrandPromptKind, ClaimSourceKind, ClaimTone } from '@shared/domain'

/** Brand prompt kinds in the mock-up's words (FR-16.1). */
export const BRAND_KIND_LABEL: Readonly<Record<BrandPromptKind, string>> = {
  review: 'Reviews',
  pricing: 'Pricing',
  alternatives: 'Alternatives',
  comparison: 'Comparison',
  use_case: 'Use case'
}

export const TONE_LABEL: Readonly<Record<ClaimTone, string>> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative'
}

/** Where the nearest source sits, as the "Type" column says it. */
export const SOURCE_KIND_LABEL: Readonly<Record<ClaimSourceKind, string>> = {
  this_page: 'This page',
  own: 'Your site',
  competitor: 'Competitor',
  review: 'Review site',
  reddit: 'Reddit',
  forum: 'Forum',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  web: 'Web page',
  other: 'Other'
}

/** How long a Claude assist usually takes, for the FR-25.1 label. */
export const BRAND_PROMPTS_SECONDS = 10

/** The legend under the brand × theme table, from the mock-up. */
export const NET_LEGEND = [
  { net: 60, label: 'clearly positive' },
  { net: 25, label: 'leans positive' },
  { net: 0, label: 'mixed or neutral' },
  { net: -25, label: 'leans negative' },
  { net: -60, label: 'clearly negative' }
] as const

/** Rows shown before "Show all" in Answer by answer. */
export const ANSWER_PAGE_SIZE = 12
