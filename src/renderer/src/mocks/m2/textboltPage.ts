import { SHIPPED_TEMPLATE_NAME } from '@shared/domain'
import type {
  BuyerProfile,
  CoverageAction,
  CoverageFinding,
  CoverageLevel,
  CoverageMatrix,
  CoveragePriority,
  CoverageRecord,
  IntentStage,
  OutlineEntry,
  PageFaq,
  PromptSource,
  SuggestedFaq
} from '@shared/domain'
import type { PageReadResult } from '@shared/ipc'
import { wordCount } from '../../pageSetup/model'

export const ALERTS_PAGE_ID = 'alerts'
export const ALERTS_SNAPSHOT_ID = 'snap-alerts'
export const ALERTS_READ_AT = '2026-10-19T10:02:00.000Z'
export const ALERTS_PUBLISHED_AT = '2026-09-03T00:00:00.000Z'
export const ALERTS_MODIFIED_AT = '2026-10-16T00:00:00.000Z'
export const PROFILE_TEMPLATE_ID = 'buyer-profile'
export const PROFILE_TEMPLATE_NAME = SHIPPED_TEMPLATE_NAME
export const PROMPTS_TEMPLATE_ID = 'buyer-prompts'
export const PROMPTS_TEMPLATE_NAME = SHIPPED_TEMPLATE_NAME
export const GAPS_TEMPLATE_ID = 'coverage'
export const GAPS_TEMPLATE_NAME = SHIPPED_TEMPLATE_NAME

/** 64 hex characters. The short form is 7c21…e9, matching the page-read mock-up. */
export const ALERTS_CONTENT_HASH = `7c21${'a'.repeat(58)}e9`
export const PROFILE_TEMPLATE_HASH = `4c2e${'b'.repeat(58)}a1`
export const PROMPTS_TEMPLATE_HASH = `e81a${'c'.repeat(58)}b2`
export const GAPS_TEMPLATE_HASH = `71d0${'d'.repeat(58)}c3`

export const ALERTS_TITLE =
  'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)'
export const ALERTS_META =
  'Learn how to set up business text alerts in 5 steps without coding. Turn emails from your existing tools into SMS notifications with TextBolt.'
export const ALERTS_BRAND_MESSAGE = 'None of these prompts contain TextBolt or Text Bolt.'

const TITLE_PREVIEW = 'How to Set Up Text Alerts for Business, Including Scheduled ...'

export interface PromptSeed {
  id: string
  position: number
  label: string
  source: PromptSource
  intentStage: IntentStage
  mappedElement: string
  en: string
  austin: string
  es: string
  rephrase: string
}

