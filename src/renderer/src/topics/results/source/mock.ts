import type { TopicBand, TopicGoal, TopicSummary } from '@shared/domain'
import { bandState, neededForBand, targetRate } from '@shared/topic-scoring'
import {
  TEXTBOLT_TOPIC_ID,
  TEXTBOLT_TOPIC_PROJECT_ID,
  textboltTopicResults
} from '@shared/fixtures/textbolt-topic'
import type { AssistLabel, TopicCallInfo, TopicResults, TopicStep } from '@shared/ipc'
import { WRITE_WITH_URL } from '@shared/ipc'
import { resolveTargetPage } from '@shared/target-page'
import { mockSuggestTarget, mockTargetSuggestions } from './mockTargets'
import type { TopicResultsSource } from './types'

/**
 * In-memory topic results over the shared TextBolt topic fixture, for the
 * dev build and the mock e2e build. Never in a release build (`source/index.ts`
 * loads it behind the mock guard). A changed target is kept here, so the
 * screen re-reads the new state.
 */

const SECONDS: Partial<Record<TopicStep, number>> = {
  why_not_cited: 8,
  draft_fix: 15,
  explain_citation: 5,
  topic_summary: 6,
  target_suggest: 12
}

function label(step: TopicStep): AssistLabel {
  const seconds = SECONDS[step] ?? 8
  return {
    connection: 'claude-code',
    connectionText: 'CiteFox AI · on your plan',
    expectedSeconds: seconds,
    text: `CiteFox AI · on your plan · about ${seconds} s`
  }
}

function info(step: TopicStep): TopicCallInfo {
  return {
    label: label(step),
    durationMs: (SECONDS[step] ?? 8) * 1000,
    model: null,
    searchesUsed: 0
  }
}

function withBand(goal: TopicGoal, band: TopicBand): TopicGoal {
  const needed = neededForBand(goal.withAio, band)
  return {
    ...goal,
    band,
    bandState: bandState(goal.rate, band),
    neededForBand: needed,
    toReachBand: Math.max(0, needed - goal.cited)
  }
}

export const MOCK_CARRIER_TOPIC_ID = 'topic-carrier-gateway'

function summaryOf(
  results: TopicResults,
  id = results.topic.id,
  name = results.topic.name
): TopicSummary {
  return {
    id,
    projectId: TEXTBOLT_TOPIC_PROJECT_ID,
    name,
    source: results.topic.source,
    status: results.topic.status,
    questions: results.topic.questions,
    keywords: results.topic.keywords,
    questionsGoal: results.goals.questions.rate,
    keywordsGoal: results.goals.keywords.rate,
    targetPct: targetRate(results.rows),
    bands: results.topic.bands,
    intervalDays: results.topic.intervalDays,
    checkedAt: results.topic.checkedAt,
    pendingBatches: results.topic.pendingBatches
  }
}

