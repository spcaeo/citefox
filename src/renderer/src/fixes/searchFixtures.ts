import type { TopicRowState } from '@shared/domain'
import type {
  AssistResult,
  DraftFixResult,
  QuestionTarget,
  QuestionTargets,
  TopicPageBrief
} from '@shared/ipc'
import type { FixSearch, ProjectSearches } from '@shared/page-fixes'
import { winOddsLevel } from '@shared/topic-scoring'

/**
 * Tests only. What to fix on the TextBolt story: two topics and one tracked page,
 * so every kind of page fix shows, with "Nothing to do now" and searches not checked.
 *
 * - Nagios alerts (topic-nagios): target /integration/nagios-email-to-text-alerts.
 *   4 not cited (Improve), 2 cite /blog/nagios-setup/ (Owner), 2 target cited, 1 no AIO.
 * - School texts (topic-school): no target page. 3 no page (Write a new page), 1 no AIO,
 *   1 not checked.
 * - Pricing (page-pricing), a tracked page: 2 not cited (Improve), 1 cited.
 */

export const SEARCHES_BUILT_AT = '2026-10-29T10:27:00.000Z'
export const NAGIOS_TARGET = 'https://textbolt.com/integration/nagios-email-to-text-alerts'
export const NAGIOS_OTHER = 'https://textbolt.com/blog/nagios-setup/'
export const PRICING_URL = 'https://textbolt.com/pricing'

const SOURCES = {
  nagios: { id: 'topic-nagios', kind: 'topic', name: 'Nagios and monitoring alerts' },
  school: { id: 'topic-school', kind: 'topic', name: 'School emergency texts' },
  pricing: { id: 'page-pricing', kind: 'page', name: '/pricing' }
} as const

type SourceId = keyof typeof SOURCES

function fixSearch(
  source: SourceId,
  n: number,
  state: TopicRowState,
  odds: number | null,
  extra: Partial<FixSearch> = {}
): FixSearch {
  const from = SOURCES[source]
  const target =
    source === 'nagios'
      ? { targetPageId: 'page-nagios', targetUrl: NAGIOS_TARGET }
      : source === 'pricing'
        ? { targetPageId: 'page-pricing', targetUrl: PRICING_URL }
        : { targetPageId: null, targetUrl: null }
  const checked = state !== 'not_checked'
  return {
    id: `${from.id}|${source}-p${n}`,
    sourceKind: from.kind,
    sourceId: from.id,
    sourceName: from.name,
    promptId: `${source}-p${n}`,
    marketId: 'mkt-us',
    runId: checked ? `run-${source}` : null,
    label: `Q${n}`,
    kind: 'question',
    text: `${from.name} search ${n}`,
    state,
    ...target,
    citedOwnUrl:
      state === 'right_page' ? target.targetUrl : state === 'other_page' ? NAGIOS_OTHER : null,
    citedInstead: state === 'not_cited' || state === 'no_page' ? ['reddit.com', 'nagios.org'] : [],
    winOdds:
      odds === null ? null : { score: odds, level: winOddsLevel(odds), reason: 'A ranking aid.' },
    checkedAt: checked ? SEARCHES_BUILT_AT : null,
    ...extra
  }
}

export function fixSearches(): FixSearch[] {
  return [
    fixSearch('nagios', 1, 'not_cited', 74),
    fixSearch('nagios', 2, 'not_cited', 68),
    fixSearch('nagios', 3, 'not_cited', 55),
    fixSearch('nagios', 4, 'not_cited', 41),
    fixSearch('nagios', 5, 'other_page', 77),
    fixSearch('nagios', 6, 'other_page', 65),
    fixSearch('nagios', 7, 'right_page', null),
    fixSearch('nagios', 8, 'right_page', null),
    fixSearch('nagios', 9, 'no_aio', null),
    fixSearch('school', 1, 'no_page', 54),
    fixSearch('school', 2, 'no_page', 50),
    fixSearch('school', 3, 'no_page', 31),
    fixSearch('school', 4, 'no_aio', null),
    fixSearch('school', 5, 'not_checked', null),
    fixSearch('pricing', 1, 'not_cited', 62),
    fixSearch('pricing', 2, 'not_cited', 48),
    fixSearch('pricing', 3, 'right_page', null)
  ]
}

