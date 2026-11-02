import { MOVEMENT_WORDS, STATUS_WORDS } from '../vocabulary'
import type { HelpSection } from './parse'

/**
 * Local ranking of help sections against a question: BM25 over plain word
 * stems, with the section heading, the topic title and the topic keywords
 * counted twice. No service, no embeddings: it runs in a few milliseconds
 * over the shipped files. A few CiteFox words are folded together (rival →
 * competitor, prompt → question, AIO → overview), and the status and
 * movement labels people see on screen ("Not cited", "Lost since last
 * check") are folded to the words the help uses.
 */

export interface RankedSection {
  section: HelpSection
  score: number
}

const K1 = 1.2
const B = 0.75

/** Words that say nothing about which section answers. */
const STOP = new Set(
  (
    'a an and are as at be been but by can could do does did for from had has have how i if in into ' +
    'is it its me my of on or our should so that the their them then there these they this to us ' +
    'was we were what when where which who why will with would you your yours about any all also ' +
    "get got im i'm it's dont don't isn't aren't doesn't citefox please tell show mean means"
  ).split(' ')
)

/** Words folded to the one the help uses. */
const SAME: Readonly<Record<string, string>> = {
  rival: 'competitor',
  rivals: 'competitor',
  competition: 'competitor',
  prompt: 'question',
  prompts: 'question',
  query: 'question',
  queries: 'question',
  keyword: 'question',
  keywords: 'question',
  aio: 'overview',
  aios: 'overview',
  citation: 'cite',
  citations: 'cite',
  cited: 'cite',
  citing: 'cite',
  cites: 'cite',
  url: 'page',
  urls: 'page',
  dashboard: 'summary',
  home: 'summary',
  scan: 'check',
  rerun: 'check',
  recheck: 'check',
  run: 'check',
  runs: 'check',
  searches: 'credit',
  search: 'credit',
  credits: 'credit',
  logo: 'brand',
  branding: 'brand',
  pdf: 'download',
  export: 'download'
}

/** Light stemming: enough that "changes", "changed" and "changing" meet. */
function stem(word: string): string {
  const same = SAME[word]
  if (same !== undefined) return same
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('es') && /(ch|sh|x|ss)es$/.test(word))
    return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function tokens(text: string): string[] {
  const out: string[] = []
  for (const raw of text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^a-z0-9']+/)) {
    const word = raw.replace(/^'+|'+$/g, '')
    if (word.length < 2 || STOP.has(word)) continue
    out.push(stem(word))
  }
  return out
}

/** Status and movement labels as shown on screen, each read as one help word set. */
const SCREEN_LABELS: readonly string[] = [
  ...Object.values(STATUS_WORDS).map((word) => word.label),
  ...Object.values(MOVEMENT_WORDS).map((word) => word.label)
]

/** The question's words, plus a status or movement label it names, once. */
function queryTokens(question: string): string[] {
  const lower = question.toLowerCase()
  const extra = SCREEN_LABELS.filter((label) => lower.includes(label.toLowerCase()))
  return [...new Set([...tokens(question), ...extra.flatMap(tokens)])]
}

function sectionTokens(section: HelpSection): string[] {
  const weighted = [section.heading, section.topicTitle, section.keywords.join(' ')].join(' ')
  const twice = tokens(weighted)
  return [...twice, ...twice, ...tokens(section.text)]
}

export interface RankOptions {
  /** The help topic of the screen the question was asked on; its sections score a little higher. */
  preferTopic?: string | null
  limit?: number
}

/** Sections that share words with the question, best first. Empty when nothing matches. */
export function rankSections(
  question: string,
  sections: readonly HelpSection[],
  options: RankOptions = {}
): RankedSection[] {
  const query = queryTokens(question)
  if (query.length === 0 || sections.length === 0) return []
  const docs = sections.map((section) => {
    const words = sectionTokens(section)
    const counts = new Map<string, number>()
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
    return { section, length: words.length, counts }
  })
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1
  const idf = new Map<string, number>()
  for (const word of query) {
    const holding = docs.filter((doc) => doc.counts.has(word)).length
    idf.set(word, Math.log(1 + (docs.length - holding + 0.5) / (holding + 0.5)))
  }
  const ranked: RankedSection[] = []
  for (const doc of docs) {
    let score = 0
    for (const word of query) {
      const tf = doc.counts.get(word) ?? 0
      if (tf === 0) continue
      const norm = tf + K1 * (1 - B + (B * doc.length) / average)
      score += (idf.get(word) ?? 0) * ((tf * (K1 + 1)) / norm)
    }
    if (score <= 0) continue
    // A section whose own heading asks the question ("Why is What changed empty?") leads.
    if (doc.section.heading !== doc.section.topicTitle) {
      const heading = new Set(tokens(doc.section.heading))
      score *= 1 + (0.5 * query.filter((word) => heading.has(word)).length) / query.length
    }
    if (options.preferTopic && doc.section.topicId === options.preferTopic) score *= 1.2
    ranked.push({ section: doc.section, score })
  }
  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      left.section.topicId.localeCompare(right.section.topicId) ||
      left.section.heading.localeCompare(right.section.heading)
  )
  return ranked.slice(0, options.limit ?? ranked.length)
}
