/** Seed data for the TextBolt topic fixture (`textbolt-topic.ts`). Dev, test and e2e only. */

import type {
  FunnelStage,
  KeywordGroupKind,
  KeywordIntent,
  KeywordIntentFamily,
  PageType,
  TopicProfilePoint,
  TopicStage
} from '../domain'

export const SITE = 'https://textbolt.com'

/** Target pages on textbolt.com (tracked page ids where tracked). */
export const PAGES = {
  multi: { id: 'page-multi', url: `${SITE}/use-cases/multi-location/` },
  carrier: { id: 'page-carrier', url: `${SITE}/blog/carrier-email-to-text-shutdown/` },
  it: { id: 'page-it', url: `${SITE}/use-cases/it-alerts/` },
  setup: { id: 'page-1', url: `${SITE}/blog/how-to-set-up-text-alerts-for-business/` },
  emailSms: { id: 'page-email-sms', url: `${SITE}/email-to-sms/` },
  field: { id: 'page-field', url: `${SITE}/use-cases/field-service/` },
  pricing: { id: 'page-pricing', url: `${SITE}/pricing/` },
  twilio: { id: 'page-twilio', url: `${SITE}/blog/twilio-alternative/` },
  outlook: { id: null, url: `${SITE}/integrations/outlook/` }
} as const

export type PageKey = keyof typeof PAGES

/**
 * Outcome codes for the two checks: R right page, O another own page, N not
 * cited (target exists), P no page and not cited, A no overview, F failed, - not checked.
 */
export type Code = 'R' | 'O' | 'N' | 'P' | 'A' | 'F' | '-'

export interface QuestionSeed {
  stage: TopicStage
  text: string
  target: PageKey | null
  confidence: number | null
  checks: readonly [Code, Code]
  instead: readonly string[]
  named?: boolean
}

