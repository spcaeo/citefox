import type { MetricRow } from '../../metrics/types'
import type { ChangedInput } from './changed'
import type { ClaimItem, SentimentView, ToneSplit } from './changed-types'
import type { BrandClaim } from './extras'
import { endRows } from './named'
import type { QuestionItem } from './types'

/**
 * How AI talks about you (Docs/REPORT-SPEC.md §5 Reputation, the movement card in What
 * changed): the tone of the claims AI Overviews make about your brand at both ends,
 * over the compared questions, and the negative claims that appeared or went away.
 * Below {@link MIN_CLAIMS} claims at an end, its net sentiment is "Not enough data".
 */

export const MIN_CLAIMS = 5

/** A row's claims: its own, or under All engines its Google AI Overview part's. */
export function claimsOf(
  claims: Readonly<Record<string, readonly BrandClaim[]>>,
  row: MetricRow | null
): readonly BrandClaim[] {
  if (row === null) return []
  const own = claims[row.id]
  if (own !== undefined) return own
  for (const id of row.parts ?? []) {
    const part = claims[id]
    if (part !== undefined) return part
  }
  return []
}

/** Positive / neutral / negative counts and net sentiment of a list of claims. */
export function toneSplit(list: readonly BrandClaim[]): ToneSplit {
  const count = (polarity: BrandClaim['polarity']): number =>
    list.filter((claim) => claim.polarity === polarity).length
  const positive = count('positive')
  const negative = count('negative')
  const total = list.length
  return {
    positive,
    neutral: count('neutral'),
    negative,
    total,
    net: total < MIN_CLAIMS ? null : Math.round(((positive - negative) / total) * 100)
  }
}

const norm = (sentence: string): string => sentence.replace(/\s+/g, ' ').trim().toLowerCase()

export function sentimentView(
  input: ChangedInput,
  byId: ReadonlyMap<string, QuestionItem>
): SentimentView | null {
  const { metrics, book, extras } = input
  const claims = extras.claims ?? {}
  if (metrics.comparison === null || Object.keys(claims).length === 0) return null
  const before: BrandClaim[] = []
  const now: BrandClaim[] = []
  const fresh: ClaimItem[] = []
  const gone: ClaimItem[] = []
  for (const { to, from } of endRows(metrics)) {
    const a = claimsOf(claims, to)
    const b = claimsOf(claims, from)
    before.push(...b)
    now.push(...a)
    const question = byId.get(to.id)
    if (question === undefined) continue
    const negA = a.filter((claim) => claim.polarity === 'negative')
    const negB = b.filter((claim) => claim.polarity === 'negative')
    const seenB = new Set(negB.map((claim) => norm(claim.sentence)))
    const seenA = new Set(negA.map((claim) => norm(claim.sentence)))
    for (const claim of negA) {
      if (!seenB.has(norm(claim.sentence)))
        fresh.push({ question, sentence: claim.sentence, theme: claim.theme })
    }
    for (const claim of negB) {
      if (!seenA.has(norm(claim.sentence)))
        gone.push({ question, sentence: claim.sentence, theme: claim.theme })
    }
  }
  if (before.length === 0 && now.length === 0) return null
  const ids = (list: readonly ClaimItem[]): string[] => [
    ...new Set(list.map((item) => item.question.id))
  ]
  return {
    before: toneSplit(before),
    now: toneSplit(now),
    newlyNegative: book.add('tone:negative:new', {
      title: 'A new negative claim about you',
      kind: 'questions',
      ids: ids(fresh),
      sub: 'The AI Overview now says something negative about your brand that it did not say before.'
    }),
    newlyNegativeClaims: fresh,
    goneNegative: book.add('tone:negative:gone', {
      title: 'A negative claim about you is gone',
      kind: 'questions',
      ids: ids(gone),
      sub: 'The AI Overview no longer makes a negative claim it made before.'
    }),
    goneNegativeClaims: gone
  }
}
