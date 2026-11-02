import type {
  AioReference,
  CitationClass,
  CitationSourceType,
  CoverageAction,
  CoverageLevel,
  CoverageMatrix,
  IntentStage,
  MarketCheckMetrics,
  PromptCheckRow,
  PromptCheckStatus,
  PromptSource
} from '@shared/domain'
import {
  overviewHash,
  type AnswerShapeCode,
  type StoredAnswerShape
} from '../../analytics/answer-shape/vocabulary'
import type { ExportCheck, ExportDataset, ExportPage } from '../types'

/**
 * A TextBolt-shaped dataset for report tests and sample outputs: two tracked pages, two
 * markets, three full checks plus a partial follow-up on the main page, YouTube, Reddit,
 * LinkedIn, review and competitor citations, a coverage matrix with FAQ drafts, a logged
 * fix and stored answer shapes. Test data only; never shipped in a build path.
 */

const HASH = 'b'.repeat(64)
const ALERTS = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const PRICING = 'https://textbolt.com/pricing/'

interface PromptSeed {
  id: string
  label: string
  text: string
  stage: IntentStage
  source: PromptSource
}

const ALERT_PROMPTS: readonly PromptSeed[] = [
  [
    'Alerts without a developer',
    'How can I send text alerts to my employees without hiring a developer or learning a new app?',
    'problem',
    'title_meta_h1'
  ],
  [
    'Schedule from Gmail',
    'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
    'solution',
    'title_meta_h1'
  ],
  [
    'Monitoring email to SMS',
    'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
    'problem',
    'trigger_event'
  ],
  [
    'txt.att.net replacement',
    "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts?",
    'trigger',
    'trigger_event'
  ],
  [
    'Verizon vtext shutdown',
    'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
    'trigger',
    'trigger_event'
  ],
  [
    'Scheduling software reminders',
    "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
    'solution',
    'title_meta_h1'
  ],
  [
    '10DLC for own staff',
    'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
    'objection',
    'objection'
  ],
  [
    'Cheap Twilio alternative',
    "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?",
    'comparison',
    'trigger_event'
  ],
  [
    'Friday to Saturday texts',
    "How do I send a text to my field techs early Saturday morning when I'm writing the update Friday afternoon?",
    'solution',
    'detail_check'
  ],
  [
    'Replies back to email',
    'Can employees reply to an automated business text alert and have the reply come back to my email?',
    'objection',
    'objection'
  ]
].map(([label, text, stage, source], index) => ({
  id: `alerts-p${index + 1}`,
  label: label ?? '',
  text: text ?? '',
  stage: stage as IntentStage,
  source: source as PromptSource
}))

const PRICING_PROMPTS: readonly PromptSeed[] = [
  [
    'SMS price per month',
    'How much should a 40-person company expect to pay per month to text staff alerts from email?',
    'objection',
    'objection'
  ],
  [
    'Per-message vs flat',
    'Is it cheaper to pay per text message or a flat monthly plan for business alerts?',
    'comparison',
    'title_meta_h1'
  ],
  [
    'Free trial texting',
    'Which business texting services let me try email-to-SMS alerts free before I pay?',
    'solution',
    'detail_check'
  ],
  [
    'Hidden carrier fees',
    'Are there hidden carrier or registration fees when a small business starts sending text alerts?',
    'objection',
    'objection'
  ],
  [
    'Budget for MSP',
    'I run a small MSP. What does it cost to give each client SMS alerts from their monitoring emails?',
    'problem',
    'trigger_event'
  ]
].map(([label, text, stage, source], index) => ({
  id: `pricing-p${index + 1}`,
  label: label ?? '',
  text: text ?? '',
  stage: stage as IntentStage,
  source: source as PromptSource
}))

type RefKind =
  | 'target'
  | 'own'
  | 'login'
  | 'twilio'
  | 'simpletexting'
  | 'youtube'
  | 'youtube-share'
  | 'reddit'
  | 'linkedin'
  | 'g2'
  | 'zapier'

const REFS: Record<
  RefKind,
  { url: string; domain: string; cls: CitationClass; type: CitationSourceType; title: string }
