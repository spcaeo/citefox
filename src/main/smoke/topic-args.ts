/** Topic-mode settings for `npm run smoke:live -- --topic` (Docs/TOPICS-SPEC.md). */

export const DEFAULT_TOPIC_SEED = 'Text alerts for teams without a developer'
/** Questions checked when `--prompts` is not given. */
export const TOPIC_DEFAULT_PROMPTS = 3
/** Hard cap on checked questions: each is a search plus at most one follow-up. */
export const TOPIC_MAX_PROMPTS = 5
/** SerpApi searches one topic run may send. A search past this is refused. */
export const TOPIC_SEARCH_BUDGET = 10
/** The run stops before any search when the account reports fewer searches left. */
export const TOPIC_MIN_SEARCHES_LEFT = 20
/** Keyword cap for the Quick keyword set. */
export const TOPIC_KEYWORD_CAP = 10

/** The project the topic smoke builds. Fixed so runs compare. */
export const TOPIC_SMOKE_PROJECT = {
  id: 'proj-topic-smoke',
  name: 'TextBolt',
  slug: 'textbolt',
  website: 'textbolt.com',
  brandNames: ['TextBolt', 'Text Bolt'],
  competitors: ['simpletexting.com', 'twilio.com'],
  marketId: 'mkt-topic-smoke'
} as const

/** What the topic smoke prints and saves. No dates, keys or page tokens. */
export interface TopicSmokeSummary {
  seed: string
  searchesLeftBefore: number | null
  pagesRead: number
  pagesReadOk: number
  jinaReads: number
  profilePoints: number
  questionsByStage: Record<string, number>
  questions: number
  sampleQuestions: string[]
  keywords: number
  keywordsByGroup: Record<string, number>
  pageMatch: Record<string, number>
  estimate: { prompts: number; searchesLo: number; searchesHi: number } | null
  checkedQuestions: string[]
  jobStatus: string | null
  rowStates: Record<string, number>
  goal: { cited: number; withAio: number; checked: number; rate: number | null } | null
  winOdds: string[]
  summaryLine: string | null
  whyNotCited: { number: number; summary: string; reasons: number } | null
  whyNotCitedSkipped: string | null
  llmCalls: number
  searches: number
}

export function blankTopicSummary(seed: string): TopicSmokeSummary {
  return {
    seed,
    searchesLeftBefore: null,
    pagesRead: 0,
    pagesReadOk: 0,
    jinaReads: 0,
    profilePoints: 0,
    questionsByStage: {},
    questions: 0,
    sampleQuestions: [],
    keywords: 0,
    keywordsByGroup: {},
    pageMatch: {},
    estimate: null,
    checkedQuestions: [],
    jobStatus: null,
    rowStates: {},
    goal: null,
    winOdds: [],
    summaryLine: null,
    whyNotCited: null,
    whyNotCitedSkipped: null,
    llmCalls: 0,
    searches: 0
  }
}

/**
 * True when `text` names a brand: a case-insensitive match that also ignores
 * spaces and punctuation, so "Text Bolt" and "text-bolt" match "TextBolt".
 */
export function namesBrand(text: string, brands: readonly string[]): boolean {
  const flat = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/gu, '')
  const haystack = flat(text)
  return brands.some((brand) => {
    const needle = flat(brand)
    return needle.length > 0 && haystack.includes(needle)
  })
}

/** Counts values into a plain record, keys in first-seen order. */
export function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    const name = key(item)
    out[name] = (out[name] ?? 0) + 1
  }
  return out
}

/** `a=1 b=2`, or `none`. */
export function formatCounts(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts).map(([name, count]) => `${name}=${count}`)
  return parts.length === 0 ? 'none' : parts.join(' ')
}

/**
 * Picks `count` questions round-robin over the journey stages, in stage order,
 * so a small check still covers several stages.
 */
export function pickAcrossStages<T extends { stage: string | null }>(
  questions: readonly T[],
  stageOrder: readonly string[],
  count: number
): T[] {
  const queues = stageOrder.map((stage) => questions.filter((item) => item.stage === stage))
  queues.push(questions.filter((item) => item.stage === null || !stageOrder.includes(item.stage)))
  const picked: T[] = []
  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift()
      if (next !== undefined && picked.length < count) picked.push(next)
    }
  }
  return picked
}