export const PROMPT_SEEDS: readonly PromptSeed[] = [
  {
    id: 'p1',
    position: 1,
    label: 'Alerts to employees, no developer, no new app',
    source: 'title_meta_h1',
    intentStage: 'problem',
    mappedElement: 'intro, At a Glance, no-code FAQ',
    en: 'How can I send text alerts to my employees without hiring a developer or learning a new app?',
    austin:
      'How can I send text alerts to my employees in Austin without hiring a developer or learning a new app?',
    es: '¿Cómo puedo enviar alertas por SMS a mis empleados sin contratar a un desarrollador ni instalar otra app?',
    rephrase:
      "What's the simplest way to text alerts to my staff without a developer or a new app for anyone to install?"
  },
  {
    id: 'p2',
    position: 2,
    label: 'Schedule a text to the whole team from Gmail/Outlook',
    source: 'title_meta_h1',
    intentStage: 'solution',
    mappedElement: 'H2 · How to Schedule a Text Alert from Gmail or Outlook',
    en: 'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
    austin: 'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
    es: '¿Hay forma de programar un mensaje de texto para todo mi equipo desde Gmail u Outlook?',
    rephrase: 'Can I schedule a text to my entire team from Outlook or Gmail?'
  },
  {
    id: 'p3',
    position: 3,
    label: 'Monitoring tool email alerts → texts',
    source: 'trigger_event',
    intentStage: 'problem',
    mappedElement: 'Step 3 · Connect your tools, monitoring FAQ',
    en: 'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
    austin:
      'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
    es: 'Nuestra herramienta de monitoreo solo manda alertas por correo. ¿Cómo las recibo como SMS en el celular?',
    rephrase: 'How do I turn email alerts from our monitoring tool into text messages on my phone?'
  },
  {
    id: 'p4',
    position: 4,
    label: 'txt.att.net stopped working, what to use instead',
    source: 'trigger_event',
    intentStage: 'trigger',
    mappedElement: 'carrier FAQ, Step 5 note',
    en: "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts?",
    austin:
      "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts in Austin?",
    es: 'Mi servicio de correo a SMS del operador dejó de funcionar. ¿Qué uso ahora para las alertas del negocio?',
    rephrase:
      "txt.att.net isn't delivering our alert emails anymore. What should a business use instead?"
  },
  {
    id: 'p5',
    position: 5,
    label: 'Verizon vtext.com shutdown, what to switch to',
    source: 'trigger_event',
    intentStage: 'trigger',
    mappedElement: 'carrier FAQ (one clause)',
    en: 'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
    austin:
      'Verizon is shutting down vtext.com. What should a small business in Austin switch to so our automated alerts keep reaching phones?',
    es: 'Mi operador ya no entrega los correos que mandamos a números de celular. ¿A qué me cambio para que las alertas automáticas sigan llegando?',
    rephrase:
      'What should we replace vtext.com with before Verizon shuts it down, so our automated alerts still reach phones?'
  },
  {
    id: 'p6',
    position: 6,
    label: 'Scheduling software emails → SMS reminders',
    source: 'title_meta_h1',
    intentStage: 'solution',
    mappedElement: 'Step 5, What About Recurring Alerts?',
    en: "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
    austin:
      "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
    es: '¿Cuál es la forma más fácil de convertir los correos de nuestro software de citas en recordatorios por SMS para clientes y personal?',
    rephrase:
      "How can our scheduling software's email notifications go out as text reminders to customers and staff?"
  },
  {
    id: 'p7',
    position: 7,
    label: '10DLC for own employees, service handles it',
    source: 'objection',
    intentStage: 'objection',
    mappedElement: 'Step 1 · 10DLC, 10DLC FAQ',
    en: 'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
    austin:
      'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
    es: '¿Necesito algún registro para mandar alertas por SMS a mis propios empleados, y hay un servicio que lo haga por mí?',
    rephrase:
      'Does texting my own employees need 10DLC registration, and can a service do it for me?'
  },
  {
    id: 'p8',
    position: 8,
    label: 'Cheap Twilio alternative without developers',
    source: 'trigger_event',
    intentStage: 'comparison',
    mappedElement: 'Method 3 · Twilio API, Pricing',
    en: "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?",
    austin:
      "What's a cheap alternative to Twilio for sending business text alerts in Austin if we don't have developers?",
    es: '¿Qué alternativa económica a Twilio hay para mandar alertas por SMS si no tenemos programadores?',
    rephrase: 'Is there a cheaper, no-code alternative to Twilio for business text alerts?'
  },
  {
    id: 'p9',
    position: 9,
    label: 'Text field techs Saturday morning, written Friday',
    source: 'objection',
    intentStage: 'problem',
    mappedElement: 'opening scenario, Who Holds the Clock',
    en: "How do I send a text to my field techs early Saturday morning when I'm writing the update Friday afternoon?",
    austin:
      "How do I send a text to my field techs in Austin early Saturday morning when I'm writing the update Friday afternoon?",
    es: '¿Cómo le mando un mensaje a mis técnicos de campo el sábado temprano si escribo el aviso el viernes en la tarde?',
    rephrase:
      'How can I write a text on Friday afternoon and have it reach my field techs early Saturday?'
  },
  {
    id: 'p10',
    position: 10,
    label: 'Replies to an automated alert come back to email',
    source: 'objection',
    intentStage: 'objection',
    mappedElement: 'Step 4, reply FAQ',
    en: 'Can employees reply to an automated business text alert and have the reply come back to my email?',
    austin:
      'Can employees reply to an automated business text alert and have the reply come back to my email?',
    es: '¿Los empleados pueden responder una alerta automática por SMS y que la respuesta me llegue al correo?',
    rephrase: 'If employees reply to an automated text alert, can the reply land in my email inbox?'
  }
]

function faq(question: string, answer: string): SuggestedFaq {
  return { question, answer, wordCount: wordCount(answer) }
}

