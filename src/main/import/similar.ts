import { normaliseQuestion, questionMergeKey } from '@shared/question-text'
import { contentTokens, duplicateKey } from '../topics/text'

/**
 * Near-duplicate search for imports: the same question with case, punctuation and
 * spaces ignored is exact; the same question with years, articles ("a", "an", "the",
 * "any") and simple plurals also ignored is merged (`questionMergeKey`); the same content words in another order or number
 * (`duplicateKey`), or a Jaccard overlap of content words of at least
 * {@link SIMILAR_AT} with three words or more on both sides, is similar. An inverted
 * index keeps a 5,000-row file against thousands of tracked questions quick. Pure.
 */

export const SIMILAR_AT = 0.75
/** Fewer content words than this are only ever exact or same-words matches. */
const MIN_TOKENS = 3

export interface Indexed<T> {
  item: T
  exact: string
  /** {@link questionMergeKey}: the same question in a slightly different wording. */
  merge: string
  sameWords: string
  tokens: string[]
}

export function indexed<T>(item: T, text: string): Indexed<T> {
  const tokens = [...new Set(contentTokens(text))]
  return {
    item,
    exact: normaliseQuestion(text),
    merge: questionMergeKey(text),
    sameWords: duplicateKey(text),
    tokens
  }
}

export class SimilarIndex<T> {
  private readonly entries: Indexed<T>[] = []
  private readonly byExact = new Map<string, number>()
  private readonly byMerge = new Map<string, number>()
  private readonly bySameWords = new Map<string, number>()
  private readonly byToken = new Map<string, number[]>()

  add(entry: Indexed<T>): void {
    const at = this.entries.length
    this.entries.push(entry)
    if (entry.exact.length > 0 && !this.byExact.has(entry.exact)) this.byExact.set(entry.exact, at)
    if (entry.merge.length > 0 && !this.byMerge.has(entry.merge)) this.byMerge.set(entry.merge, at)
    if (entry.sameWords.length > 0 && !this.bySameWords.has(entry.sameWords)) {
      this.bySameWords.set(entry.sameWords, at)
    }
    for (const token of entry.tokens) {
      const list = this.byToken.get(token)
      if (list === undefined) this.byToken.set(token, [at])
      else list.push(at)
    }
  }

  exact(probe: Indexed<unknown>): T | null {
    const at = this.byExact.get(probe.exact)
    return at === undefined ? null : (this.entries[at]?.item ?? null)
  }

  /** An entry that is the same question once years, articles and plurals are ignored. */
  merged(probe: Indexed<unknown>): T | null {
    if (probe.merge.length === 0) return null
    const at = this.byMerge.get(probe.merge)
    return at === undefined ? null : (this.entries[at]?.item ?? null)
  }

  /** The closest entry that is the same words or overlaps enough, with its score (1 for same words). */
  similar(probe: Indexed<unknown>): { item: T; score: number } | null {
    if (probe.sameWords.length > 0) {
      const at = this.bySameWords.get(probe.sameWords)
      const entry = at === undefined ? undefined : this.entries[at]
      if (entry !== undefined) return { item: entry.item, score: 1 }
    }
    if (probe.tokens.length < MIN_TOKENS) return null
    const shared = new Map<number, number>()
    for (const token of probe.tokens) {
      for (const at of this.byToken.get(token) ?? []) shared.set(at, (shared.get(at) ?? 0) + 1)
    }
    let best: { item: T; score: number } | null = null
    for (const [at, count] of shared) {
      const entry = this.entries[at]
      if (entry === undefined || entry.tokens.length < MIN_TOKENS) continue
      const score = count / (probe.tokens.length + entry.tokens.length - count)
      if (score >= SIMILAR_AT && (best === null || score > best.score)) {
        best = { item: entry.item, score }
      }
    }
    return best
  }
}
