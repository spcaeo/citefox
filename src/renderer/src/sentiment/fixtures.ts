import type {
  BrandPromptKind,
  ClaimSourceKind,
  ClaimTone,
  FactProblem,
  SentimentClaim,
  SentimentOverview,
  SentimentView
} from '@shared/domain'

/** TextBolt sample for the Sentiment tab tests and harness pages. Not shipped data. */

export const SENTIMENT_PROJECT = 'textbolt'
export const SENTIMENT_PAGE = 'textbolt-alerts'
export const SENTIMENT_MARKET = 'us-en'
const RUN = 'run-oct-19'
const CHECKED = '2026-10-19T12:00:00.000Z'
const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

const BRAND_PROMPTS: readonly { kind: BrandPromptKind; text: string; named: string[] }[] = [
  { kind: 'review', text: 'TextBolt reviews', named: ['TextBolt'] },
  { kind: 'pricing', text: 'TextBolt pricing', named: ['TextBolt', 'SimpleTexting'] },
  {
    kind: 'alternatives',
    text: 'TextBolt alternatives',
    named: ['SimpleTexting', 'TextBolt', 'Twilio']
  },
  {
    kind: 'comparison',
    text: 'TextBolt vs SimpleTexting for business alerts',
    named: ['TextBolt', 'SimpleTexting']
  },
  {
    kind: 'use_case',
    text: 'is TextBolt good for sending staff alerts from Outlook',
    named: ['TextBolt']
  }
]

const BUYER: readonly { label: string; text: string; named: string[] }[] = [
  {
    label: 'No developer',
    text: 'How can I send text alerts to my employees without hiring a developer?',
    named: ['Twilio', 'TextBolt']
  },
  {
    label: 'Schedule from Gmail',
    text: 'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
    named: ['SimpleTexting']
  },
  {
    label: 'Monitoring alerts',
    text: 'Our monitoring tool only sends email alerts. How do I get those as texts?',
    named: []
  },
  {
    label: 'Carrier gateway',
    text: "My email-to-text through txt.att.net stopped working. What's the best replacement?",
    named: ['TextBolt', 'Twilio']
  },
  {
    label: 'Verizon shutdown',
    text: 'Verizon is shutting down vtext.com. What should a small business switch to?',
    named: []
  },
  {
    label: 'Scheduling reminders',
    text: 'How do I turn emails from our scheduling software into SMS reminders?',
    named: []
  },
  {
    label: '10DLC',
    text: 'Do I need 10DLC registration to text my own employees?',
    named: []
  },
  {
    label: 'Twilio alternative',
    text: "What's a cheap alternative to Twilio if we don't have developers?",
    named: []
  }
]

function overview(
  id: string,
  source: SentimentOverview['source'],
  promptLabel: string,
  promptText: string,
  brandsNamed: readonly string[],
  promptId = `prompt-${id}`
): SentimentOverview {
  return {
    id,
    source,
    runId: RUN,
    marketId: SENTIMENT_MARKET,
    promptId,
    promptLabel,
    promptText,
    checkedAt: CHECKED,
    readState: 'read',
    brandsNamed,
    reason:
      brandsNamed[0] === 'TextBolt'
        ? 'The overview opens with TextBolt as the no-code email-to-SMS option.'
        : brandsNamed.includes('TextBolt')
          ? 'TextBolt is listed after a better-known tool.'
          : null,
    references: []
  }
}

export const SENTIMENT_OVERVIEWS: readonly SentimentOverview[] = [
  ...BRAND_PROMPTS.map((item, index) =>
    overview(`ov-b${index + 1}`, 'brand', item.kind, item.text, item.named, `bp-${index + 1}`)
  ),
  ...BUYER.map((item, index) =>
    overview(`ov-p${index + 1}`, 'buyer', item.label, item.text, item.named)
  )
]

let sequence = 0
function claim(
  overviewId: string,
  brand: string,
  theme: string,
  attribute: string,
  tone: ClaimTone,
  sentence: string,
  url: string | null = null,
  sourceKind: ClaimSourceKind | null = null,
  factProblem: FactProblem | null = null
): SentimentClaim {
  sequence += 1
  const found = SENTIMENT_OVERVIEWS.find((item) => item.id === overviewId)
  return {
    id: `claim-${sequence}`,
    overviewId,
    runId: RUN,
    marketId: SENTIMENT_MARKET,
    source: found?.source ?? 'brand',
    promptId: found?.promptId ?? 'prompt',
    brand,
    isOwn: brand === 'TextBolt',
    theme,
    attribute,
    tone,
    sentence,
    url,
    sourceKind,
    factProblem
  }
}

