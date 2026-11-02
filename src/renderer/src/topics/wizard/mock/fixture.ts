/**
 * TextBolt answers for the Add wizard mock (dev and e2e builds only), taken
 * from the approved v2 mock-ups (Mockups/v2/Seed-*.dc.html and friends).
 */
import type { CompetitorClaim, TopicProfileSection, TopicStage } from '@shared/domain'

export const FIXTURE_SEED = 'Text alerts for teams without a developer'

export const FIXTURE_ABOUT =
  'Email-to-text for business alerts: send from Gmail, Outlook or any system that emails, and staff get normal texts. No app, no code.'

export const FIXTURE_DISCOVERY = {
  readPages: 'Home, pricing, use cases, integrations, FAQ',
  problems: [
    { text: 'Monitoring alerts that never reach on-call phones', recheck: false },
    { text: 'Carrier email-to-text gateways shutting down', recheck: true },
    { text: 'Texting staff without 10DLC paperwork', recheck: true },
    { text: 'Shift and closure notices nobody reads by email', recheck: false },
    { text: FIXTURE_SEED, recheck: false }
  ],
  segments: [
    'Clinics and multi-site offices',
    'Property maintenance crews',
    'MSPs with client alerts'
  ],
  // Feedback 3: live rivals only; the carrier gateways and WIN-911 are their own groups.
  competitors: [
    {
      name: 'Text-Em-All',
      domain: 'text-em-all.com',
      path: '/compare/',
      quote: 'TextBolt vs Text-Em-All'
    },
    {
      name: 'SimpleTexting',
      domain: null,
      path: '/compare/',
      quote: 'SimpleTexting starts with a monthly plan.'
    }
  ],
  switchingFrom: [
    {
      name: 'AT&T email-to-text',
      domain: null,
      path: '/faq/',
      quote: 'AT&T shut down its email-to-text gateway.'
    },
    { name: 'Verizon vText', domain: null, path: '/faq/', quote: 'Verizon discontinued vtext.com.' }
  ],
  integrations: [
    {
      name: 'WIN-911',
      domain: null,
      path: '/integrations/',
      quote: 'WIN-911 sends its alarms through TextBolt.'
    }
  ],
  otherSeeds: ['Email alerts nobody reads on weekends', 'Replacing a carrier email-to-text gateway']
}

/** [section, point, found in, fact to re-check] */
export const FIXTURE_PROFILE_GAPS: readonly [
  TopicProfileSection,
  string,
  string | null,
  string | null
][] = [
  ['who', 'MSP owners routing client alerts', '/use-cases/it-alerts/', null],
  [
    'triggers',
    'Told they need 10DLC just to text their own staff',
    'FAQ',
    'Check the current 10DLC rule for internal staff texts'
  ],
  [
    'environment',
    'Alarm panels that can only send email',
    '/integrations/',
    'Check which alarm brands email only'
  ],
  ['segments', 'Schools texting substitute teachers', null, 'No page says this yet'],
  [
    'values',
    'Delivery reports for every alert',
    'FAQ',
    'Confirm delivery reports are on every plan'
  ],
  ['triggers', 'A new compliance rule for staff notices', null, null],
  ['poor_fit', 'Teams that need two-way chat with customers', null, null]
]

export const FIXTURE_DISCOVER_MORE: readonly [TopicStage, string][] = [
  [
    'fit',
    'We run four dental clinics and the front desk needs to text staff about closures. Can that work from the shared Outlook inbox we already use?'
  ],
  [
    'decide',
    "We're switching off our carrier's email-to-text address next month. What do we need to move our alarm alerts over without missing any?"
  ],
  [
    'doubts',
    'If our alert texts go to 80 people at once, will some of them arrive late or not at all?'
  ]
]

/** Imported lines, [text, source]. Repeats and brand lines exercise the clean-up. */
export const FIXTURE_IMPORT_PASTE = [
  'How do I text staff from Outlook?',
  "Alerts don't reach whoever is on call at night",
  'Our alarm panel only sends email. Can it text us?',
  'Field techs never read their email on the road',
  'sms alerts',
  'Do we need 10DLC registration just to text our own employees?',
  'do we need 10DLC registration just to text our own employees',
  'Is TextBolt cheaper than SimpleTexting for 30 staff?',
  'How much does an email-to-text service cost for a team of about 30?',
  'Can we try it with our monitoring emails first?',
  'How fast can we switch off vtext.com?',
  'Can replies come back to my inbox?'
].join('\n')

export const FIXTURE_IMPORT_CSV = [
  'question,channel,notes',
  '"Server alerts sit unread over the weekend",Support,',
  '"Staff ignore the app we asked them to install",Sales call,',
  '"Is email-to-text better than a group text app?",Sales call,',
  '"Can I keep Gmail and still send texts?",Support,',
  '"Will carriers block 50 identical texts?",Support,',
  '"Does TextBolt work with an Outlook shared mailbox?",Support,brand',
  '"We have volunteers, not staff. Does that matter?",Web form,',
  '"Twilio alternative for a team that doesn\'t code?",Web form,',
  '"How much does an email-to-text service cost for a team of about 30?",Sales call,dup'
].join('\n')

/** Clean-up rewrites: fragment → buyer sentence. */
export const FIXTURE_CLEANUP: Readonly<Record<string, string>> = {
  'sms alerts': 'What is the easiest way to send SMS alerts to staff who never check email?',
  'Can replies come back to my inbox?':
    'If staff reply to an alert text, can the reply come back to my inbox?',
  'How fast can we switch off vtext.com?':
    "How fast can we move our alerts off Verizon's vtext.com before it shuts down?"
}