const FAQ_1 = faq(
  'How can I send text alerts to employees without hiring a developer or adding a new app?',
  'Use an email-to-SMS gateway. You send an email to each employee’s gateway address from Gmail, Outlook, or any tool that already sends email, and they receive a standard text message. There’s no API to build and no developer to hire. Staff don’t install anything, and your team keeps working in the inbox they already use.'
)
const FAQ_4 = faq(
  'What should I use instead of txt.att.net for business alerts?',
  'Switch to a registered email-to-SMS gateway. In each system that emailed number@txt.att.net, replace the address with the gateway format (+1 and the phone number at sendemailtotext.com). The same address works for every carrier, so you don’t need to know who each person uses. Messages arrive from your verified business number.'
)
const FAQ_5 = faq(
  'Verizon is shutting down vtext.com. What should businesses do before the deadline?',
  'Find every system and contact list that sends to @vtext.com addresses: monitoring tools, alarm panels, scheduling software, and saved contacts. Replace each address with a registered gateway address before the shutdown. Then send a test alert to a Verizon phone to confirm delivery before the old address stops working.'
)
const FAQ_6 = faq(
  'Can my scheduling software send appointment reminders as text messages?',
  'Yes, if it sends email. For staff notifications, add each person’s gateway address as a recipient. For customer reminders, the tool needs to let you set the recipient as a custom address built from the customer’s phone number. Check your tool’s notification settings, and send a test before going live.'
)
const FAQ_8 = faq(
  'Is there a simpler alternative to Twilio for business text alerts?',
  'If your alerts already go out as email, an email-to-SMS gateway does the same job without code. Twilio is built for developers adding SMS to their own software, so it needs API setup, testing, and upkeep. A gateway takes about 30 minutes to set up, runs on a flat monthly plan, and handles 10DLC registration for you.'
)
const FAQ_9 = faq(
  'How do I send a Saturday-morning text when I write the update on Friday?',
  'Write the message in Gmail or Outlook on Friday and use Schedule Send so it leaves early Saturday. The gateway turns that scheduled email into a text for each field tech. You stay in the inbox you already use, and the crew gets a normal SMS on the phone they already carry.'
)

interface GapSeed {
  id: string
  promptId: string
  coverage: CoverageLevel
  whereCovered: readonly string[]
  currentContent: string
  whatToUpdate: string
  mainGap: string
  priority: CoveragePriority
  actions: readonly [CoverageAction, ...CoverageAction[]]
  suggestedFaq: SuggestedFaq | null
}