export const Q: readonly QuestionSeed[] = [
  {
    stage: 'problem',
    text: 'Our alarm system only emails when the freezer temperature drops, and nobody checks email on weekends. How do we get those alerts as texts?',
    target: 'it',
    confidence: 86,
    checks: ['N', 'R'],
    instead: ['reddit.com', 'twilio.com']
  },
  {
    stage: 'problem',
    text: "I manage 40 field techs and they keep missing schedule changes because they don't read email on the road. What's the simplest fix?",
    target: 'field',
    confidence: 82,
    checks: ['R', 'R'],
    instead: ['simpletexting.com']
  },
  {
    stage: 'problem',
    text: 'Our monitoring tool sends email alerts at 2 a.m. that sit unread until morning. How can I turn them into text messages without code?',
    target: 'setup',
    confidence: 78,
    checks: ['O', 'R'],
    instead: ['reddit.com']
  },
  {
    stage: 'problem',
    text: 'We lost a client because a server-down email went unnoticed over a long weekend. How do other small IT teams make sure alerts reach a phone?',
    target: 'it',
    confidence: 74,
    checks: ['N', 'N'],
    instead: ['reddit.com', 'pagerduty.com']
  },
  {
    stage: 'problem',
    text: "My office manager sends the same urgent notice by email and then calls everyone who didn't read it. Is there a faster way to reach the whole team?",
    target: 'emailSms',
    confidence: 61,
    checks: ['N', 'N'],
    instead: ['simpletexting.com', 'textedly.com']
  },
  {
    stage: 'problem',
    text: 'I run three clinic locations and need to tell staff about closures fast, but half of them never open the staff app. What should we use instead?',
    target: 'multi',
    confidence: 88,
    checks: ['N', 'N'],
    instead: ['simpletexting.com', 'textedly.com', 'clinicsoftware.org']
  },
  {
    stage: 'options',
    text: "What are my options for sending text alerts to employees if we don't have a developer or an IT department?",
    target: 'setup',
    confidence: 90,
    checks: ['R', 'R'],
    instead: ['simpletexting.com']
  },
  {
    stage: 'options',
    text: 'Our carrier email-to-text address stopped delivering messages. What do businesses switch to so automated alerts still reach phones?',
    target: 'carrier',
    confidence: 84,
    checks: ['N', 'N'],
    instead: ['reddit.com', 'verizon.com']
  },
  {
    stage: 'options',
    text: 'Can I keep using Gmail to send staff alerts and have them arrive as normal texts, or do I need a separate texting app?',
    target: 'emailSms',
    confidence: 80,
    checks: ['O', 'O'],
    instead: ['support.google.com']
  },
  {
    stage: 'options',
    text: 'Is it better to send staff alerts from a texting app, from email-to-SMS, or from a paging service for a 30-person company?',
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['pagerduty.com', 'reddit.com']
  },
  {
    stage: 'options',
    text: 'Our booking system can only send emails. Is there a way to forward those automatically as SMS reminders to customers and staff?',
    target: 'emailSms',
    confidence: 72,
    checks: ['A', 'A'],
    instead: []
  },
  {
    stage: 'doubts',
    text: 'Do I need 10DLC registration just to text alerts to my own employees, and can a service handle that paperwork for us?',
    target: 'setup',
    confidence: 66,
    checks: ['N', 'N'],
    instead: ['twilio.com', 'ctia.org']
  },
  {
    stage: 'doubts',
    text: 'Will texts sent from an email-to-SMS service get filtered as spam by carriers, and how do we keep alerts from being blocked?',
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['twilio.com', 'ctia.org', 'reddit.com']
  },
  {
    stage: 'doubts',
    text: 'If an employee replies to an automated text alert, can that reply come back to my email inbox instead of a separate app?',
    target: 'emailSms',
    confidence: 83,
    checks: ['R', 'R'],
    instead: ['simpletexting.com'],
    named: true
  },
  {
    stage: 'doubts',
    text: 'Is it legal to text employees on their personal phones for work alerts, and what consent do we need first?',
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['shrm.org', 'reddit.com']
  },
  {
    stage: 'doubts',
    text: 'What happens to our text alerts if the email-to-SMS service goes down? Is there a fallback so nobody misses an urgent message?',
    target: 'it',
    confidence: 48,
    checks: ['F', 'A'],
    instead: []
  },
  {
    stage: 'fit',
    text: "We're a property management company with maintenance crews on call. Does email-to-text work for after-hours emergencies?",
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['buildium.com', 'reddit.com']
  },
  {
    stage: 'fit',
    text: 'I run IT for a small manufacturer and our equipment emails fault codes. Can those go straight to the on-call tech as a text?',
    target: 'it',
    confidence: 79,
    checks: ['O', 'R'],
    instead: ['reddit.com']
  },
  {
    stage: 'fit',
    text: 'Can a school office text substitute teachers from a shared Outlook account without everyone installing an app?',
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['remind.com']
  },
  {
    stage: 'fit',
    text: "We're a 12-person HVAC company. Is email-to-text enough for us, or will we outgrow it within a year?",
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['servicetitan.com', 'reddit.com']
  },
  {
    stage: 'compare',
    text: 'How does a free carrier email-to-text address compare with a paid email-to-SMS service for sending business alerts?',
    target: 'carrier',
    confidence: 70,
    checks: ['N', 'N'],
    instead: ['reddit.com', 'twilio.com']
  },
  {
    stage: 'compare',
    text: 'SimpleTexting or an email-to-SMS service for staff alerts: which is easier when nobody on the team writes code?',
    target: 'twilio',
    confidence: 58,
    checks: ['N', 'O'],
    instead: ['simpletexting.com']
  },
  {
    stage: 'compare',
    text: 'Is ClickSend or EZ Texting better for sending operational alerts to employees, or is there a simpler option for small teams?',
    target: null,
    confidence: null,
    checks: ['P', 'P'],
    instead: ['clicksend.com', 'eztexting.com', 'g2.com']
  },
  {
    stage: 'compare',
    text: "PagerDuty feels like overkill for our small team. What's a lighter way to make sure alerts reach someone's phone?",
    target: 'it',
    confidence: 64,
    checks: ['N', 'N'],
    instead: ['pagerduty.com', 'reddit.com']
  },
  {
    stage: 'decide',
    text: 'How much should a small business expect to pay per month to send text alerts to about 50 employees?',
    target: 'pricing',
    confidence: 87,
    checks: ['R', 'R'],
    instead: ['simpletexting.com']
  },
  {
    stage: 'decide',
    text: 'What do I need to set up on day one to start sending text alerts from Gmail to my staff?',
    target: 'setup',
    confidence: 92,
    checks: ['N', 'R'],
    instead: ['support.google.com'],
    named: true
  },
  {
    stage: 'decide',
    text: "How quickly can we move our alerts off Verizon's vtext.com gateway before it shuts down, and what breaks if we wait?",
    target: 'carrier',
    confidence: 89,
    checks: ['R', 'R'],
    instead: ['verizon.com', 'reddit.com']
  },
  {
    stage: 'decide',
    text: 'Can we trial an email-to-SMS service with a few employees before committing, and what should we test first?',
    target: 'outlook',
    confidence: 52,
    checks: ['N', 'N'],
    instead: ['simpletexting.com', 'capterra.com']
  }
]

