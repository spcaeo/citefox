import type { TopicResultRow, TopicRowState, TopicStage } from '@shared/domain'
import { textboltTopicResults } from '@shared/fixtures/textbolt-topic'
import type { TopicResults } from '@shared/ipc'

/**
 * The TextBolt "AT&T email-to-text gateway replacement" topic from the approved
 * mock-up (board "Topic"): 8 questions and 4 keywords, one check. 6 not cited, 5 cited
 * from another own page, 0 from the target page, 1 with no AI Overview (Q3).
 */

export const ATT_TOPIC_ID = 'topic-att'
export const ATT_TARGET = 'https://textbolt.com/blog/att-email-to-text-alternative'
export const ATT_CHECKED_AT = '2026-10-29T14:27:00.000Z'

const SITE = 'https://textbolt.com'

interface Seed {
  ref: string
  stage: TopicStage | null
  state: TopicRowState
  text: string
  odds?: number
  own?: string
  instead?: readonly string[]
}

const SEEDS: readonly Seed[] = [
  {
    ref: 'Q5',
    stage: 'problem',
    state: 'not_cited',
    odds: 70,
    text: 'Our dispatchers used to text technicians by emailing a carrier address from Gmail, and that stopped. What do we use now?',
    instead: ['reddit.com', 'att.com', 'twilio.com']
  },
  {
    ref: 'Q2',
    stage: 'options',
    state: 'not_cited',
    odds: 67,
    text: 'What can I use instead of the AT&T email-to-text gateway?',
    instead: ['reddit.com', 'simpletexting.com']
  },
  {
    ref: 'Q6',
    stage: 'fit',
    state: 'not_cited',
    odds: 55,
    text: 'I run IT for an MSP with about 60 clients, and their monitoring tools send alerts to txt.att.net. What fits us?',
    instead: ['reddit.com']
  },
  {
    ref: 'Q8',
    stage: 'decide',
    state: 'not_cited',
    odds: 55,
    text: 'We are a mid-size plant that relied on Win-911 text alarms through AT&T. Which replacement should we pick?',
    instead: ['win911.com']
  },
  {
    ref: 'K1',
    stage: null,
    state: 'not_cited',
    text: 'txt.att.net not working',
    instead: ['reddit.com', 'att.com']
  },
  {
    ref: 'K2',
    stage: null,
    state: 'no_page',
    text: 'att email to text alternative',
    instead: ['simpletexting.com']
  },
  {
    ref: 'Q4',
    stage: 'compare',
    state: 'other_page',
    odds: 77,
    own: `${SITE}/integration/nagios-email-to-text-alerts`,
    text: 'How does an email-to-SMS service compare with Twilio for Nagios alerts?',
    instead: ['twilio.com']
  },
  {
    ref: 'Q1',
    stage: 'problem',
    state: 'other_page',
    odds: 65,
    own: `${SITE}/migration/att/`,
    text: 'Why did my emails to txt.att.net stop arriving as texts?',
    instead: ['att.com']
  },
  {
    ref: 'Q7',
    stage: 'doubts',
    state: 'other_page',
    odds: 65,
    own: `${SITE}/blog/att-email-to-text-shutdown/`,
    text: 'Our Zabbix server pages on-call staff through email to an AT&T text address. Is that safe to keep?',
    instead: ['reddit.com']
  },
  {
    ref: 'K3',
    stage: null,
    state: 'other_page',
    own: `${SITE}/compare/`,
    text: 'email to sms gateway comparison',
    instead: ['g2.com']
  },
  {
    ref: 'K4',
    stage: null,
    state: 'other_page',
    own: `${SITE}/blog/textus-vs-textbolt/`,
    text: 'business email to text service pricing',
    instead: ['capterra.com']
  },
  {
    ref: 'Q3',
    stage: 'doubts',
    state: 'no_aio',
    text: 'Is an AT&T gateway replacement 10DLC compliant for business alert texts?'
  }
]

function row(seed: Seed): TopicResultRow {
  const kind = seed.ref.startsWith('Q') ? 'question' : 'keyword'
  const number = Number(seed.ref.slice(1))
  return {
    promptId: `att-${seed.ref.toLowerCase()}`,
    stableKey: `att-${seed.ref.toLowerCase()}`,
    number,
    kind,
    text: seed.text,
    stage: seed.stage,
    kwGroup: null,
    kwGroupKind: null,
    intent: null,
    funnel: null,
    pageType: null,
    state: seed.state,
    targetPageId: null,
    targetUrl: seed.state === 'no_page' ? null : ATT_TARGET,
    matchConfidence: null,
    matchReason: null,
    targetConfirmed: true,
    citedOwnUrl: seed.own ?? null,
    citedInstead: seed.instead ?? [],
    position: seed.own ? 2 : null,
    named: false,
    competitorCitedNotYou: false,
    winOdds:
      seed.odds === undefined
        ? null
        : { score: seed.odds, level: seed.odds >= 70 ? 'high' : 'medium', reason: 'Fixture.' },
    runId: 'run-att-1',
    checkedAt: ATT_CHECKED_AT,
    aioSummary: seed.state === 'no_aio' ? null : 'Google answered with a short overview.'
  }
}

export function attRows(): TopicResultRow[] {
  return SEEDS.map(row)
}

/** The topic's `topics:results`, built on the TextBolt fixture's shape with the AT&T rows. */
export function attTopicResults(
  patch: (rows: TopicResultRow[]) => TopicResultRow[] = (rows) => rows
): TopicResults {
  const base = textboltTopicResults()
  return {
    ...base,
    topic: {
      ...base.topic,
      id: ATT_TOPIC_ID,
      name: 'AT&T email-to-text gateway replacement',
      questions: 8,
      keywords: 4,
      targetPage: ATT_TARGET,
      checkedAt: ATT_CHECKED_AT
    },
    rows: patch(attRows()),
    progress: base.progress.slice(-1)
  }
}

/** The same topic on its first check with nothing cited: the calm first-check card. */
export function attFirstCheck(): TopicResults {
  return attTopicResults((rows) =>
    rows.map((item) =>
      item.state === 'other_page' ? { ...item, state: 'not_cited', citedOwnUrl: null } : item
    )
  )
}
