/**
 * Brand sentiment numbers (FR-16.3, FR-16.4, FR-16.7, REPORT-SPEC section 5).
 * Pure functions over a check's overviews and claims. The Sentiment tab and
 * the export's reputation block both use these, so every output agrees.
 * Each aggregate keeps the ids behind it, so a drill lists exactly that number (NFR-14).
 */

import {
  SENTIMENT_CELL_MIN_CLAIMS,
  SENTIMENT_MIN_CLAIMS,
  type ClaimSourceKind,
  type ClaimTone,
  type SentimentClaim,
  type SentimentOverview
} from './domain/sentiment'

export interface ToneCounts {
  positive: number
  neutral: number
  negative: number
  total: number
}

/** A count with the claim ids behind it. `ids.length` is the count. */
export interface ClaimBucket {
  count: number
  claimIds: readonly string[]
}

/** FR-16.3. `(positive − negative) ÷ all × 100`, rounded. Null below `minimum` claims. */
export function netSentiment(counts: ToneCounts, minimum = SENTIMENT_MIN_CLAIMS): number | null {
  if (counts.total < minimum || counts.total === 0) return null
  return Math.round(((counts.positive - counts.negative) / counts.total) * 100)
}

export function toneCounts(claims: readonly Pick<SentimentClaim, 'tone'>[]): ToneCounts {
  const counts = { positive: 0, neutral: 0, negative: 0, total: 0 }
  for (const claim of claims) {
    counts[claim.tone] += 1
    counts.total += 1
  }
  return counts
}

/** Claims about the own brand only. */
export function ownClaims(claims: readonly SentimentClaim[]): SentimentClaim[] {
  return claims.filter((claim) => claim.isOwn)
}

/** The tone split with the ids behind each part. Parts add up to the total. */
export function toneBuckets(claims: readonly SentimentClaim[]): Record<ClaimTone, ClaimBucket> {
  const pick = (tone: ClaimTone): ClaimBucket => {
    const ids = claims.filter((claim) => claim.tone === tone).map((claim) => claim.id)
    return { count: ids.length, claimIds: ids }
  }
  return { positive: pick('positive'), neutral: pick('neutral'), negative: pick('negative') }
}

/** Every brand an overview names: its ranked list plus any brand a claim is about. */
export function brandsIn(overview: SentimentOverview, claims: readonly SentimentClaim[]): string[] {
  const names = [...overview.brandsNamed]
  for (const claim of claims) {
    if (claim.overviewId === overview.id && !names.includes(claim.brand)) names.push(claim.brand)
  }
  return names
}

/** Read overviews that name the own brand (FR-16.4). */
export function overviewsNamingBrand(
  overviews: readonly SentimentOverview[],
  claims: readonly SentimentClaim[],
  brand: string | null
): SentimentOverview[] {
  if (brand === null) return []
  return overviews.filter(
    (overview) => overview.readState === 'read' && brandsIn(overview, claims).includes(brand)
  )
}

/** One brand's share of mentions. A mention is one read overview that names the brand. */
export interface MentionShare {
  brand: string
  isOwn: boolean
  mentions: number
  /** 0 to 100, rounded. Null when no brand is mentioned at all. */
  share: number | null
  overviewIds: readonly string[]
}

/**
 * FR-16.4. The own brand first, then each competitor in the order listed.
 * The unit is overviews: one overview naming two brands counts once for each.
 */
export function mentionShares(
  overviews: readonly SentimentOverview[],
  claims: readonly SentimentClaim[],
  brand: string | null,
  competitors: readonly string[]
): MentionShare[] {
  const keys = [...(brand === null ? [] : [brand]), ...competitors]
  const read = overviews.filter((overview) => overview.readState === 'read')
  const rows = keys.map((key) => {
    const ids = read
      .filter((overview) => brandsIn(overview, claims).includes(key))
      .map((overview) => overview.id)
    return { brand: key, isOwn: key === brand, mentions: ids.length, overviewIds: ids }
  })
  const all = rows.reduce((sum, row) => sum + row.mentions, 0)
  return rows.map((row) => ({
    ...row,
    share: all === 0 ? null : Math.round((row.mentions / all) * 100)
  }))
}

