import { META_FLAG_LENGTH, TITLE_FLAG_LENGTH } from '@shared/domain'
import type { PageReadFlag } from '@shared/domain'

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'including',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'set',
  'that',
  'the',
  'this',
  'to',
  'up',
  'with',
  'your'
])

/** FR-2.4. Title and meta flags use the shared cutoffs. `preview` is only set for a long title. */
export function pageReadFlags(input: {
  title: string | null
  metaDescription: string | null
  h1: string | null
}): PageReadFlag[] {
  const title = input.title ?? ''
  const meta = input.metaDescription ?? ''
  const h1 = input.h1 ?? ''
  const flags: PageReadFlag[] = []
  if (title.length > TITLE_FLAG_LENGTH) {
    flags.push({
      code: 'title_long',
      message: `The title is longer than ${TITLE_FLAG_LENGTH} characters.`,
      preview: cutTitle(title)
    })
  }
  if (meta.length > META_FLAG_LENGTH) {
    flags.push({
      code: 'meta_long',
      message: `The meta description is longer than ${META_FLAG_LENGTH} characters.`,
      preview: null
    })
  }
  if (title.length > 0 && h1.length > 0 && fold(title) !== fold(h1)) {
    flags.push({
      code: 'title_differs_from_h1',
      message: 'The title and the H1 are different.',
      preview: null
    })
  }
  if (promiseDiffers(title, h1, meta)) {
    flags.push({
      code: 'promise_mismatch',
      message: 'The title and H1 promise something different from the meta description.',
      preview: null
    })
  }
  return flags
}

export function titleMatchesH1(title: string | null, h1: string | null): boolean | null {
  if (title === null || h1 === null || title.length === 0 || h1.length === 0) return null
  return fold(title) === fold(h1)
}

function cutTitle(title: string): string {
  const slice = title.slice(0, TITLE_FLAG_LENGTH)
  const space = slice.lastIndexOf(' ')
  const cut = space >= 40 ? slice.slice(0, space) : slice
  return `${cut.trimEnd()}...`
}

function promiseDiffers(title: string, h1: string, meta: string): boolean {
  const metaWords = significant(meta)
  if (metaWords.size < 3) return false
  const lead = new Set([...significant(title), ...significant(h1)])
  let overlap = 0
  for (const word of metaWords) {
    if (lead.has(word)) overlap += 1
  }
  return overlap * 2 < metaWords.size
}

function significant(text: string): Set<string> {
  const words = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue
    words.add(raw)
  }
  return words
}

function fold(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