export interface GroupSeed {
  name: string
  kind: KeywordGroupKind
  family: KeywordIntentFamily | null
  intent: KeywordIntent
  funnel: FunnelStage
  pageType: PageType
  target: PageKey | null
  keywords: readonly string[]
}

export const G: readonly GroupSeed[] = [
  {
    name: 'Core Commercial / Category',
    kind: 'intent',
    family: 'core_category',
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: 'emailSms',
    keywords: [
      'business text alerts',
      'email to sms gateway',
      'email to sms software',
      'email to text service',
      'sms alert service',
      'text alert system for business'
    ]
  },
  {
    name: 'Cover — email to text',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: 'emailSms',
    keywords: [
      'best email to text',
      'email to text app',
      'email to text for business',
      'email to text online',
      'send email as text',
      'email to text free'
    ]
  },
  {
    name: 'Cover — email to sms',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: 'emailSms',
    keywords: [
      'email to sms',
      'email to sms service',
      'email to sms api free',
      'outlook email to sms',
      'gmail email to sms'
    ]
  },
  {
    name: 'Cover — text alerts',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: 'setup',
    keywords: [
      'text alerts',
      'text alert service',
      'automated text alerts',
      'text alerts for employees',
      'staff text alerts',
      'emergency text alerts'
    ]
  },
  {
    name: 'Cover — sms notifications',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: null,
    keywords: [
      'sms notifications',
      'sms notification service',
      'business sms notifications',
      'automated sms notifications',
      'sms notification system'
    ]
  },
  {
    name: 'Cover — mass texting',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: null,
    keywords: [
      'mass texting service',
      'mass text employees',
      'mass texting for business',
      'bulk text employees',
      'mass text app'
    ]
  },
  {
    name: 'Cover — group texting',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: null,
    keywords: [
      'group texting for business',
      'group text employees',
      'group texting app',
      'business group text',
      'group sms service'
    ]
  },
  {
    name: 'Definitional',
    kind: 'intent',
    family: 'definitional',
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'glossary',
    target: 'setup',
    keywords: [
      'what is email to sms',
      'what is an sms gateway',
      'what is a text alert',
      'email to text meaning',
      'what is 10dlc'
    ]
  },
  {
    name: 'Best / top lists',
    kind: 'intent',
    family: 'best_lists',
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'listicle',
    target: null,
    keywords: [
      'best email to sms service',
      'best text alert app',
      'best sms alert software',
      'top email to text services',
      'best mass texting service',
      'best business texting app'
    ]
  },
  {
    name: 'Pricing / free / trial',
    kind: 'intent',
    family: 'pricing',
    intent: 'commercial',
    funnel: 'bofu',
    pageType: 'product page',
    target: 'pricing',
    keywords: [
      'email to sms pricing',
      'text alert service cost',
      'free email to text',
      'sms alert free trial',
      'cheap business text alerts',
      'email to sms cost per message'
    ]
  },
  {
    name: 'Alternatives & vs',
    kind: 'intent',
    family: 'alternatives_vs',
    intent: 'commercial',
    funnel: 'bofu',
    pageType: 'comparison page',
    target: 'twilio',
    keywords: [
      'twilio alternative',
      'simpletexting alternative',
      'pagerduty alternative small team',
      'clicksend alternative',
      'eztexting alternative'
    ]
  },
  {
    name: 'Features',
    kind: 'intent',
    family: 'features',
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'product page',
    target: 'emailSms',
    keywords: [
      'two way email to sms',
      'sms replies to email',
      'scheduled text alerts',
      'text alert delivery reports',
      'email to sms with replies'
    ]
  },
  {
    name: 'How-To',
    kind: 'intent',
    family: 'how_to',
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    target: 'setup',
    keywords: [
      'how to send text alerts',
      'how to send email as text',
      'how to text employees',
      'how to set up sms alerts',
      'how to forward email to sms',
      'how to send group text from email'
    ]
  },
  {
    name: 'Benefits / ROI',
    kind: 'intent',
    family: 'benefits_roi',
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    target: null,
    keywords: [
      'benefits of text alerts',
      'sms vs email open rate',
      'why text employees',
      'text alerts roi',
      'sms alerts for business benefits'
    ]
  },
  {
    name: 'Problem-aware',
    kind: 'intent',
    family: 'problem_aware',
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    target: 'it',
    keywords: [
      'employees not reading email',
      'alerts missed on weekends',
      'email alerts not noticed',
      'monitoring alerts to phone',
      'server down alert text'
    ]
  },
  {
    name: 'Question long-tail',
    kind: 'intent',
    family: 'question_long_tail',
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    target: 'carrier',
    keywords: [
      'can i send a text from email',
      'does vtext still work',
      'is txt.att.net shutting down',
      'can i text from outlook',
      'how do email to text addresses work'
    ]
  },
  {
    name: 'Trust / risk',
    kind: 'intent',
    family: 'trust_risk',
    intent: 'informational',
    funnel: 'mofu',
    pageType: 'blog',
    target: null,
    keywords: [
      'is email to sms secure',
      'sms alerts spam filtering',
      'text alert compliance',
      'tcpa employee texts',
      '10dlc for internal alerts'
    ]
  },
  {
    name: 'Emerging terms',
    kind: 'intent',
    family: 'emerging_terms',
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    target: null,
    keywords: [
      'ai text alerts',
      'automated sms alerts ai',
      'ai powered notifications',
      'smart alert routing sms',
      'no code sms automation'
    ]
  },
  {
    name: 'Branded defensive',
    kind: 'intent',
    family: 'branded_defensive',
    intent: 'navigational',
    funnel: 'bofu',
    pageType: 'product page',
    target: 'pricing',
    keywords: [
      'email to sms reviews',
      'email to sms login',
      'email to sms support',
      'email to sms setup guide',
      'email to sms app download'
    ]
  },
  {
    name: 'Competitor vs',
    kind: 'intent',
    family: 'competitor_vs',
    intent: 'commercial',
    funnel: 'bofu',
    pageType: 'comparison page',
    target: 'twilio',
    keywords: [
      'simpletexting vs twilio',
      'clicksend vs twilio',
      'eztexting vs simpletexting',
      'textedly vs simpletexting',
      'twilio vs plivo for alerts'
    ]
  },
  {
    name: 'Carrier gateways',
    kind: 'coverage',
    family: null,
    intent: 'informational',
    funnel: 'tofu',
    pageType: 'blog',
    target: 'carrier',
    keywords: [
      'vtext.com shutdown',
      'att email to text',
      'tmomail.net not working',
      'verizon email to text',
      'carrier sms gateway list',
      'email to text gateway shutdown'
    ]
  },
  {
    name: 'Industry alerts',
    kind: 'coverage',
    family: null,
    intent: 'commercial',
    funnel: 'mofu',
    pageType: 'landing page',
    target: 'multi',
    keywords: [
      'clinic staff text alerts',
      'school text alerts staff',
      'church text alerts',
      'property management text alerts',
      'field service text alerts',
      'msp client sms alerts'
    ]
  }
]