const GAP_SEEDS: readonly GapSeed[] = [
  {
    id: 'gap-1',
    promptId: 'p1',
    coverage: 'partial',
    whereCovered: [
      'Intro',
      'At a Glance',
      'no-code FAQ',
      'No custom development required',
      'use-case table'
    ],
    currentContent:
      'No-developer messaging is everywhere: the intro, At a Glance, the no-code FAQ and "No custom development required". Employees appear in the definition and the use-case table. "No new app" is only implied, in the Method 2 trade-off and the CTA.',
    whatToUpdate:
      'The no-code FAQ covers the sender side only. Add one sentence saying recipients get a normal SMS and install nothing.',
    mainGap: '"No new app" is only implied, and the no-code FAQ covers the sender side only.',
    priority: 'medium',
    actions: ['update_existing', 'new_faq'],
    suggestedFaq: FAQ_1
  },
  {
    id: 'gap-2',
    promptId: 'p2',
    coverage: 'strong',
    whereCovered: [
      'How to Schedule a Text Alert from Gmail or Outlook',
      'Send to the Whole Team',
      'contact-group tip',
      'time-zone warning'
    ],
    currentContent:
      'The best-structured section on the page: numbered steps, Gmail’s exact clicks, a whole-team H3, a contact-group tip and a time-zone warning.',
    whatToUpdate:
      'Outlook gets one vague line. Give the exact clicks for new Outlook and Outlook on the web (Send dropdown, then Schedule send) and for classic desktop (Options, then Delay Delivery).\nMention Schedule Send in the Gmail/Outlook FAQ.',
    mainGap: "Outlook gets one vague line; the Gmail/Outlook FAQ doesn't mention Schedule Send.",
    priority: 'low',
    actions: ['update_existing'],
    suggestedFaq: null
  },
  {
    id: 'gap-3',
    promptId: 'p3',
    coverage: 'strong',
    whereCovered: [
      'Step 3 (Datadog and Grafana, with links)',
      'monitoring FAQ',
      'note on no retry or acknowledgment'
    ],
    currentContent:
      "Strong. Datadog and Grafana are named with links, there's a monitoring FAQ, and an honest note that there's no retry or acknowledgment.",
    whatToUpdate:
      'Add a two-line example: add the gateway address as an email recipient in the tool’s contact-point settings.\nSay that long monitoring emails are split into several text segments.',
    mainGap: "No two-line setup example; doesn't say long alert emails split into several texts.",
    priority: 'low',
    actions: ['small_update'],
    suggestedFaq: null
  },
  {
    id: 'gap-4',
    promptId: 'p4',
    coverage: 'partial',
    whereCovered: ['Carrier FAQ (shutdown dates)', 'Step 5 note', 'link to the AT&T post'],
    currentContent:
      'The carrier FAQ gives shutdown dates. A note under Step 5 says to switch and links to the AT&T post.',
    whatToUpdate:
      'Fix the "??" typo in the FAQ question.\nAdd the migration step: replace number@txt.att.net with the gateway address. No need to know each person’s carrier.',
    mainGap: 'No migration step, and the carrier FAQ question ends with "??".',
    priority: 'medium',
    actions: ['update_existing', 'new_faq'],
    suggestedFaq: FAQ_4
  },
  {
    id: 'gap-5',
    promptId: 'p5',
    coverage: 'weak',
    whereCovered: ['One clause in the carrier FAQ', '@vtext.com in the Step 5 note'],
    currentContent:
      'One clause in the carrier FAQ ("phasing out vtext.com by March 31, 2027") and @vtext.com in the Step 5 note.',
    whatToUpdate:
      'Re-verify the March 31, 2027 date before you publish.\nConsider a short H3 under the carrier note.',
    mainGap: 'Nothing tells a business what to do before March 31, 2027.',
    priority: 'high',
    actions: ['new_faq'],
    suggestedFaq: FAQ_5
  },
  {
    id: 'gap-6',
    promptId: 'p6',
    coverage: 'partial',
    whereCovered: [
      'Step 5 (scheduling software)',
      'What About Recurring Alerts?',
      'use-case table'
    ],
    currentContent:
      "Step 5 lists scheduling software. There's a recurring-alerts section and the use-case table.",
    whatToUpdate:
      'Staff notifications are simple, but customer reminders only work if the tool can send to an address built from each customer’s phone number. Say so plainly.\nLink the alerts-vs-marketing consent FAQ.',
    mainGap:
      "Doesn't say customer reminders need the tool to send to an address built from each customer's number.",
    priority: 'medium',
    actions: ['update_existing', 'new_faq'],
    suggestedFaq: FAQ_6
  },
  {
    id: 'gap-7',
    promptId: 'p7',
    coverage: 'strong',
    whereCovered: [
      'At a Glance',
      'Step 1 ("1–2 business days")',
      '10DLC FAQ',
      'opt-in best practice'
    ],
    currentContent:
      'Well covered: At a Glance, Step 1 ("1–2 business days"), the 10DLC FAQ, and the opt-in best practice that "applies to staff as well as customers".',
    whatToUpdate:
      'Start the 10DLC FAQ with "Yes, even internal alerts to your own staff."\nExplain toll-free vs 10DLC in one line.',
    mainGap: 'The FAQ doesn’t open with "yes, even for staff"; toll-free vs 10DLC isn’t explained.',
    priority: 'low',
    actions: ['update_existing'],
    suggestedFaq: null
  },
  {
    id: 'gap-8',
    promptId: 'p8',
    coverage: 'partial',
    whereCovered: [
      'Method 3 (Twilio, with dev-heavy trade-offs)',
      'Pricing ($29 / $49)',
      'API comparison link'
    ],
    currentContent:
      'Method 3 names Twilio with its developer-heavy trade-offs. Pricing ($29 and $49) and the API comparison link exist, but the reader has to connect them.',
    whatToUpdate:
      'Add a short comparison of effort, not prices. Don’t quote Twilio’s per-message rates.',
    mainGap: 'The reader has to connect effort and price themselves.',
    priority: 'medium',
    actions: ['small_update', 'new_faq'],
    suggestedFaq: FAQ_8
  },
  {
    id: 'gap-9',
    promptId: 'p9',
    coverage: 'strong',
    whereCovered: ['Opening scenario', 'Who Holds the Clock table'],
    currentContent:
      'The opening scenario is a Friday-afternoon update for a Saturday-morning crew, and the Who Holds the Clock table says who schedules the send.',
    whatToUpdate:
      'An optional FAQ can repeat the Friday-to-Saturday schedule for readers who never see the intro.',
    mainGap: 'The answer lives in the intro and a table, with no matching FAQ.',
    priority: 'low',
    actions: ['optional_faq'],
    suggestedFaq: FAQ_9
  },
  {
    id: 'gap-10',
    promptId: 'p10',
    coverage: 'strong',
    whereCovered: ['At a Glance', 'Step 4', 'replies FAQ', 'benefits', 'stage table'],
    currentContent:
      'Replies are covered in At a Glance, Step 4, the replies FAQ, the benefits list, and the stage table.',
    whatToUpdate:
      'Say that a reply lands in the inbox when two-way messaging is on, and name the noreply@ case so buyers don’t miss it.',
    mainGap: '"If two-way is enabled" sounds optional, and the noreply@ case is easy to miss.',
    priority: 'low',
    actions: ['update_existing'],
    suggestedFaq: null
  }
]