> = {
  target: {
    url: ALERTS,
    domain: 'textbolt.com',
    cls: 'target',
    type: 'web',
    title: 'How to Set Up Text Alerts for Business'
  },
  own: {
    url: 'https://textbolt.com/blog/email-to-sms/',
    domain: 'textbolt.com',
    cls: 'own',
    type: 'web',
    title: 'Email to SMS, explained'
  },
  login: {
    url: 'https://textbolt.com/login',
    domain: 'textbolt.com',
    cls: 'own',
    type: 'web',
    title: 'Log in'
  },
  twilio: {
    url: 'https://www.twilio.com/docs/sms',
    domain: 'twilio.com',
    cls: 'competitor',
    type: 'web',
    title: 'Programmable SMS'
  },
  simpletexting: {
    url: 'https://simpletexting.com/text-alerts/',
    domain: 'simpletexting.com',
    cls: 'competitor',
    type: 'web',
    title: 'Text alerts'
  },
  youtube: {
    url: 'https://www.youtube.com/watch?v=Abc123XYZ00&t=49',
    domain: 'youtube.com',
    cls: 'other',
    type: 'youtube',
    title: 'Email to text in 5 minutes'
  },
  'youtube-share': {
    url: 'https://youtu.be/Abc123XYZ00?si=share',
    domain: 'youtu.be',
    cls: 'other',
    type: 'youtube',
    title: 'Email to text in 5 minutes'
  },
  reddit: {
    url: 'https://www.reddit.com/r/sysadmin/comments/abc123/vtext_is_going_away/',
    domain: 'reddit.com',
    cls: 'other',
    type: 'reddit',
    title: 'vtext is going away'
  },
  linkedin: {
    url: 'https://www.linkedin.com/posts/ops-lead_alerts-activity-1',
    domain: 'linkedin.com',
    cls: 'other',
    type: 'linkedin',
    title: 'How we moved our alerts'
  },
  g2: {
    url: 'https://www.g2.com/categories/sms-marketing',
    domain: 'g2.com',
    cls: 'other',
    type: 'review',
    title: 'Best SMS software'
  },
  zapier: {
    url: 'https://zapier.com/blog/email-to-sms/',
    domain: 'zapier.com',
    cls: 'other',
    type: 'web',
    title: 'How to send email as SMS'
  }
}

interface Outcome {
  status: PromptCheckStatus
  named: boolean
  refs: readonly RefKind[]
}

const o = (status: PromptCheckStatus, named: boolean, ...refs: RefKind[]): Outcome => ({
  status,
  named,
  refs
})

/** Main page, US, three full checks oldest first, then a partial follow-up. */
const ALERTS_US: readonly (readonly Outcome[])[] = [
  [
    o('not_cited', false, 'zapier'),
    o('not_cited', false, 'twilio'),
    o('page_cited', false, 'target', 'zapier'),
    o('not_cited', false, 'reddit'),
    o('not_cited', false, 'reddit'),
    o('not_cited', false, 'g2'),
    o('not_cited', false, 'twilio'),
    o('not_cited', false, 'twilio', 'simpletexting'),
    o('no_aio', false),
    o('not_cited', false, 'zapier')
  ],
  [
    o('not_cited', false, 'zapier', 'youtube'),
    o('page_cited', true, 'target'),
    o('page_cited', false, 'target', 'zapier'),
    o('not_cited', false, 'reddit'),
    o('not_cited', false, 'reddit', 'linkedin'),
    o('not_cited', false, 'g2'),
    o('brand_mentioned', true, 'twilio'),
    o('not_cited', false, 'twilio', 'simpletexting'),
    o('no_aio', false),
    o('page_cited', true, 'target')
  ],
  [
    o('page_cited', true, 'zapier', 'target', 'youtube'),
    o('not_cited', false, 'twilio', 'simpletexting'),
    o('page_cited', false, 'target', 'youtube-share'),
    o('other_own_page', true, 'reddit', 'own'),
    o('not_cited', false, 'reddit', 'linkedin'),
    o('brand_mentioned', true, 'g2'),
    o('not_cited', false, 'twilio'),
    o('not_cited', false, 'twilio', 'simpletexting', 'g2'),
    o('no_aio', false),
    o('page_cited', true, 'zapier', 'target', 'login')
  ]
]

