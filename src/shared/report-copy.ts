/**
 * Report wording shared by every export and the in-app Results screen, so a label and
 * its definition read the same everywhere (Docs/REPORT-SPEC.md "Definitions used throughout").
 * Plain functions only: no Electron, Node or React.
 */

import type { OpportunityBucketId, PromptCheckStatus } from './domain'

/** KPI labels, in the order the report shows them. */
export const REPORT_KPI_LABELS = {
  tracked: 'Questions tracked',
  aio: 'AI Overview appears',
  cited: 'You are cited',
  pageCited: 'This page cited',
  named: 'Brand named',
  notVisible: 'Not visible',
  winning: 'Already winning',
  wrongPage: 'Wrong page cited',
  score: 'Visibility score'
} as const

export type ReportKpi = keyof typeof REPORT_KPI_LABELS

/** One-line definitions, shown under KPI tiles and in legends. */
export const REPORT_DEFINITIONS = {
  tracked: 'Buyer questions in scope, one per market.',
  aio: 'The latest full check found an AI Overview for the question in that market.',
  cited: 'The overview links any page on your domain.',
  pageCited: 'The overview links the tracked page itself.',
  named: 'Your brand, or an alias, appears in the overview text.',
  notVisible:
    'An AI Overview is shown, but it neither cites nor names you. This is the opportunity.',
  winning: 'The overview both cites your domain and names your brand.',
  wrongPage: 'Your domain is cited, but not the tracked page.',
  score:
    'Page cited is 3 points, another own page or a brand mention is 1, not cited is 0, over 3 points per AI Overview.'
} as const satisfies Record<ReportKpi, string>

/**
 * Link-count labels. "Citations (links)" is every link to your domain in the overviews
 * (Docs/REPORT-SPEC.md), the number Results, Markets and Trends show. A count of links to
 * one tracked page alone (All pages) is "Links to this page", so the same word never
 * names two different numbers.
 */
export const LINK_COUNT_LABELS = {
  ownDomain: 'Citations (links)',
  thisPage: 'Links to this page'
} as const

/** The overview links a page on your domain: the tracked page or another own page. */
export function citesOwnDomain(status: PromptCheckStatus): boolean {
  return status === 'page_cited' || status === 'other_own_page'
}

/**
 * "Already winning" (Docs/REPORT-SPEC.md): the overview cites your domain AND names your
 * brand. The one definition for the exported report and the in-app Results screen.
 */
export function isAlreadyWinning(row: { cited: boolean; named: boolean | null }): boolean {
  return row.cited && row.named === true
}

/**
 * The opportunity bucket of one prompt with an AI Overview, the same four the report's
 * opportunity bars use: already winning (cited and named), cited only, named only (named
 * but not linked) and not visible. Null for no AI Overview and errors, which are outside.
 */
export function opportunityBucketOf(row: {
  status: PromptCheckStatus
  named: boolean | null
}): OpportunityBucketId | null {
  if (citesOwnDomain(row.status)) {
    return isAlreadyWinning({ cited: true, named: row.named }) ? 'winning' : 'cited_only'
  }
  if (row.status === 'brand_mentioned') return 'named_not_linked'
  if (row.status === 'not_cited') return 'invisible'
  return null
}

export interface HeadlineCounts {
  /** Prompts measured (errors excluded). */
  measured: number
  aio: number
  cited: number
  named: number
  notVisible: number
  /** Searches that failed after retries. They count as tracked prompts and are named on their own. */
  failed?: number
  /** "buyer prompts" in page scope, "buyer prompts across your pages" in project scope. */
  noun?: string
}

/** Whole percentage, or null when the denominator is 0. */
export function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 100)
}

/**
 * "AI Overview appears" as a share (SRS section 7.2 AIO coverage): prompts with an AI
 * Overview ÷ ALL tracked prompts, failed searches included in the denominator. The app's
 * Results funnel and every export use this, so AU with 8 of 10 and 2 failed is 80%, never
 * "100% of measured". Failed searches are stated on their own ({@link failedSearchesText}).
 */
export function aioSharePct(aio: number, tracked: number): number | null {
  return percent(aio, tracked)
}

/**
 * The scope line under every share of citations (Overview and Competitors):
 * "12 of 150 links across 31 questions with an overview, latest check".
 */
export function shareScopeText(own: number, all: number, questions: number): string {
  const n = (value: number): string => value.toLocaleString('en-US')
  const noun = questions === 1 ? 'question' : 'questions'
  return `${n(own)} of ${n(all)} links across ${n(questions)} ${noun} with an overview, latest check`
}

/**
 * What a report's count is called. One market: buyer prompts, as the page screen says.
 * Several: each prompt counts once per market, so the count is prompt checks.
 */
export function headlineNoun(markets: number, project: boolean): string {
  if (markets > 1) {
    return project
      ? `buyer question checks across your pages and ${markets} markets`
      : `buyer question checks across ${markets} markets`
  }
  return project ? 'buyer questions across your pages' : 'buyer questions'
}

