import type {
  PageResults,
  PromptCheckDetail,
  PromptCheckRow,
  ResultsHistory,
  SampleCapture
} from '@shared/domain'
import type { GetPromptCheckRequest, PageDetail } from '@shared/ipc'
import { TEXTBOLT_MARKETS, textboltResults } from '../m3/fixtures'
import type { PromptDetailSource } from './source'

/** The TextBolt alerts page with its stored checks, shared by the Prompt detail tests. */
export const results = textboltResults()
export const rows = [...results.prompts].sort((a, b) => a.promptPosition - b.promptPosition)

export function rowAt(index: number): PromptCheckRow {
  const row = rows[index]
  if (!row) throw new Error('fixture row missing')
  return row
}

export function sample(row: PromptCheckRow, patch: Partial<SampleCapture> = {}): SampleCapture {
  return {
    id: `sample-${row.promptId}`,
    sampleNo: 1,
    keyId: 'key-1',
    keyLabel: 'My plan',
    hasAio: row.references.length > 0,
    neededFollowup: true,
    searches: 2,
    errorCode: null,
    message: null,
    nextStep: null,
    aioText: row.references.length > 0 ? 'You can text employees from email.' : null,
    aioMarkdown: null,
    references: row.references,
    rawSearchJson: '{"search_metadata":{"id":"s1"}}',
    rawAioJson: JSON.stringify({
      ai_overview: {
        text_blocks:
          row.references.length > 0
            ? [
                {
                  type: 'paragraph',
                  snippet: 'You can text employees from email.',
                  snippet_highlighted_words: ['text']
                }
              ]
            : []
      }
    }),
    ...patch
  }
}

export function detailFor(row: PromptCheckRow, runId = 'run-current'): PromptCheckDetail {
  return {
    pageId: 'textbolt-alerts',
    marketId: 'us-en',
    runId,
    row,
    samples: [sample(row)],
    searchesUsed: 2,
    otherMarkets: [
      { marketId: 'us-en', text: row.text, status: row.status, position: row.position, runId },
      {
        marketId: 'mx-es',
        text: '¿Cómo envío alertas?',
        status: 'not_cited',
        position: null,
        runId: 'run-mx'
      }
    ],
    aioGap: [{ fact: 'Staff need **no new app**.', likelySource: 'simpletexting.com' }],
    whereCovered: ['Intro: "No custom development required"'],
    lens: {
      brandNames: ['TextBolt'],
      ownDomain: 'textbolt.com',
      includeSubdomains: true,
      productName: null,
      competitors: [{ name: 'SimpleTexting', domain: 'simpletexting.com', tier: 'direct' }]
    },
    overviewReads: [],
    google: {
      ownRank: {
        position: 3,
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        thisPage: true
      },
      hasResults: true,
      questions: [
        { text: 'Can I send text alerts to employees for free?', trackable: true },
        { text: 'Which plan covers scheduled texts?', trackable: false }
      ]
    }
  }
}

export const PAGE: PageDetail = {
  id: 'textbolt-alerts',
  projectId: 'textbolt',
  url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  title: 'How to Set Up Text Alerts for Business',
  label: 'Text alerts for business',
  folder: null,
  status: 'tracked',
  setupStep: null,
  intervalDays: 14,
  samples: 1,
  promptCount: 10,
  defaultMarketId: 'us-en',
  pinned: false,
  score: 50,
  promptSetVersion: 1,
  markets: TEXTBOLT_MARKETS,
  snapshotId: 'snap-1'
}

export const HISTORY: ResultsHistory = {
  pageId: 'textbolt-alerts',
  marketId: 'us-en',
  promptSetVersion: 1,
  points: [
    point('run-1', '2026-09-21T09:00:00.000Z', false),
    point('run-2', '2026-10-05T09:00:00.000Z', false),
    point('run-current', '2026-10-19T09:00:00.000Z', true)
  ]
}

function point(
  runId: string,
  finishedAt: string,
  contentChanged: boolean
): ResultsHistory['points'][number] {
  return {
    runId,
    finishedAt,
    promptSetVersion: 1,
    partial: false,
    pageCitedRate: 0.5,
    promptsChecked: 10,
    promptsTotal: 10,
    visibilityScore: 50,
    contentChanged
  }
}

export function source(
  overrides: Partial<PromptDetailSource> = {},
  data: PageResults = results
): PromptDetailSource & { calls: GetPromptCheckRequest[] } {
  const calls: GetPromptCheckRequest[] = []
  return {
    calls,
    'pages:get': async () => PAGE,
    'results:get': async () => data,
    'results:history': async () => HISTORY,
    'checks:getPrompt': async (request) => {
      calls.push(request)
      const row = data.prompts.find((item) => item.promptId === request.promptId) ?? null
      if (!row) throw new Error('Unknown question')
      if (request.runId === 'run-1') return detailFor({ ...row, status: 'not_cited' }, 'run-1')
      if (request.runId === 'run-2') return detailFor({ ...row, status: 'not_cited' }, 'run-2')
      return detailFor(row)
    },
    ...overrides
  }
}
