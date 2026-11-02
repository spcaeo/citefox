/**
 * Keyword word groups: keywords that share a two-word phrase ("nagios sms") sit
 * together. Worked out here, with no AI call, and the same every time for the same
 * keywords:
 *
 * 1. Each keyword gives its phrases: neighbouring pairs of content words, with any
 *    little words between them kept for the label ("email to sms").
 * 2. The phrase shared by the most keywords still without a group becomes a group
 *    (ties: the shorter label, then A to Z). Repeat while a phrase is shared by two.
 * 3. When every keyword of a group also shares the next word ("nagios text alert"),
 *    the label grows to three words.
 * 4. The rest go to "Other keywords".
 */

export const OTHER_KEYWORDS = 'Other keywords'

/** Most groups a topic shows before the rest fold into Other keywords. */
export const MAX_WORD_GROUPS = 12

const LITTLE_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'can',
  'do',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'the',
  'to',
  'vs',
  'what',
  'with',
  'your'
])

export interface WordGroup {
  /** The shared phrase, or {@link OTHER_KEYWORDS}. */
  label: string
  /** Keyword ids, in the order they came in. */
  ids: readonly string[]
}

interface Phrase {
  /** Content words joined by a space: the matching key. */
  key: string
  /** The words as written, little words included. */
  label: string
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.'-]+/gu, ' ')
    .split(' ')
    .map((word) => word.replace(/^[.'-]+|[.'-]+$/g, ''))
    .filter((word) => word !== '')
}

/** Neighbouring content-word runs of `size` words, with the little words between them. */
function phrasesOf(text: string, size: 2 | 3): Phrase[] {
  const all = words(text)
  const content: number[] = []
  all.forEach((word, index) => {
    if (!LITTLE_WORDS.has(word)) content.push(index)
  })
  const out: Phrase[] = []
  for (let at = 0; at + size <= content.length; at += 1) {
    const picked = content.slice(at, at + size)
    const first = picked[0] ?? 0
    const last = picked[picked.length - 1] ?? 0
    out.push({
      key: picked.map((index) => all[index]).join(' '),
      label: all.slice(first, last + 1).join(' ')
    })
  }
  return out
}

function firstBy<T>(items: readonly T[], better: (a: T, b: T) => boolean): T | undefined {
  let best: T | undefined
  for (const item of items) if (best === undefined || better(item, best)) best = item
  return best
}

/** Groups keywords by their most shared phrase. Ids keep their input order in each group. */
export function wordGroups(keywords: readonly { id: string; text: string }[]): WordGroup[] {
  const pairs = new Map(keywords.map((keyword) => [keyword.id, phrasesOf(keyword.text, 2)]))
  const triples = new Map(keywords.map((keyword) => [keyword.id, phrasesOf(keyword.text, 3)]))
  const left = new Set(keywords.map((keyword) => keyword.id))
  const groups: WordGroup[] = []

  while (groups.length < MAX_WORD_GROUPS) {
    // Phrase key → the ungrouped keywords that have it, and its label as first written.
    const shared = new Map<string, { label: string; ids: string[] }>()
    for (const keyword of keywords) {
      if (!left.has(keyword.id)) continue
      const own = new Set<string>()
      for (const phrase of pairs.get(keyword.id) ?? []) {
        if (own.has(phrase.key)) continue
        own.add(phrase.key)
        const entry = shared.get(phrase.key) ?? { label: phrase.label, ids: [] }
        entry.ids.push(keyword.id)
        shared.set(phrase.key, entry)
      }
    }
    const best = firstBy(
      [...shared.entries()].filter(([, entry]) => entry.ids.length >= 2),
      ([keyA, a], [keyB, b]) =>
        a.ids.length !== b.ids.length
          ? a.ids.length > b.ids.length
          : a.label.length !== b.label.length
            ? a.label.length < b.label.length
            : keyA < keyB
    )
    if (best === undefined) break
    const [key, entry] = best
    groups.push({ label: grown(key, entry.label, entry.ids, triples), ids: entry.ids })
    for (const id of entry.ids) left.delete(id)
  }

  const rest = keywords.filter((keyword) => left.has(keyword.id)).map((keyword) => keyword.id)
  if (rest.length > 0) groups.push({ label: OTHER_KEYWORDS, ids: rest })
  return groups
}

/** The three-word label every member shares and that starts or ends with the pair, if any. */
function grown(
  key: string,
  label: string,
  ids: readonly string[],
  triples: ReadonlyMap<string, Phrase[]>
): string {
  const [firstId, ...others] = ids
  const candidates = (triples.get(firstId ?? '') ?? []).filter(
    (triple) => triple.key.startsWith(`${key} `) || triple.key.endsWith(` ${key}`)
  )
  const common = candidates.find((triple) =>
    others.every((id) => (triples.get(id) ?? []).some((other) => other.key === triple.key))
  )
  return common?.label ?? label
}

/** Keyword id → its group's label, for filters and drills. */
export function wordGroupIndex(groups: readonly WordGroup[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const group of groups) for (const id of group.ids) index.set(id, group.label)
  return index
}