/** The cover's "Prompts tracked": "2 buyer prompts", or "4 buyer prompt checks across 2 markets". */
export function promptsTrackedText(checks: number, markets: number): string {
  const n = checks.toLocaleString('en-US')
  if (markets > 1) return `${n} buyer question checks across ${markets} markets`
  return `${n} ${checks === 1 ? 'buyer question' : 'buyer questions'}`
}

/** "1 search failed", "2 searches failed". */
export function failedSearchesText(failed: number): string {
  return `${failed} ${failed === 1 ? 'search' : 'searches'} failed`
}

/**
 * The overview's one-paragraph headline, in plain words:
 * "Google shows an AI Overview for 9 of your 10 buyer prompts. You are cited in 2 of them
 * (22%) and named in the text of 3. In 6 the answer appears without you at all — that is
 * the opportunity this report is about."
 */
export function reportHeadline(counts: HeadlineCounts): string {
  return reportHeadlineParts(counts)
    .map((piece) => (typeof piece === 'string' ? piece : String(piece.n)))
    .join('')
}

/** A number in the headline, by what it counts, so a screen can make it clickable. */
export interface HeadlineFigure {
  key: 'tracked' | 'measured' | 'aio' | 'cited' | 'named' | 'notVisible'
  n: number
}

export type HeadlinePiece = string | HeadlineFigure

/** How the headline names the answer. Default: Google's AI Overview. */
export interface HeadlineWords {
  /** "Google shows an AI Overview", "ChatGPT shows an AI answer". */
  shows: string
  /** "Google shows no AI Overview", "ChatGPT shows no AI answer". */
  showsNone: string
  /** "whether Google shows an AI Overview", for the nothing-measured line. */
  whether: string
}

const GOOGLE_WORDS: HeadlineWords = {
  shows: 'Google shows an AI Overview',
  showsNone: 'Google shows no AI Overview',
  whether: 'whether Google shows an AI Overview'
}

/**
 * {@link reportHeadline} as text and numbers in reading order, so the ready reports
 * (src/shared/report/review) can make each number open its questions. `words` names the
 * engine; the default is the Full report's Google wording.
 */
export function reportHeadlineParts(
  counts: HeadlineCounts,
  words: HeadlineWords = GOOGLE_WORDS
): HeadlinePiece[] {
  const noun = counts.noun ?? 'buyer questions'
  const fig = (key: HeadlineFigure['key'], n: number): HeadlineFigure => ({ key, n })
  if (counts.measured === 0) {
    return [
      `No ${noun} have been measured yet. Run a check to see ${words.whether} and whether it cites you.`
    ]
  }
  if (counts.aio === 0) {
    return [
      `${words.showsNone} for any of your `,
      fig('measured', counts.measured),
      ` ${noun} yet, so there is nothing to be cited in.`
    ]
  }
  const share = percent(counts.cited, counts.aio) ?? 0
  const failed = counts.failed ?? 0
  const tracked = counts.measured + failed
  const failedNote = failed > 0 ? ` (${failedSearchesText(failed)})` : ''
  const first: HeadlinePiece[] = [
    `${words.shows} for `,
    fig('aio', counts.aio),
    ' of your ',
    fig('tracked', tracked),
    ` ${noun}${failedNote}. `
  ]
  const second: HeadlinePiece[] =
    counts.cited === 0
      ? [
          'You are not cited in any of them, and named in the text of ',
          fig('named', counts.named),
          '. '
        ]
      : [
          'You are cited in ',
          fig('cited', counts.cited),
          ` of them (${share}%) and named in the text of `,
          fig('named', counts.named),
          '. '
        ]
  const third: HeadlinePiece[] =
    counts.notVisible === 0
      ? ['Every answer cites or names you somewhere.']
      : [
          'In ',
          fig('notVisible', counts.notVisible),
          ' the answer appears without you at all — that is the opportunity this report is about.'
        ]
  return [...first, ...second, ...third]
}

/**
 * Report section titles and one-line descriptions, in report order. The Export screen,
 * the HTML nav, the PDF headings and the XLSX sheet names use these.
 * Keys are `ReportSectionId` plus `raw` (JSON only).
 */
export const REPORT_SECTION_COPY = {
  overview: {
    title: 'Overview',
    description: 'Headline, KPI tiles, where visibility falls away, and the opportunity.'
  },
  topic_coverage: {
    title: 'Topic coverage',
    description:
      'Goal per kind against its band, coverage by journey stage, the to-do by match state, the keyword universe, and the next three actions. Topic scope only.'
  },
  pages: {
    title: 'Your pages',
    description:
      'Which of your pages are cited, never cited, or cited in place of the tracked page.'
  },
  competition: {
    title: 'Competition',
    description: 'Share of voice, most-cited domains and the citation leaderboard.'
  },
  reputation: {
    title: 'Reputation',
    description: 'Brand sentiment in answers that name you, and factual problems worth correcting.'
  },
  trends: {
    title: 'Trends',
    description:
      'AI Overview results over time, what changed since the previous check, and fix verdicts.'
  },
  universe: {
    title: 'Universe',
    description:
      'The shape of the question set by intent stage, funnel stage, source, page and market.'
  },
  sources: {
    title: 'Sources',
    description:
      'Who Google leans on: your pages, competitors, YouTube, Reddit, LinkedIn and the web.'
  },
  answer_shape: {
    title: 'Answer shape',
    description: 'What the overviews are made of, and the answer journeys that repeat.'
  },
  content_gaps: {
    title: 'Content gaps',
    description:
      'Page read, coverage matrix, one-by-one fixes with FAQ drafts, and page-wide fixes. Page scope only.'
  },
  prompts: {
    title: 'Questions',
    description: 'Every question with its AI Overview result, citations and position.'
  },
  raw: {
    title: 'Raw search data',
    description: 'The stored search responses, as saved. JSON only.'
  }
} as const satisfies Record<string, { title: string; description: string }>