/** One overview that names the brand, for "Answer by answer" (FR-16.7). */
export interface AnswerRow {
  overviewId: string
  source: SentimentOverview['source']
  marketId: string
  promptLabel: string
  promptText: string
  tone: ClaimTone
  /** The most frequent theme of the own-brand claims. Null when it has none. */
  theme: string | null
  /** The own brand's place among the brands named. Null when not in the ranked list. */
  rank: number | null
  brandsNamed: number
  reason: string | null
  claimIds: readonly string[]
}

/** A mixed or claim-less answer is neutral; otherwise the larger side wins. */
export function answerTone(counts: ToneCounts): ClaimTone {
  if (counts.positive > counts.negative) return 'positive'
  if (counts.negative > counts.positive) return 'negative'
  return 'neutral'
}

export function answerRows(
  overviews: readonly SentimentOverview[],
  claims: readonly SentimentClaim[],
  brand: string | null
): AnswerRow[] {
  return overviewsNamingBrand(overviews, claims, brand).map((overview) => {
    const own = claims.filter((claim) => claim.overviewId === overview.id && claim.isOwn)
    const named = brandsIn(overview, claims)
    const index = brand === null ? -1 : overview.brandsNamed.indexOf(brand)
    return {
      overviewId: overview.id,
      source: overview.source,
      marketId: overview.marketId,
      promptLabel: overview.promptLabel,
      promptText: overview.promptText,
      tone: answerTone(toneCounts(own)),
      theme: topTheme(own),
      rank: index === -1 ? null : index + 1,
      brandsNamed: named.length,
      reason: overview.reason,
      claimIds: own.map((claim) => claim.id)
    }
  })
}

/** "#1 of 3 brands named", or "Named" when the overview gave no ranked list. */
export function rankLabel(row: Pick<AnswerRow, 'rank' | 'brandsNamed'>): string {
  if (row.rank === null) return 'Named'
  const noun = row.brandsNamed === 1 ? 'brand' : 'brands'
  return `#${row.rank} of ${row.brandsNamed} ${noun} named`
}

/** One theme of the own-brand claims (FR-16.7). */
export interface ThemeRow {
  theme: string
  counts: ToneCounts
  /** Null below {@link SENTIMENT_CELL_MIN_CLAIMS} claims. */
  net: number | null
  attributes: readonly string[]
  claimIds: readonly string[]
}

/** Most claims first, then by name. */
export function themeRows(claims: readonly SentimentClaim[]): ThemeRow[] {
  const groups = groupBy(claims, (claim) => claim.theme)
  return [...groups.entries()]
    .map(([theme, items]) => {
      const counts = toneCounts(items)
      return {
        theme,
        counts,
        net: netSentiment(counts, SENTIMENT_CELL_MIN_CLAIMS),
        attributes: unique(items.map((claim) => claim.attribute)),
        claimIds: items.map((claim) => claim.id)
      }
    })
    .sort(
      (left, right) => right.counts.total - left.counts.total || compare(left.theme, right.theme)
    )
}

/** A source cited next to negative own-brand claims (FR-16.7). */
export interface NegativeSourceRow {
  /** Null groups the negative claims with no cited source. */
  url: string | null
  sourceKind: ClaimSourceKind | null
  claimIds: readonly string[]
  themes: readonly string[]
  /** Plain advice for this kind of source. CiteFox never posts for the user (FR-16.9). */
  advice: string
}