export const PROFILE: readonly Omit<TopicProfilePoint, 'id' | 'isNew'>[] = [
  {
    section: 'who',
    text: 'Operations and office managers at US businesses with 10–250 staff',
    foundIn: '/about/',
    verify: null
  },
  {
    section: 'who',
    text: 'IT leads and MSP owners routing alerts to on-call staff',
    foundIn: '/use-cases/it-alerts/',
    verify: null
  },
  {
    section: 'who',
    text: 'Owner-operators with no developer on call',
    foundIn: 'FAQ',
    verify: null
  },
  {
    section: 'environment',
    text: 'Gmail or Outlook all day',
    foundIn: '/integrations/',
    verify: null
  },
  {
    section: 'environment',
    text: 'Monitoring, booking and alarm systems that only send email',
    foundIn: '/email-to-sms/',
    verify: null
  },
  {
    section: 'environment',
    text: 'Staff away from desks: field crews, clinics, sites',
    foundIn: '/use-cases/',
    verify: null
  },
  {
    section: 'environment',
    text: 'A carrier email-to-text address that used to work',
    foundIn: 'FAQ',
    verify: null
  },
  {
    section: 'segments',
    text: 'Field service and facilities',
    foundIn: '/use-cases/field-service/',
    verify: null
  },
  {
    section: 'segments',
    text: 'Small IT teams and MSPs',
    foundIn: '/use-cases/it-alerts/',
    verify: null
  },
  {
    section: 'segments',
    text: 'Multi-site: clinics, branches, schools',
    foundIn: '/use-cases/multi-location/',
    verify: null
  },
  { section: 'segments', text: 'Anyone whose carrier gateway broke', foundIn: 'FAQ', verify: null },
  {
    section: 'triggers',
    text: 'A missed alert caused real damage',
    foundIn: 'Reviews page',
    verify: null
  },
  {
    section: 'triggers',
    text: 'Carrier email-to-text stopped delivering',
    foundIn: 'FAQ',
    verify: null
  },
  {
    section: 'triggers',
    text: 'Their carrier gateway is shutting down',
    foundIn: 'FAQ',
    verify: 'Check the shutdown date with the carrier'
  },
  {
    section: 'triggers',
    text: 'Told they need 10DLC just to text their own staff',
    foundIn: null,
    verify: null
  },
  {
    section: 'triggers',
    text: 'A developer quote for Twilio came back too high',
    foundIn: '/blog/twilio-alternative/',
    verify: null
  },
  {
    section: 'values',
    text: 'Set up in about 30 minutes, nothing new to install',
    foundIn: '/',
    verify: null
  },
  {
    section: 'values',
    text: 'Replies come back to the inbox',
    foundIn: '/email-to-sms/',
    verify: null
  },
  { section: 'values', text: 'Compliance handled for them', foundIn: 'FAQ', verify: null },
  {
    section: 'values',
    text: 'A price around [$29–$49] a month',
    foundIn: '/pricing/',
    verify: 'Re-check the price on the pricing page'
  },
  {
    section: 'poor_fit',
    text: 'SMS marketers running promo campaigns',
    foundIn: 'FAQ',
    verify: null
  },
  {
    section: 'poor_fit',
    text: 'Developers building SMS into a product',
    foundIn: null,
    verify: null
  },
  {
    section: 'poor_fit',
    text: 'Teams that need acknowledgment and escalation',
    foundIn: null,
    verify: null
  },
  {
    section: 'poor_fit',
    text: 'High-volume senders above [10,000] texts a day',
    foundIn: '/pricing/',
    verify: 'Confirm the volume limit'
  }
]

/** A finished seed-path draft (every step filled), as `topics:getDraft` returns it. */