const FINDINGS: readonly CoverageFinding[] = [
  {
    id: 'find-1',
    runId: 'run-alerts',
    pageId: ALERTS_PAGE_ID,
    kind: 'factual_claim',
    summary: 'A standard SMS holds 160 GSM characters, not 155',
    detail: 'The page says 155 in Step 3 and again in Best practices.'
  },
  {
    id: 'find-2',
    runId: 'run-alerts',
    pageId: ALERTS_PAGE_ID,
    kind: 'missing_promised_section',
    summary: "The intro promises a section that isn't there",
    detail:
      'It says the page covers "which carrier email-to-text gateways no longer work", but there’s only a note under Step 5 and one FAQ.'
  },
  {
    id: 'find-3',
    runId: 'run-alerts',
    pageId: ALERTS_PAGE_ID,
    kind: 'typo',
    summary: 'A FAQ question ends with "??"',
    detail: '"Why did my carrier email-to-text address stop working??"'
  },
  {
    id: 'find-4',
    runId: 'run-alerts',
    pageId: ALERTS_PAGE_ID,
    kind: 'title_length',
    summary: 'The 101-character title cuts off "(No Developer Required)"',
    detail: 'Google shows about 60 characters, so the strongest differentiator disappears.'
  }
]

const OUTLINE: readonly OutlineEntry[] = [
  {
    level: 'p',
    text: 'Opening scenario: a Friday-afternoon update for a Saturday-morning boiler-inspection crew',
    table: false
  },
  { level: 'box', text: 'At a Glance', table: false },
  { level: 'h2', text: '3 ways to send business text alerts', table: false },
  { level: 'h3', text: 'Method 1: Email-to-SMS gateway', table: false },
  { level: 'h3', text: 'Method 2: SMS dashboard platform', table: false },
  { level: 'h3', text: 'Method 3: Build on the Twilio API', table: false },
  { level: 'h2', text: 'How to set up text alerts in 5 steps', table: false },
  { level: 'h3', text: 'Step 1: Register your business (10DLC)', table: false },
  { level: 'h3', text: 'Step 2: Get a number (local or toll-free)', table: false },
  { level: 'h3', text: 'Step 3: Connect your tools (Datadog, Grafana, any SMTP)', table: false },
  { level: 'h3', text: 'Step 4: Replies come back to email', table: false },
  { level: 'h3', text: 'Step 5: Automate from your existing systems', table: false },
  { level: 'h2', text: 'How to Schedule a Text Alert from Gmail or Outlook', table: false },
  { level: 'h3', text: 'Send to the Whole Team', table: false },
  { level: 'h2', text: 'What About Recurring Alerts?', table: false },
  { level: 'h2', text: 'Who Holds the Clock', table: true },
  { level: 'h2', text: 'Use cases', table: true },
  { level: 'h2', text: 'Comparison', table: true },
  { level: 'h2', text: 'Pricing', table: false },
  { level: 'h2', text: 'Best practices', table: false },
  { level: 'h2', text: 'FAQs', table: false },
  { level: 'cta', text: 'Start sending alerts from your inbox', table: false }
]