export const FIXTURE_COMPETITOR_URL = 'https://www.simpletexting.com/sms-alerts-for-business/'

export const FIXTURE_COMPETITOR_READ = {
  domain: 'simpletexting.com',
  title: 'Business SMS alerts: send urgent texts to staff and customers',
  metaDescription: 'Send SMS alerts for outages, closures and shift changes from one dashboard.',
  h1: 'Send SMS alerts your team actually reads',
  wordCount: 2140,
  outline: [
    'What are SMS alerts?',
    'Types of business alerts you can send',
    'Send alerts from email and other apps',
    'How to send an SMS alert in 4 steps',
    'Delivery reports and opt-outs',
    'Pricing for alert messages',
    'Frequently asked questions',
    'Customer stories',
    'Get started free'
  ],
  faqCount: 7
}

export const FIXTURE_COMPETITOR_CLAIMS: readonly CompetitorClaim[] = [
  {
    id: 'claim-1',
    claim: 'Delivery reports show who got each alert',
    onYourSite: 'no',
    section: 'Delivery reports and opt-outs'
  },
  {
    id: 'claim-2',
    claim: 'Works with thousands of apps via Zapier',
    onYourSite: 'partly',
    section: 'Send alerts from email and other apps'
  },
  {
    id: 'claim-3',
    claim: 'Alerts arrive within seconds for 100 recipients',
    onYourSite: 'no',
    section: 'Frequently asked questions'
  },
  {
    id: 'claim-4',
    claim: 'Opt-outs are handled automatically',
    onYourSite: 'partly',
    section: 'Delivery reports and opt-outs'
  },
  {
    id: 'claim-5',
    claim: 'Free trial with no card',
    onYourSite: 'no',
    section: 'Pricing for alert messages'
  }
]

/** [stage, question, their section, starts left out] */
export const FIXTURE_COMPETITOR_QUESTIONS: readonly [TopicStage, string, string, boolean?][] = [
  [
    'problem',
    "Our staff miss urgent schedule changes we send by email. What's the fastest way to get an alert onto everyone's phone?",
    'What are SMS alerts?'
  ],
  [
    'problem',
    'Our outage notices go out by email and customers still call us. How do other businesses get the word out faster?',
    'Types of business alerts you can send'
  ],
  [
    'problem',
    'How do I warn every employee about a weather closure in the next ten minutes?',
    'Types of business alerts you can send'
  ],
  [
    'problem',
    'Our managers spend an hour phoning staff about shift changes. Is there a quicker way?',
    'What are SMS alerts?'
  ],
  [
    'options',
    'What kinds of alerts can a small business send by text, like outages, weather closures or shift changes?',
    'Types of business alerts you can send'
  ],
  [
    'options',
    'Can a text alert go out automatically when our booking system or help desk sends an email?',
    'Send alerts from email and other apps'
  ],
  [
    'options',
    'Is it better to send staff alerts from a texting app or from the email tools we already use?',
    'Send alerts from email and other apps'
  ],
  [
    'options',
    'What are the steps to send a text alert to a whole team for the first time?',
    'How to send an SMS alert in 4 steps'
  ],
  [
    'options',
    'Can I connect our scheduling software so changes go out as texts?',
    'Send alerts from email and other apps'
  ],
  [
    'doubts',
    'Do employees have to opt in before I can send them work alerts by text?',
    'Frequently asked questions'
  ],
  [
    'doubts',
    "If an urgent text alert doesn't get delivered, is there a way for me to know so I can call that person?",
    'Delivery reports and opt-outs'
  ],
  [
    'doubts',
    'What happens when an employee replies STOP to a work alert?',
    'Delivery reports and opt-outs'
  ],
  [
    'doubts',
    'How fast do text alerts actually arrive when we send to 100 people at once?',
    'Frequently asked questions'
  ],
  [
    'doubts',
    'Will alert texts count against a monthly limit, and what happens when we hit it?',
    'Pricing for alert messages'
  ],
  [
    'fit',
    'Is texting alerts worth it for a 15-person office, or is it built for big companies?',
    'Pricing for alert messages',
    true
  ],
  [
    'fit',
    'Can a franchise with eight locations send alerts to just one site?',
    'Types of business alerts you can send'
  ],
  [
    'fit',
    'Does text alerting work for crews with basic phones, not smartphones?',
    'Frequently asked questions'
  ],
  [
    'compare',
    'Is it cheaper to send staff alerts by text message or through a paging service?',
    'Pricing for alert messages'
  ],
  [
    'compare',
    'Should we use a mass notification system or a simple texting service for staff alerts?',
    'What are SMS alerts?'
  ],
  [
    'compare',
    'Push notifications or text messages: which do employees actually read?',
    'What are SMS alerts?'
  ],
  [
    'compare',
    'Is a free group text good enough for work alerts, or do we need a business service?',
    'Frequently asked questions',
    true
  ],
  [
    'decide',
    'How long does it take to set up text alerts for a small team, from sign-up to the first alert?',
    'How to send an SMS alert in 4 steps'
  ],
  [
    'decide',
    'How much do business text alerts cost per message for about 50 employees?',
    'Pricing for alert messages'
  ],
  [
    'decide',
    'Can I try text alerts free with my own team before paying?',
    'Pricing for alert messages'
  ]
]