export function negativeSources(claims: readonly SentimentClaim[]): NegativeSourceRow[] {
  const negative = claims.filter((claim) => claim.isOwn && claim.tone === 'negative')
  const groups = groupBy(negative, (claim) => claim.url ?? '')
  return [...groups.entries()]
    .map(([url, items]) => {
      const kind = items[0]?.sourceKind ?? null
      return {
        url: url.length === 0 ? null : url,
        sourceKind: kind,
        claimIds: items.map((claim) => claim.id),
        themes: unique(items.map((claim) => claim.theme)),
        advice: sourceAdvice(kind)
      }
    })
    .sort((left, right) => right.claimIds.length - left.claimIds.length)
}

export function sourceAdvice(kind: ClaimSourceKind | null): string {
  switch (kind) {
    case 'this_page':
      return 'Your own page. Edit the sentence so it says plainly what is true.'
    case 'own':
      return 'Another page on your site. Edit it so it matches your brand facts.'
    case 'competitor':
      return "A competitor's page. Publish a clear, fair comparison on your own site."
    case 'review':
      return 'A review site. Reply to the review with the facts, and ask happy customers for reviews.'
    case 'reddit':
    case 'forum':
      return 'A forum thread. Answer it in your own name with the facts.'
    case 'youtube':
      return 'A video. Ask the creator to correct it, or publish a video that answers it.'
    case 'linkedin':
      return 'A LinkedIn post. Comment with the facts, or publish your own post.'
    case 'web':
    case 'other':
      return 'Ask the site owner to correct it, or publish the fact on your own site.'
    default:
      return 'No source is cited next to this claim. Publish the fact on your own site.'
  }
}

/** One cell of the brand × theme table (FR-16.7). */
export interface MatrixCell {
  brand: string
  count: number
  /** Null below {@link SENTIMENT_CELL_MIN_CLAIMS} claims: the cell stays empty. */
  net: number | null
  claimIds: readonly string[]
}

export interface MatrixRow {
  theme: string
  cells: readonly MatrixCell[]
}

export interface BrandMatrix {
  brands: readonly string[]
  rows: readonly MatrixRow[]
  /** Claims per brand across every theme. */
  totals: readonly MatrixCell[]
}

export function brandMatrix(
  claims: readonly SentimentClaim[],
  brand: string | null,
  competitors: readonly string[]
): BrandMatrix {
  const brands = [...(brand === null ? [] : [brand]), ...competitors]
  const cell = (key: string, items: readonly SentimentClaim[]): MatrixCell => {
    const mine = items.filter((claim) => claim.brand === key)
    return {
      brand: key,
      count: mine.length,
      net: netSentiment(toneCounts(mine), SENTIMENT_CELL_MIN_CLAIMS),
      claimIds: mine.map((claim) => claim.id)
    }
  }
  const known = claims.filter((claim) => brands.includes(claim.brand))
  const rows = [...groupBy(known, (claim) => claim.theme).entries()]
    .map(([theme, items]) => ({
      theme,
      cells: brands.map((key) => cell(key, items)),
      size: items.length
    }))
    .sort((left, right) => right.size - left.size || compare(left.theme, right.theme))
    .map(({ theme, cells }) => ({ theme, cells }))
  return { brands, rows, totals: brands.map((key) => cell(key, known)) }
}

/** FR-16.5. Claims Claude found wrong, own brand first. */
export function factualProblems(claims: readonly SentimentClaim[]): SentimentClaim[] {
  return claims
    .filter((claim) => claim.factProblem !== null)
    .sort((left, right) => Number(right.isOwn) - Number(left.isOwn))
}

/** "+36", "0", "−20" with a real minus sign. */
export function formatNet(net: number | null): string {
  if (net === null) return 'Not enough data'
  if (net > 0) return `+${net}`
  if (net < 0) return `−${Math.abs(net)}`
  return '0'
}

function topTheme(claims: readonly SentimentClaim[]): string | null {
  const rows = themeRows(claims)
  return rows[0]?.theme ?? null
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const name = key(item)
    const list = groups.get(name)
    if (list === undefined) groups.set(name, [item])
    else list.push(item)
  }
  return groups
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function compare(left: string, right: string): number {
  return left.localeCompare(right, 'en')
}