const ALERTS_CA: readonly Outcome[] = [
  o('page_cited', true, 'target'),
  o('not_cited', false, 'simpletexting'),
  o('page_cited', true, 'target'),
  o('not_cited', false, 'reddit'),
  o('not_cited', false, 'youtube'),
  o('not_cited', false, 'zapier'),
  o('error', false),
  o('not_cited', false, 'twilio'),
  o('no_aio', false),
  o('brand_mentioned', true, 'zapier')
]

const PRICING_US: readonly Outcome[] = [
  o('not_cited', false, 'simpletexting', 'g2'),
  o('other_own_page', false, 'own', 'twilio'),
  o('not_cited', false, 'g2'),
  o('not_cited', false, 'twilio'),
  o('page_cited', true, 'zapier', 'target')
]

const SHAPES: readonly (readonly AnswerShapeCode[])[] = [
  ['A1', 'C4', 'D2'],
  ['A1', 'C4', 'D2'],
  ['B2', 'B3', 'F1'],
  ['A1', 'E1', 'C2'],
  ['A1', 'C4', 'D2'],
  ['A2', 'D1']
]

function overviewText(prompt: PromptSeed, outcome: Outcome, check: number): string {
  const brand = outcome.named ? ' TextBolt is one option that turns emails into texts.' : ''
  return `${prompt.label} (check ${check}). You can forward alert emails to an SMS gateway so staff get texts on their phones.${brand} Set the sender, add recipients as a group, and test with one message first. Carrier email gateways are being retired, so plan a replacement.`
}