export function createMockTopicResultsSource(): TopicResultsSource {
  const targets = new Map<string, { pageId: string | null; url: string | null }>()

  let bands: TopicResults['topic']['bands'] | null = null
  /** The topic's own target page once set here (main resolves it the same way). */
  let targetPage: string | null = null

  function load(topicId: string, marketId: string | null, runId: string | null): TopicResults {
    if (topicId !== TEXTBOLT_TOPIC_ID && topicId !== MOCK_CARRIER_TOPIC_ID) {
      throw new Error('This topic was not found.')
    }
    const base = textboltTopicResults(runId)
    const market = base.topic.markets.find((item) => item.id === marketId) ?? base.topic.markets[0]
    const rows = base.rows.map((row) => {
      const target = targets.get(row.promptId)
      if (!target) return row
      const state =
        row.state === 'no_page' && target.url
          ? 'not_cited'
          : row.state === 'not_cited' && !target.url
            ? 'no_page'
            : row.state
      return {
        ...row,
        targetPageId: target.pageId,
        targetUrl: target.url,
        targetConfirmed: true,
        state,
        matchConfidence: target.url ? 100 : null,
        matchReason: target.url ? 'Set by you.' : null
      }
    })
    const named =
      topicId === MOCK_CARRIER_TOPIC_ID
        ? { id: MOCK_CARRIER_TOPIC_ID, name: 'Carrier gateway replacement' }
        : null
    const goals = bands
      ? {
          questions: withBand(base.goals.questions, bands.questions),
          keywords: withBand(base.goals.keywords, bands.keywords)
        }
      : base.goals
    return {
      ...base,
      topic: {
        ...base.topic,
        ...(named ?? {}),
        ...(bands ? { bands } : {}),
        targetPage,
        marketId: market?.id ?? base.topic.marketId
      },
      goals,
      rows
    }
  }

  return {
    async results(request) {
      return load(request.topicId, request.marketId, request.runId)
    },
    async list() {
      const results = textboltTopicResults()
      return [
        summaryOf(results),
        {
          ...summaryOf(results, MOCK_CARRIER_TOPIC_ID, 'Carrier gateway replacement'),
          questionsGoal: 58
        }
      ]
    },
    async pageCandidates() {
      const results = textboltTopicResults()
      const seen = new Map<string, string | null>()
      for (const row of results.rows) {
        if (row.targetUrl) seen.set(row.targetUrl, row.targetPageId)
      }
      return {
        candidates: [...seen.entries()].map(([url, pageId]) => ({
          pageId,
          url,
          title: null,
          source: pageId ? ('tracked' as const) : ('sitemap' as const),
          outline: []
        })),
        sitemapReadAt: '2026-10-18T08:00:00.000Z'
      }
    },
    async targetSuggestions(request) {
      return mockTargetSuggestions(request.topicId)
    },
    async suggestTarget() {
      return mockSuggestTarget()
    },
    async setTarget(request) {
      const target = request.target ?? { pageId: null, url: null }
      for (const promptId of request.promptIds) targets.set(promptId, target)
      return {
        draft: null,
        rows: request.promptIds.map((promptId) => ({
          promptId,
          targetPageId: target.pageId,
          targetUrl: target.url
        }))
      }
    },
    async whyNotCited(request) {
      const row = textboltTopicResults().rows.find((item) => item.promptId === request.promptId)
      const instead = row?.citedInstead ?? []
      return {
        promptId: request.promptId,
        reasons: [
          {
            text: 'The overview answers with a step-by-step setup; your page leads with features.',
            evidence: row?.targetUrl ?? null
          },
          {
            text: `${instead[0] ?? 'Another site'} answers the exact situation in its first paragraph.`,
            evidence: null
          },
          {
            text: 'Your page has no FAQ that uses the buyer’s words. [Check the live page]',
            evidence: null
          }
        ],
        citedInstead: instead.slice(0, 2).map((domain) => ({
          domain,
          url: `https://${domain}/`,
          whyItWins: 'Answers the question directly, near the top.'
        })),
        summary: 'Most likely a wording and structure gap, not authority. Timing, not proof.',
        info: info('why_not_cited')
      }
    },
    async draftFix(request) {
      const row = textboltTopicResults().rows.find((item) => item.promptId === request.promptId)
      return {
        promptId: request.promptId,
        where: {
          pageId: row?.targetPageId ?? null,
          url: row?.targetUrl ?? null,
          newPage: !row?.targetUrl
        },
        steps: [
          'Open with a two-sentence answer in the buyer’s words.',
          'Add an FAQ entry that repeats the question.',
          'Link to the setup guide from the first section.'
        ],
        draft:
          'Yes. Forward your alert emails to a TextBolt address and each one arrives as a text on the on-call phone, with no code and no app to install. [Confirm the setup time]',
        text: 'Answer first, then an FAQ entry.',
        writeWithUrl: WRITE_WITH_URL,
        info: info('draft_fix')
      }
    },
    async explainCitation(request) {
      const row = textboltTopicResults().rows.find((item) => item.promptId === request.promptId)
      const beside = row?.citedInstead ?? []
      return {
        promptId: request.promptId,
        runId: request.runId,
        text: 'The overview quotes your setup steps almost word for word; your page answers the exact situation first. Timing, not proof.',
        facts: [
          `Your page is cited at position ${row?.position ?? '—'}`,
          ...(beside[0] ? [`${beside[0]} is cited beside you`] : [])
        ],
        createdAt: '2026-10-21T08:00:00.000Z',
        info: info('explain_citation')
      }
    },
    async topicSummary(request) {
      const results = load(request.topicId, request.marketId, null)
      const text = results.savedSummary?.text ?? 'Since the last check: no change.'
      return {
        line: text,
        executive: text,
        nextActions: [],
        saved: { text, createdAt: '2026-10-21T08:00:00.000Z', runId: null },
        info: info('topic_summary')
      }
    },
    async update(request) {
      if (request.bands) bands = request.bands
      if (request.targetPage !== undefined) {
        const domain = textboltTopicResults().topic.domain ?? 'textbolt.com'
        const url =
          request.targetPage === null ? null : resolveTargetPage(request.targetPage, domain)
        if (request.targetPage !== null && url === null) throw new Error(`Use a page on ${domain}.`)
        targetPage = url
      }
      const results = load(request.topicId, null, null)
      return summaryOf(results, request.topicId, results.topic.name)
    },
    async describeStep(request) {
      return {
        step: request.step,
        label: label(request.step),
        reads: 'No new searches',
        searchCost: 0
      }
    }
  }
}