/**
 * Topic coverage section copy (Docs/TOPICS-SPEC.md section 5). HTML, PDF, XLSX and CSV
 * use these, so the wording is the same in every output.
 */
export const TOPIC_COVERAGE_COPY = {
  empty: {
    title: 'Topic scope only',
    message: 'Topic coverage scores a topic: its buyer questions and keywords, each with a goal.',
    nextStep: 'Export a topic to see its goal, stages, to-do and keyword universe.'
  },
  notChecked: {
    title: 'Not measured yet',
    message: 'No check of this topic has finished in this market.',
    nextStep: 'Run a check of the topic to fill this section.'
  },
  executive: 'Executive summary',
  kpiRate: 'Cited rate',
  kpiAio: 'AI Overview shown',
  kpiReach: 'To reach the band',
  executiveBuilt: 'Written from the numbers below. No new searches.',
  executiveSaved: 'CiteFox AI summary from saved results. Timing, not proof.',
  nextActions: 'Next 3 actions',
  goals: 'Goal per kind',
  goalsLede:
    'Cited ÷ questions that showed an AI Overview. Questions and keywords are scored apart, each against its own band. Failed searches are left out.',
  stages: 'Coverage by journey stage',
  stagesLede: 'Buyer questions per stage: how many showed an AI Overview and how many cite you.',
  todo: 'To-do by match state',
  todoLede:
    'Every question that showed an AI Overview, grouped by what happened to it. Win odds rank the rows; they are a ranking aid, not a promise.',
  keywords: 'Keyword universe',
  keywordsLede: 'Keywords by group, intent, funnel stage and page type.',
  kinds: { question: 'Buyer questions', keyword: 'Keywords' },
  bandState: { below: 'Below the band', in: 'In the band', above: 'Above the band' },
  columns: {
    kind: 'Type',
    prompts: 'Questions',
    withAio: 'AI Overview shown',
    cited: 'Cited',
    rightPage: 'Right page',
    otherPage: 'Another page',
    named: 'Brand named',
    noAio: 'No AI Overview',
    failed: 'Searches failed',
    rate: 'Cited rate',
    band: 'Band',
    toReach: 'To reach the band',
    stage: 'Stage',
    questions: 'Questions',
    number: 'Q',
    question: 'Question',
    target: 'Target page',
    citedInstead: 'Cited instead',
    winOdds: 'Win odds',
    state: 'Match state',
    group: 'Group',
    groupKind: 'Type',
    intent: 'Intent',
    funnel: 'Funnel',
    pageType: 'Page type',
    keywords: 'Keywords',
    youCited: 'You cited'
  },
  noTarget: 'No page yet',
  winOddsNote: 'Win odds are a ranking aid, labelled as such.'
} as const

/** "Buyer questions: 11 of 26 cited (42%), goal 50–70%, 2 more to reach the band." */
export function topicGoalSentence(goal: {
  label: string
  cited: number
  withAio: number
  rate: number | null
  bandLo: number
  bandHi: number
  toReachBand: number
}): string {
  const band = `goal ${goal.bandLo}–${goal.bandHi}%`
  if (goal.rate === null) return `${goal.label}: no AI Overview yet, ${band}.`
  const reach =
    goal.toReachBand > 0
      ? `${goal.toReachBand} more to reach the band`
      : goal.rate > goal.bandHi
        ? 'above the band'
        : 'in the band'
  return `${goal.label}: ${goal.cited} of ${goal.withAio} cited (${goal.rate}%), ${band}, ${reach}.`
}

/** A deterministic next action for one to-do row (no Claude in exports). */
export function topicActionText(row: {
  state: 'not_cited' | 'other_page' | 'no_page'
  label: string
  text: string
  targetPath: string | null
  citedOwnPath: string | null
}): string {
  const short = row.text.length > 90 ? `${row.text.slice(0, 87).trimEnd()}…` : row.text
  if (row.state === 'no_page') return `Write a page for ${row.label}: ${short}`
  if (row.state === 'other_page') {
    const cited = row.citedOwnPath ?? 'another page of yours'
    return `${row.label} cites ${cited}: strengthen ${row.targetPath ?? 'the target page'} or make ${cited} the target.`
  }
  return `Strengthen ${row.targetPath ?? 'the target page'} for ${row.label}: ${short}`
}