function promptRow(
  prompt: PromptSeed,
  index: number,
  outcome: Outcome,
  pageUrl: string,
  checkedAt: string
): PromptCheckRow {
  const references: AioReference[] = outcome.refs.map((kind, at) => {
    const ref = REFS[kind]
    const url = kind === 'target' ? pageUrl : ref.url
    return {
      id: `${prompt.id}-${kind}-${at}`,
      position: at + 1,
      url,
      normalizedUrl: url.replace(/[?#].*$/, ''),
      domain: ref.domain,
      title: ref.title,
      classification: ref.cls,
      untracked: ref.cls === 'own',
      sourceType: ref.type
    }
  })
  const own = references.find(
    (ref) => ref.classification === 'target' || ref.classification === 'own'
  )
  const aio = outcome.status !== 'no_aio' && outcome.status !== 'error'
  return {
    promptId: prompt.id,
    promptPosition: index + 1,
    label: prompt.label,
    text: prompt.text,
    source: prompt.source,
    intentStage: prompt.stage,
    status: outcome.status,
    frequency: { matching: 1, samples: 1 },
    position: own?.position ?? null,
    citedUrl:
      outcome.status === 'page_cited' || outcome.status === 'other_own_page'
        ? (own?.url ?? null)
        : null,
    references,
    wrongPageCited: outcome.status === 'other_own_page',
    named: aio ? outcome.named : null,
    movement: null,
    previousStatus: null,
    previousPosition: null,
    coverage: null,
    action: null,
    aioSummary: null,
    checkedAt
  }
}

function check(
  runId: string,
  pageId: string,
  marketId: string,
  finishedAt: string,
  prompts: readonly PromptSeed[],
  outcomes: readonly Outcome[],
  pageUrl: string,
  options: { partial?: boolean; checkNo: number; actions?: boolean }
): ExportCheck {
  const rows = outcomes.flatMap((outcome, index) => {
    const prompt = prompts[index]
    return prompt === undefined ? [] : [promptRow(prompt, index, outcome, pageUrl, finishedAt)]
  })
  const count = (status: PromptCheckStatus): number =>
    rows.filter((row) => row.status === status).length
  const aio = rows.filter((row) => row.status !== 'no_aio' && row.status !== 'error').length
  const points = count('page_cited') * 3 + count('other_own_page') + count('brand_mentioned')
  const metrics: MarketCheckMetrics = {
    runId,
    pageId,
    marketId,
    promptSetId: `${pageId}-set`,
    promptSetVersion: 2,
    snapshotId: `${pageId}-snap`,
    contentHash: HASH,
    contentChanged: false,
    contentChange: null,
    kind: options.partial === true ? 'follow_up' : 'scheduled',
    partial: options.partial === true,
    status: 'finished',
    startedAt: finishedAt,
    finishedAt,
    promptsChecked: rows.length,
    promptsWithAio: aio,
    pageCited: count('page_cited'),
    otherOwnPage: count('other_own_page'),
    brandMentioned: count('brand_mentioned'),
    notCited: count('not_cited'),
    noAio: count('no_aio'),
    errors: count('error'),
    points,
    pointsPossible: aio * 3,
    visibilityScore: aio === 0 ? null : Math.round((points / (aio * 3)) * 100),
    citationsThisPage: count('page_cited'),
    citationsOtherOwn: count('other_own_page'),
    citedAndNamed: rows.filter((row) => row.status === 'page_cited' && row.named === true).length,
    averagePosition: null
  }
  return {
    finishedAt,
    role: null,
    metrics,
    prompts: rows,
    details: rows.map((row, index) => {
      const prompt = prompts[index]
      const outcome = outcomes[index]
      const aio = row.status !== 'no_aio' && row.status !== 'error'
      return {
        promptId: row.promptId,
        aioText:
          aio && prompt !== undefined && outcome !== undefined
            ? overviewText(prompt, outcome, options.checkNo)
            : null,
        references: row.references,
        aioGap: []
      }
    }),
    funnel: [],
    buckets: [],
    topActions:
      options.actions === true
        ? [
            {
              rank: 1,
              text: 'Add a Verizon vtext.com shutdown FAQ',
              reason: 'The overview answers the shutdown without you.',
              linkLabel: 'Open the gap for prompt 5',
              screen: 'gaps',
              promptId: 'alerts-p5'
            },
            {
              rank: 2,
              text: 'Rewrite the 10DLC FAQ to say "yes, even internal"',
              reason: 'Your brand was dropped from this answer.',
              linkLabel: 'Open the gap for prompt 7',
              screen: 'gaps',
              promptId: 'alerts-p7'
            },
            {
              rank: 3,
              text: 'Add a head-to-head Twilio comparison',
              reason: 'Twilio is cited and you are not.',
              linkLabel: 'Open the gap for prompt 8',
              screen: 'gaps',
              promptId: 'alerts-p8'
            }
          ]
        : [],
    leaderboard: [],
    cannibalizing: []
  }
}

const MATRIX: readonly [CoverageLevel, string[], string, CoverageAction[], string | null][] = [
  [
    'partial',
    ['Title/H1', 'Intro', 'At a Glance', 'No-code FAQ'],
    'No "hiring a developer" framing; never says employees need no app.',
    ['update_existing', 'new_faq'],
    'Do my employees need to install an app to get text alerts?'
  ],
  [
    'strong',
    ['Scheduling steps', 'Whole Team H3', 'Time zone note'],
    'Outlook steps are vague; the FAQ lacks scheduling.',
    ['update_existing'],
    null
  ],
  [
    'strong',
    ['Step 3', 'Step 5', 'Monitoring FAQ'],
    'No "where to paste the address" example.',
    ['small_update'],
    null
  ],
  [
    'partial',
    ['Step 5 note', 'Carrier FAQ'],
    'The FAQ explains why, not what to switch to.',
    ['update_existing', 'new_faq'],
    'What replaced txt.att.net for business alerts?'
  ],
  [
    'weak',
    ['One clause in the carrier FAQ'],
    'No dedicated answer despite the deadline.',
    ['new_faq'],
    'Verizon is shutting down vtext.com. What should a business switch to?'
  ],
  [
    'partial',
    ['Step 5', 'Recurring alerts'],
    'How customer reminders get addressed to phones.',
    ['update_existing', 'new_faq'],
    'Can scheduling software emails become SMS reminders?'
  ],
  [
    'strong',
    ['At a Glance', 'Step 1', '10DLC FAQ'],
    'Not "yes, even internal"; toll-free vs 10DLC unclear.',
    ['update_existing'],
    null
  ],
  [
    'partial',
    ['Method 3', 'Comparison table', 'Pricing'],
    '"Alternative to Twilio" is never phrased.',
    ['update_existing', 'new_faq'],
    'Is there a cheaper Twilio alternative without developers?'
  ],
  [
    'strong',
    ['Opening scenario', 'Who Holds the Clock'],
    'Only in the intro, no matching heading or FAQ.',
    ['optional_faq'],
    'Can I write a text Friday and send it Saturday morning?'
  ],
  [
    'strong',
    ['At a Glance', 'Step 4', 'Replies FAQ'],
    '"If two-way is enabled" sounds optional; noreply@ case.',
    ['update_existing'],
    null
  ]
]

function coverage(): CoverageMatrix {
  const faqAnswer =
    'No. Staff receive alerts as ordinary text messages on the phone they already carry, so there is nothing to install and nothing new to learn. You write the alert as an email from Gmail or Outlook, and the service turns it into an SMS. Replies come back to your inbox, so the whole team stays in one thread.'
  return {
    runId: 'cov-alerts',
    pageId: 'page-alerts',
    recordedAt: '2026-10-18T10:00:00.000Z',
    templateId: 'tpl-coverage',
    templateName: 'CiteFox default',
    templateHash: 'c'.repeat(64),
    templateUpdatedAt: null,
    contentHash: HASH,
    reused: false,
    stale: false,
    rows: MATRIX.map(([level, where, gap, actions, faq], index) => ({
      id: `gap-${index + 1}`,
      runId: 'cov-alerts',
      pageId: 'page-alerts',
      promptId: `alerts-p${index + 1}`,
      coverage: level,
      whereCovered: where,
      currentContent: `The page covers this in ${where[0] ?? 'the intro'}.`,
      whatToUpdate: `Edit ${where[0] ?? 'the intro'}: ${gap}`,
      mainGap: gap,
      priority: level === 'weak' ? 'high' : level === 'partial' ? 'medium' : 'low',
      actions: actions as [CoverageAction, ...CoverageAction[]],
      suggestedFaq: faq === null ? null : { question: faq, answer: faqAnswer, wordCount: 62 },
      done: false
    })),
    findings: [
      {
        id: 'f1',
        runId: 'cov-alerts',
        pageId: 'page-alerts',
        kind: 'title_length',
        summary:
          'The title is about 100 characters, so "(No Developer Required)" is cut in search results.',
        detail: 'Move the differentiator to the first 60 characters.'
      },
      {
        id: 'f2',
        runId: 'cov-alerts',
        pageId: 'page-alerts',
        kind: 'title_meta_mismatch',
        summary:
          'The title promises scheduled alerts from email; the meta description promises 5 steps without coding.',
        detail: 'Make both promise the same outcome.'
      },
      {
        id: 'f3',
        runId: 'cov-alerts',
        pageId: 'page-alerts',
        kind: 'factual_claim',
        summary: 'The page says "155 GSM characters"; a standard SMS is 160.',
        detail: 'Correct to 160 and re-verify at the source.'
      },
      {
        id: 'f4',
        runId: 'cov-alerts',
        pageId: 'page-alerts',
        kind: 'missing_promised_section',
        summary: 'The intro promises a carrier-gateway section that does not exist.',
        detail: 'Add the section or drop the promise.'
      },
      {
        id: 'f5',
        runId: 'cov-alerts',
        pageId: 'page-alerts',
        kind: 'typo',
        summary: 'An FAQ question ends with "??".',
        detail: 'Remove the extra question mark.'
      }
    ]
  }
}

function page(
  pageId: string,
  url: string,
  title: string,
  slug: string,
  markets: ExportPage['markets'],
  extras: Partial<ExportPage> = {}
): ExportPage {
  return {
    pageId,
    url,
    title,
    slug,
    metaDescription: null,
    h1: null,
    snapshotAt: '2026-10-16T09:00:00.000Z',
    modifiedAt: null,
    promptSetVersion: 2,
    stale: false,
    markets,
    gaps: null,
    sentiment: [],
    notes: [],
    fixes: [],
    ...extras
  }
}

export function richSampleDataset(): ExportDataset {
  const usChecks = ALERTS_US.map((outcomes, index) =>
    check(
      `run-us-${index + 1}`,
      'page-alerts',
      'mkt-us',
      ['2026-09-21T15:00:00.000Z', '2026-10-05T15:00:00.000Z', '2026-10-19T15:00:00.000Z'][index] ??
        '',
      ALERT_PROMPTS,
      outcomes,
      ALERTS,
      { checkNo: index + 1, actions: index === 2 }
    )
  )
  const partial = check(
    'run-us-followup',
    'page-alerts',
    'mkt-us',
    '2026-10-20T09:00:00.000Z',
    ALERT_PROMPTS.slice(0, 2),
    [o('page_cited', true, 'target'), o('page_cited', true, 'target')],
    ALERTS,
    { partial: true, checkNo: 4 }
  )
  const alerts = page(
    'page-alerts',
    ALERTS,
    'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)',
    'how-to-set-up-text-alerts-for-business',
    [
      { marketId: 'mkt-us', code: 'us-en', checks: [...usChecks, partial] },
      {
        marketId: 'mkt-ca',
        code: 'ca-en',
        checks: [
          check(
            'run-ca-1',
            'page-alerts',
            'mkt-ca',
            '2026-10-19T16:00:00.000Z',
            ALERT_PROMPTS,
            ALERTS_CA,
            ALERTS,
            { checkNo: 3 }
          )
        ]
      }
    ],
    {
      metaDescription:
        'Learn how to set up business text alerts in 5 steps without coding. Turn emails from your existing tools into SMS notifications with TextBolt.',
      h1: 'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)',
      modifiedAt: '2026-10-16T00:00:00.000Z',
      gaps: coverage(),
      fixes: [
        {
          number: 1,
          goLiveAt: '2026-10-12T15:00:00.000Z',
          description: 'Added the "no app to install" FAQ and the scheduling FAQ.',
          status: 'completed',
          promptIds: ['alerts-p1', 'alerts-p6'],
          marketIds: ['mkt-us'],
          verdict: null
        }
      ]
    }
  )
  const pricing = page('page-pricing', PRICING, 'TextBolt pricing', 'pricing', [
    {
      marketId: 'mkt-us',
      code: 'us-en',
      checks: [
        check(
          'run-pricing-1',
          'page-pricing',
          'mkt-us',
          '2026-10-19T15:30:00.000Z',
          PRICING_PROMPTS,
          PRICING_US,
          PRICING,
          { checkNo: 3 }
        )
      ]
    }
  ])
  const texts = [...usChecks, ...(alerts.markets[1]?.checks ?? [])]
    .flatMap((item) => item.details.map((detail) => detail.aioText))
    .filter((text): text is string => text !== null)
  const answerShapes: StoredAnswerShape[] = texts
    .slice(0, Math.floor(texts.length * 0.8))
    .map((text, index) => ({
      overviewHash: overviewHash(text),
      templateHash: 'd'.repeat(64),
      blocks: (SHAPES[index % SHAPES.length] ?? ['F2']).map((code) => ({
        code,
        excerpt: text.slice(0, 40)
      })),
      classifiedAt: '2026-10-19T17:00:00.000Z'
    }))
  return {
    projectName: 'TextBolt',
    projectSlug: 'textbolt',
    clientName: 'Northwind Ops',
    views: [],
    pages: [alerts, pricing],
    report: {
      domain: 'textbolt.com',
      brandNames: ['TextBolt'],
      competitors: ['twilio.com', 'simpletexting.com'],
      includeSubdomains: false,
      brandColor: null,
      markets: [
        { id: 'mkt-us', country: 'US', language: 'en' },
        { id: 'mkt-ca', country: 'CA', language: 'en' }
      ],
      templates: [
        { kind: 'buyer_prompts', name: 'CiteFox default', hash: 'e'.repeat(64) },
        { kind: 'coverage', name: 'CiteFox default', hash: 'c'.repeat(64) },
        { kind: 'answer_shape', name: 'CiteFox default', hash: 'd'.repeat(64) }
      ],
      answerShapes
    }
  }
}