const FAQS: readonly PageFaq[] = [
  {
    question: 'Can I set up text alerts without writing any code?',
    answer: 'Yes. The page walks through an email-to-SMS gateway.',
    typo: null
  },
  {
    question: 'Can text alerts be sent directly from Gmail or Outlook?',
    answer: 'Yes. Schedule Send in Gmail or Outlook.',
    typo: null
  },
  {
    question: 'Why did my carrier email-to-text address stop working??',
    answer: 'Carriers have been shutting those gateways down.',
    typo: 'The question ends with "??"'
  },
  {
    question: 'Can monitoring tools send text alerts?',
    answer: 'Yes, if they can email a gateway address.',
    typo: null
  },
  {
    question: 'Do I need 10DLC registration?',
    answer: 'Yes, including alerts to your own staff.',
    typo: null
  },
  {
    question: 'Can people reply to a text alert?',
    answer: 'Replies can come back to the inbox.',
    typo: null
  },
  {
    question: 'Are text alerts the same as SMS marketing?',
    answer: 'No. The page is about operational alerts.',
    typo: null
  },
  {
    question: 'How many characters fit in one text alert?',
    answer: 'The page says 155 characters.',
    typo: null
  },
  { question: 'How much does it cost?', answer: 'The page lists $29 and $49 plans.', typo: null }
]

export function alertsRead(message = 'Page read.'): PageReadResult {
  const h2Count = OUTLINE.filter((entry) => entry.level === 'h2').length
  const h3Count = OUTLINE.filter((entry) => entry.level === 'h3').length
  const tableCount = OUTLINE.filter((entry) => entry.table).length
  return {
    id: ALERTS_SNAPSHOT_ID,
    pageId: ALERTS_PAGE_ID,
    fetchedAt: ALERTS_READ_AT,
    method: 'direct',
    httpStatus: 200,
    durationMs: 800,
    title: ALERTS_TITLE,
    titleLength: ALERTS_TITLE.length,
    metaDescription: ALERTS_META,
    metaDescriptionLength: ALERTS_META.length,
    h1: ALERTS_TITLE,
    titleMatchesH1: true,
    canonical: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
    canonicalMatchesPage: true,
    publishedAt: ALERTS_PUBLISHED_AT,
    modifiedAt: ALERTS_MODIFIED_AT,
    h2Count,
    h3Count,
    tableCount,
    outline: OUTLINE.map((entry) => ({ ...entry })),
    faqs: FAQS.map((faq) => ({ ...faq })),
    wordCount: 2140,
    contentHash: ALERTS_CONTENT_HASH,
    snapshotReused: false,
    flags: [
      {
        code: 'title_long',
        message: 'Too long: "(No Developer Required)" gets cut off',
        preview: TITLE_PREVIEW
      },
      {
        code: 'promise_mismatch',
        message:
          'The title and H1 lead with scheduled alerts from email. The meta description leads with "5 steps" and "without coding". Neither one puts scheduling and the 5-step framing together.',
        preview: null
      }
    ],
    eligibility: { issues: [] },
    summary: {
      promises: [
        {
          title: 'Business text alerts',
          detail:
            'Get urgent updates to staff and customers as SMS instead of emails nobody reads in time.'
        },
        {
          title: 'Scheduled alerts sent from email',
          detail:
            'Write the alert in Gmail, Outlook or any tool that already sends email, and pick when it goes out.'
        },
        {
          title: 'No developer needed',
          detail: 'No API, no code, nothing new for staff to install.'
        }
      ],
      product:
        'an email-to-SMS gateway. Email +1[number]@sendemailtotext.com and it arrives as a text from your verified business number. Plans $29 and $49 a month. Setup about 30 minutes.'
    },
    message,
    nextStep: null
  }
}