const G2 = 'https://www.g2.com/products/textbolt/reviews'
const REDDIT = 'https://www.reddit.com/r/sysadmin/comments/abc/email_alerts/'

export const SENTIMENT_CLAIMS: readonly SentimentClaim[] = [
  claim(
    'ov-b1',
    'TextBolt',
    'Ease of setup',
    'sets up in 30 minutes',
    'positive',
    'TextBolt sets up in about 30 minutes.',
    PAGE_URL,
    'this_page'
  ),
  claim(
    'ov-b1',
    'TextBolt',
    'Ease of setup',
    'no code',
    'positive',
    'No developer is needed to use TextBolt.'
  ),
  claim(
    'ov-b5',
    'TextBolt',
    'Ease of setup',
    'works from Outlook',
    'positive',
    'Staff can send alerts straight from Outlook.'
  ),
  claim(
    'ov-p1',
    'TextBolt',
    'Ease of setup',
    'no new app',
    'positive',
    'Employees do not need a new app.'
  ),
  claim(
    'ov-b2',
    'TextBolt',
    'Pricing',
    'flat plans',
    'positive',
    'Plans are flat at $29 and $49 a month.'
  ),
  claim('ov-b2', 'TextBolt', 'Pricing', 'predictable', 'positive', 'Pricing is predictable.'),
  claim('ov-b4', 'TextBolt', 'Pricing', 'monthly billing', 'neutral', 'TextBolt bills monthly.'),
  claim(
    'ov-b3',
    'TextBolt',
    'Pricing',
    'no free plan',
    'negative',
    'There is no free plan.',
    G2,
    'review'
  ),
  claim(
    'ov-b2',
    'TextBolt',
    'Pricing',
    'expensive',
    'negative',
    'TextBolt costs $99 a month.',
    G2,
    'review',
    {
      basis: 'fact',
      why: 'Your brand facts say the plans are $29 and $49 a month.',
      correction: 'TextBolt plans cost $29 or $49 a month.',
      sourceToFix: G2
    }
  ),
  claim(
    'ov-b5',
    'TextBolt',
    'Works with existing tools',
    'Gmail and Outlook',
    'positive',
    'It works with Gmail and Outlook.'
  ),
  claim(
    'ov-p4',
    'TextBolt',
    'Works with existing tools',
    'monitoring tools',
    'positive',
    'It turns Datadog emails into texts.'
  ),
  claim(
    'ov-b3',
    'TextBolt',
    'Works with existing tools',
    'email only',
    'negative',
    'It only works if your tool sends email.',
    REDDIT,
    'reddit'
  ),
  claim(
    'ov-b4',
    'TextBolt',
    'Replies',
    'two-way',
    'neutral',
    'Replies can come back to your inbox.'
  ),
  claim(
    'ov-b4',
    'TextBolt',
    'Replies',
    'replies optional',
    'negative',
    'Replies need two-way messaging enabled.',
    PAGE_URL,
    'this_page',
    {
      basis: 'page',
      why: 'Your page says replies are included on both plans.',
      correction: 'Replies come back to your inbox on both plans.',
      sourceToFix: PAGE_URL
    }
  ),
  claim(
    'ov-p4',
    'TextBolt',
    'Compliance',
    'handles 10DLC',
    'positive',
    'TextBolt handles 10DLC registration.'
  ),
  claim(
    'ov-b1',
    'TextBolt',
    'Compliance',
    'opt-in',
    'positive',
    'Opt-in rules are handled for you.'
  ),
  claim(
    'ov-b1',
    'TextBolt',
    'Support',
    'slow email',
    'negative',
    'Support replies by email can be slow.',
    REDDIT,
    'reddit'
  ),
  claim(
    'ov-b5',
    'TextBolt',
    'Use cases',
    'staff alerts',
    'neutral',
    'It is used for staff alerts.'
  ),
  claim(
    'ov-p1',
    'TextBolt',
    'Use cases',
    'field teams',
    'neutral',
    'Field teams use it for shift changes.'
  ),
  claim(
    'ov-b4',
    'SimpleTexting',
    'Replies',
    'shared inbox',
    'positive',
    'SimpleTexting has a shared inbox for replies.'
  ),
  claim(
    'ov-b3',
    'SimpleTexting',
    'Replies',
    'two-way',
    'positive',
    'SimpleTexting supports two-way texting.'
  ),
  claim(
    'ov-b2',
    'SimpleTexting',
    'Pricing',
    'per-credit',
    'negative',
    'SimpleTexting charges per credit.'
  ),
  claim(
    'ov-p2',
    'SimpleTexting',
    'Ease of setup',
    'quick start',
    'positive',
    'SimpleTexting is quick to start.'
  ),
  claim(
    'ov-p1',
    'Twilio',
    'Ease of setup',
    'needs developers',
    'negative',
    'Twilio needs a developer to set up.'
  ),
  claim('ov-b3', 'Twilio', 'Ease of setup', 'API first', 'negative', 'Twilio is API first.'),
  claim('ov-p4', 'Twilio', 'Pricing', 'pay as you go', 'neutral', 'Twilio is pay as you go.')
]

