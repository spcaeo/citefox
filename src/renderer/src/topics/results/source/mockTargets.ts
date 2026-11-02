import type {
  SuggestTopicTargetResult,
  TopicTargetSuggestion,
  TopicTargetSuggestions
} from '@shared/ipc'

/**
 * Target page suggestions for the mock TextBolt topic, in the shape main returns for
 * the seeded fixture (`src/main/topics/target-suggest.test.ts`): the tracked set-up
 * guide cited most by Google and ChatGPT, then pages only an answer cites. Dev and
 * mock e2e builds only.
 */

const SITE = 'https://textbolt.com'

const SUGGESTIONS: readonly TopicTargetSuggestion[] = [
  {
    url: `${SITE}/blog/how-to-set-up-text-alerts-for-business`,
    title: 'How to set up text alerts for business',
    pageId: 'page-1',
    source: 'tracked',
    citedPrompts: 17,
    engines: [
      { engine: 'google_aio', prompts: 14 },
      { engine: 'chatgpt', prompts: 4 }
    ],
    bestPosition: 1
  },
  {
    url: `${SITE}/pricing`,
    title: 'TextBolt pricing',
    pageId: null,
    source: 'cited',
    citedPrompts: 4,
    engines: [
      { engine: 'google_aio', prompts: 3 },
      { engine: 'chatgpt', prompts: 1 }
    ],
    bestPosition: 2
  },
  {
    url: `${SITE}/use-cases/it-alerts`,
    title: 'IT alerts by text',
    pageId: null,
    source: 'sitemap',
    citedPrompts: 3,
    engines: [{ engine: 'google_aio', prompts: 3 }],
    bestPosition: 2
  },
  {
    url: `${SITE}/blog/carrier-email-to-text-shutdown`,
    title: 'Carrier email-to-text shutdown',
    pageId: null,
    source: 'cited',
    citedPrompts: 2,
    engines: [{ engine: 'google_aio', prompts: 2 }],
    bestPosition: 2
  }
]

export function mockTargetSuggestions(topicId: string): TopicTargetSuggestions {
  return {
    topicId,
    marketId: 'mkt-us',
    suggestions: SUGGESTIONS,
    checkedPrompts: 146,
    citedPrompts: 30,
    noun: 'questions and keywords',
    pick: {
      url: `${SITE}/blog/how-to-set-up-text-alerts-for-business`,
      note: 'Picked because Google and ChatGPT already cite it for 17 of 146 questions and keywords'
    }
  }
}

export function mockSuggestTarget(): SuggestTopicTargetResult {
  return {
    picks: [
      {
        url: `${SITE}/blog/how-to-set-up-text-alerts-for-business`,
        title: 'How to set up text alerts for business',
        reason:
          'Its headings walk a small team through sending alerts as texts, and Google and ChatGPT already cite it most.'
      },
      {
        url: `${SITE}/use-cases/it-alerts`,
        title: 'IT alerts by text',
        reason: 'It is about the on-call IT buyer most of the questions describe.'
      }
    ],
    newPage: {
      title: 'Replacing a carrier email-to-text gateway',
      path: '/email-to-text-gateway-replacement',
      about: 'What to switch to when a carrier gateway shuts down, and how to move alerts over.'
    },
    dropped: 0,
    info: {
      label: {
        connection: 'claude-code',
        connectionText: 'CiteFox AI · on your plan',
        expectedSeconds: 12,
        text: 'CiteFox AI · on your plan · about 12 s'
      },
      durationMs: 9000,
      model: null,
      searchesUsed: 0
    }
  }
}