export function failedRead(pageId: string): PageReadResult {
  return {
    id: null,
    pageId,
    fetchedAt: ALERTS_READ_AT,
    method: 'direct',
    httpStatus: null,
    durationMs: 1200,
    title: null,
    titleLength: 0,
    metaDescription: null,
    metaDescriptionLength: 0,
    h1: null,
    titleMatchesH1: null,
    canonical: null,
    canonicalMatchesPage: null,
    publishedAt: null,
    modifiedAt: null,
    h2Count: 0,
    h3Count: 0,
    tableCount: 0,
    outline: [],
    faqs: [],
    wordCount: 0,
    contentHash: null,
    snapshotReused: false,
    flags: [],
    eligibility: null,
    summary: null,
    message: 'CiteFox could not read this page. The fetch did not return a document.',
    nextStep: 'Try reading it again, or supply the page as a file.'
  }
}

export function alertsProfile(): BuyerProfile {
  return {
    id: 'icp-alerts',
    pageId: ALERTS_PAGE_ID,
    snapshotId: ALERTS_SNAPSHOT_ID,
    templateId: PROFILE_TEMPLATE_ID,
    templateName: PROFILE_TEMPLATE_NAME,
    templateHash: PROFILE_TEMPLATE_HASH,
    templateUpdatedAt: null,
    createdAt: '2026-10-19T10:08:00.000Z',
    promptsStale: false,
    who: 'Operations managers, office managers, IT leads and owner-operators at US and Canadian businesses with about 10–250 employees. Not developers, and no developer on call. They live in Gmail or Outlook.',
    environment:
      'Systems that already send email: scheduling software, monitoring tools (Datadog, Grafana), help desks, web forms, and equipment that emails alarms.\nThose alerts sit unread in inboxes while their people are away from desks: field techs, weekend crews, branch staff, lone workers, on-call IT.',
    segments: [
      {
        name: 'Field service and facilities',
        reason:
          'Weekend rotations and early crews who are never at a desk when the alert email lands.'
      },
      {
        name: 'IT teams and MSPs',
        reason: 'Downtime and monitoring alerts, without an API project or a paging tool.'
      },
      {
        name: 'Multi-site and regulated operations',
        reason:
          'Bank branches, healthcare offices, schools and churches that must reach every site the same way.'
      },
      {
        name: 'Anyone whose carrier gateway broke',
        reason:
          'txt.att.net, tmomail.net and vtext.com. Verizon’s vtext.com shutdown on March 31, 2027 is a live trigger.'
      }
    ],
    triggers: [
      'A missed alert caused real damage',
      'Their carrier email-to-text address stopped delivering',
      'They hit a 10DLC or registration wall',
      'A developer quote for Twilio came back too expensive or too slow'
    ],
    values: [
      'Setup in about 30 minutes',
      'Nothing new for staff to learn',
      'Replies land back in the inbox',
      'Compliance handled for them',
      'Predictable pricing ($29–$49 a month)'
    ],
    poorFit: [
      {
        name: 'SMS marketers running promo campaigns',
        reason: 'The page is about operational alerts, not marketing sends.'
      },
      {
        name: 'Developers building SMS into a product',
        reason: 'They want an API, not an email gateway.'
      },
      {
        name: 'Teams that need acknowledgment tracking and escalation',
        reason: "That's PagerDuty or Opsgenie territory, and the page itself says so."
      }
    ]
  }
}

export function alertsGaps(): CoverageMatrix {
  const rows: CoverageRecord[] = GAP_SEEDS.map((seed) => ({
    id: seed.id,
    runId: 'run-alerts',
    pageId: ALERTS_PAGE_ID,
    promptId: seed.promptId,
    coverage: seed.coverage,
    whereCovered: [...seed.whereCovered],
    currentContent: seed.currentContent,
    whatToUpdate: seed.whatToUpdate,
    mainGap: seed.mainGap,
    priority: seed.priority,
    actions: seed.actions,
    suggestedFaq: seed.suggestedFaq ? { ...seed.suggestedFaq } : null,
    done: false
  }))
  return {
    runId: 'run-alerts',
    pageId: ALERTS_PAGE_ID,
    recordedAt: '2026-10-19T10:20:00.000Z',
    templateId: GAPS_TEMPLATE_ID,
    templateName: GAPS_TEMPLATE_NAME,
    templateHash: GAPS_TEMPLATE_HASH,
    templateUpdatedAt: '2026-10-19T00:00:00.000Z',
    contentHash: ALERTS_CONTENT_HASH,
    reused: false,
    stale: false,
    rows,
    findings: FINDINGS.map((finding) => ({ ...finding }))
  }
}