/** Own-brand claims of an earlier full check, matching its trend counts. */
function earlierRun(
  runId: string,
  checkedAt: string,
  tones: Readonly<Record<ClaimTone, number>>
): { overview: SentimentOverview; claims: SentimentClaim[] } {
  const base = overview('ov-p1', 'buyer', BUYER[0]?.label ?? '', BUYER[0]?.text ?? '', ['TextBolt'])
  const shown: SentimentOverview = { ...base, id: `${runId}-ov-p1`, runId, checkedAt }
  const claims = (['positive', 'neutral', 'negative'] as const).flatMap((tone) =>
    Array.from({ length: tones[tone] }, (_, index) => ({
      id: `${runId}-${tone}-${index + 1}`,
      overviewId: shown.id,
      runId,
      marketId: SENTIMENT_MARKET,
      source: 'buyer' as const,
      promptId: shown.promptId,
      brand: 'TextBolt',
      isOwn: true,
      theme: 'Pricing',
      attribute: 'price',
      tone,
      sentence: `TextBolt ${tone} claim ${index + 1}.`,
      url: null,
      sourceKind: null,
      factProblem: null
    }))
  )
  return { overview: shown, claims }
}

const EARLIER = [
  earlierRun('run-sep-21', '2026-09-21T12:00:00.000Z', { positive: 6, neutral: 4, negative: 2 }),
  earlierRun('run-oct-5', '2026-10-05T12:00:00.000Z', { positive: 12, neutral: 6, negative: 4 })
]

export function sentimentView(overrides: Partial<SentimentView> = {}): SentimentView {
  return {
    projectId: SENTIMENT_PROJECT,
    pageId: SENTIMENT_PAGE,
    marketId: SENTIMENT_MARKET,
    brand: 'TextBolt',
    competitors: ['SimpleTexting', 'Twilio'],
    brandPrompts: {
      pageId: SENTIMENT_PAGE,
      version: 1,
      savedAt: '2026-09-20T12:00:00.000Z',
      templateHash: 'a'.repeat(64),
      prompts: BRAND_PROMPTS.map((item, index) => ({
        id: `bp-${index + 1}`,
        position: index + 1,
        kind: item.kind,
        language: 'en',
        text: item.text
      })),
      languages: ['en'],
      missingLanguages: [],
      estimate: { prompts: 5, markets: 1, minSearches: 5, maxSearches: 10 }
    },
    facts: [
      {
        id: 'fact-1',
        text: 'Plans are $29 and $49 a month.',
        source: 'https://textbolt.com/pricing',
        addedAt: '2026-10-01T12:00:00.000Z'
      }
    ],
    latestRunId: RUN,
    overviews: SENTIMENT_OVERVIEWS,
    claims: SENTIMENT_CLAIMS,
    trend: [
      {
        runId: 'run-sep-21',
        checkedAt: '2026-09-21T12:00:00.000Z',
        overviews: 13,
        overviewsRead: 13,
        positive: 6,
        neutral: 4,
        negative: 2
      },
      {
        runId: 'run-oct-5',
        checkedAt: '2026-10-05T12:00:00.000Z',
        overviews: 13,
        overviewsRead: 13,
        positive: 12,
        neutral: 6,
        negative: 4
      },
      {
        runId: RUN,
        checkedAt: CHECKED,
        overviews: 13,
        overviewsRead: 13,
        positive: 10,
        neutral: 4,
        negative: 5
      }
    ],
    earlierClaims: EARLIER.flatMap((run) => run.claims),
    earlierOverviews: EARLIER.map((run) => run.overview),
    reading: { pending: 0, failed: 0, running: false },
    ...overrides
  }
}