export function projectSearches(searches: readonly FixSearch[] = fixSearches()): ProjectSearches {
  return {
    projectId: 'proj-1',
    domain: 'textbolt.com',
    builtAt: SEARCHES_BUILT_AT,
    sources: Object.values(SOURCES),
    searches
  }
}

function target(
  id: string,
  kind: QuestionTarget['kind'],
  name: string,
  url: string | null,
  questions: number
): QuestionTarget {
  return {
    id,
    kind,
    name,
    url,
    status: 'tracked',
    questions,
    keywords: 0,
    samples: 1,
    marketIds: ['mkt-us'],
    nextCheckAt: null
  }
}

/** `prompts:addTargets`: the tracked Nagios page (no questions of its own), the topics, Pricing. */
export function questionTargets(): QuestionTargets {
  return {
    projectId: 'proj-1',
    markets: [
      {
        id: 'mkt-us',
        country: 'US',
        language: 'en',
        location: null,
        device: 'desktop',
        localWording: false,
        serpapiLocation: null
      }
    ],
    searchesLeft: 200,
    targets: [
      target('page-nagios', 'page', '/integration/nagios-email-to-text-alerts', NAGIOS_TARGET, 0),
      target('page-pricing', 'page', '/pricing', PRICING_URL, 3),
      target('topic-nagios', 'topic', SOURCES.nagios.name, null, 9),
      target('topic-school', 'topic', SOURCES.school.name, null, 5)
    ]
  }
}

const LABEL = {
  connection: 'claude-code',
  connectionText: 'CiteFox AI',
  expectedSeconds: 8,
  text: 'CiteFox AI · about 8 s'
} as const

const INFO = { label: LABEL, durationMs: 4200, model: null, searchesUsed: 0 } as const

/** `topics:draftFix` for a search: two steps and a paste-ready block. */
export function draftFixResult(promptId: string): DraftFixResult {
  return {
    promptId,
    where: { pageId: 'page-nagios', url: NAGIOS_TARGET, newPage: false },
    steps: ['Add a "Why Nagios texts stop arriving" section.', 'Quote the exact error messages.'],
    draft: 'Why Nagios texts stop arriving, and how to fix it in five minutes.',
    text: 'Fix brief for the Nagios page.',
    writeWithUrl: 'https://1000aioverviews.com/write',
    info: INFO
  }
}

/** `topics:draftPageBrief` for a search with no page. */
export function pageBriefResult(promptId: string): TopicPageBrief {
  return {
    promptId,
    summary: "Answer first: two sentences in the buyer's words, then the steps.",
    outline: [
      'What happens when carriers drop email-to-text',
      'Set up school alerts in 10 minutes'
    ],
    citedNow: ['reddit.com'],
    text: 'Page brief: school emergency texts.',
    writeWithUrl: 'https://1000aioverviews.com/write',
    info: INFO
  }
}

/** `assist:run` (`progress.draftFix`) on a tracked page. */
export function assistResult(assistId: string): AssistResult {
  return {
    runId: 'assist-run-1',
    assistId,
    title: 'Draft the fix',
    summary: 'Uses the checks already saved. No new searches.',
    items: [
      {
        id: 'i1',
        text: 'Fix 3: add a price table for teams',
        tag: 'Fix 3',
        detail: null,
        verify: null,
        sign: null
      },
      {
        id: 'i2',
        text: 'Q: How much is TextBolt for 10 users?',
        tag: 'new FAQ',
        detail: 'Pricing',
        verify: null,
        sign: null
      }
    ],
    caution: null,
    label: LABEL,
    savedDataOnly: true,
    searchesUsed: 0,
    durationMs: 3000,
    model: null
  }
}
