/**
 * Hand-written TextBolt fixtures for the M2 engine.
 * The buyer profile, the ten prompts, and the coverage labels follow
 * Docs/textbolt-reference.md. They are not a live Claude response.
 * The page body is the keyless Jina recording in fixtures/textbolt-jina.json.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BuyerProfileBody } from '@shared/domain'
import type { AuditDraftFinding, FixDraftRow, MatrixDraftRow } from './coverage-validate'
import type { CoverageDraftRow, PromptDraft } from './validate'

export const TEXTBOLT_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** Document title from the keyless Reader response. It is not the long H1. */
export const TEXTBOLT_TITLE = 'How to Set Up Text Alerts for Business (2026) | TextBolt'
export const TEXTBOLT_H1 =
  'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)'
export const TEXTBOLT_META =
  'Learn how to set up business text alerts in 5 steps without coding. Turn emails from your existing tools into SMS notifications with TextBolt.'
export const TEXTBOLT_PUBLISHED_UTC = new Date('2026-07-28T06:22:29-05:00').toISOString()

const SOURCES = [
  'title_meta_h1',
  'title_meta_h1',
  'trigger_event',
  'trigger_event',
  'trigger_event',
  'title_meta_h1',
  'objection',
  'trigger_event',
  'objection',
  'objection'
] as const
const STAGES = [
  'problem',
  'solution',
  'problem',
  'trigger',
  'trigger',
  'solution',
  'objection',
  'comparison',
  'problem',
  'objection'
] as const
const LABELS = [
  'Alerts to employees, no developer, no new app',
  'Schedule a text to the whole team from Gmail or Outlook',
  'Monitoring tool email alerts to texts',
  'Carrier email-to-text stopped, what to use instead',
  'Carrier shutdown, what a small business switches to',
  'Scheduling software emails to SMS reminders',
  'Registration for alerts to your own employees',
  'Cheap alternative to a developer SMS API',
  'Text field techs Saturday morning, written Friday',
  'Employees reply, and the reply comes back to email'
] as const
const MAPS = [
  'H1 and the no-code FAQ',
  'H2 How to Schedule a Text Alert From Gmail or Outlook',
  'H3 Connect Your Existing Business Systems',
  'FAQ about txt.att.net',
  'Note that names vtext.com',
  'H3 What About Recurring Alerts',
  'FAQ about 10DLC registration',
  'H3 SMS API or Workflow Automation Tool',
  'H2 Who Holds the Clock',
  'FAQ about where replies go'
] as const

const EN = [
  'How can I send text alerts to my employees without hiring a developer or learning a new app?',
  'Is there a way to schedule a text message to my whole team from Gmail or Outlook?',
  'Our monitoring tool only sends email alerts. How do I get those as text messages on my phone?',
  "My email-to-text through txt.att.net stopped working. What's the best replacement for business alerts?",
  'Verizon is shutting down vtext.com. What should a small business switch to so our automated alerts keep reaching phones?',
  "What's the easiest way to turn emails from our scheduling software into SMS reminders for customers and staff?",
  'Do I need 10DLC registration to send text alerts to my own employees, and is there a service that handles it for me?',
  "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?",
  "How do I send a text to my field techs early Saturday morning when I'm writing the update Friday afternoon?",
  'Can employees reply to an automated business text alert and have the reply come back to my email?'
] as const

const ES = [
  '¿Cómo puedo enviar alertas de texto a mis empleados sin contratar a un desarrollador ni aprender otra aplicación?',
  '¿Hay una forma de programar un mensaje de texto para todo el equipo desde Gmail u Outlook?',
  'Nuestra herramienta de monitoreo solo envía alertas por correo. ¿Cómo las recibo como mensajes de texto en el teléfono?',
  'El correo que mandábamos a los teléfonos del operador dejó de entregarse. ¿Qué uso ahora para las alertas del negocio?',
  'Nuestro operador ya no entrega los correos enviados a números de celular. ¿A qué cambiamos para que las alertas automáticas sigan llegando?',
  '¿Cuál es la forma más fácil de convertir los correos del software de citas en recordatorios por SMS para el personal?',
  '¿Necesito un registro especial para mandar alertas por SMS a mis propios empleados, y hay un servicio que lo haga por mí?',
  '¿Qué alternativa económica a Twilio hay para mandar alertas de texto si no tenemos programadores en el equipo?',
  '¿Cómo le mando un texto a mis técnicos de campo el sábado temprano si escribo el aviso el viernes por la tarde?',
  '¿Pueden los empleados responder una alerta automática y hacer que la respuesta llegue a mi correo?'
] as const

export const TEXTBOLT_PROFILE: BuyerProfileBody = {
  who: 'Operations managers, office managers, IT leads, and owner-operators at US and Canadian businesses with about 10 to 250 employees. They are not developers, and they live in Gmail or Outlook.',
  environment:
    'Systems that already send email: scheduling software, monitoring tools such as Datadog or Grafana, help desks, web forms, and equipment that emails alarms. Recipients are away from their desks when those emails arrive.',
  segments: [
    {
      name: 'Field service and facilities',
      reason: 'Weekend rotations and early crews who are not at a desk when the alert email lands.'
    },
    {
      name: 'IT teams and MSPs',
      reason: 'Downtime and monitoring alerts, without an API project or a paging tool.'
    },
    {
      name: 'Multi-site and regulated operations',
      reason:
        'Bank branches, healthcare offices, schools, and churches that must reach every site the same way.'
    },
    {
      name: 'Broken carrier gateways',
      reason: 'txt.att.net, tmomail.net, and vtext.com, including a Verizon shutdown in March 2027.'
    }
  ],
  triggers: [
    'A missed alert caused real damage over a weekend.',
    'Their carrier email-to-text address stopped delivering.',
    'They hit a 10DLC or registration wall.',
    'A developer quote for an SMS API came back too expensive or too slow.'
  ],
  values: [
    'Setup in about 30 minutes',
    'Nothing new for staff to learn',
    'Replies land back in the inbox',
    'Compliance handled for them',
    'Predictable pricing at $29 to $49 a month'
  ],
  poorFit: [
    {
      name: 'SMS marketers',
      reason: 'The page is about operational alerts, not promotional campaigns.'
    },
    {
      name: 'Developers building SMS into a product',
      reason: 'They want an API, not an email gateway.'
    },
    {
      name: 'Teams that need acknowledgment and escalation',
      reason: 'That work stays in a paging tool such as PagerDuty or Opsgenie.'
    }
  ]
}

function promptRows(texts: readonly string[]): PromptDraft[] {
  return texts.map((text, index) => ({
    text,
    label: LABELS[index] ?? '',
    source: SOURCES[index] ?? 'detail_check',
    intentStage: STAGES[index] ?? 'problem',
    mappedElement: MAPS[index] ?? ''
  }))
}

export const TEXTBOLT_PROMPTS_EN: { prompts: PromptDraft[] } = { prompts: promptRows(EN) }
export const TEXTBOLT_PROMPTS_ES: { prompts: PromptDraft[] } = { prompts: promptRows(ES) }

const FAQ = {
  employees:
    'Employees can receive text alerts without hiring a developer and without learning a new app. Send the notice as an email from Gmail, Outlook, or any system that already sends mail, and a gateway turns that email into a normal text message. Staff keep working in the inbox they already use, and setup stays inside tools the office already knows.',
  carrier:
    'Replace each old carrier address with a registered email to SMS gateway address. The same address works across carriers, so the tools that used to email txt.att.net keep sending the same kind of alert. Send one test to a phone and confirm it arrives before you retire the old address for the whole team.',
  verizon:
    'List every system that still emails a carrier gateway address, including alarms, scheduling tools, and monitoring. Replace each address with a registered gateway address before the carrier stops handing those messages to phones. Then send a test alert to a phone on that carrier and confirm it arrives.',
  scheduling:
    'If the scheduling tool can send email, it can send a text. Add each staff gateway address as a recipient for internal reminders. For customer reminders, the tool must allow a recipient address built from the phone number. Send a test before the reminder goes live.',
  twilio:
    'An email to SMS gateway covers the same alert job when the message already leaves as email. A developer API needs setup, testing, and upkeep that a small team may not have. A gateway takes about half an hour, runs on a flat monthly plan, and keeps registration work off the operator.',
  saturday:
    'Write the alert as an email on Friday, address it to each person gateway, and use Gmail or Outlook schedule send for early Saturday. Schedule send uses the sender time zone, so adjust it when the crew is elsewhere. Send from an inbox that someone checks, so a reply such as running late is seen.'
} as const

function faq(question: string, answer: string): { question: string; answer: string } {
  return { question, answer }
}

export const TEXTBOLT_COVERAGE: { rows: CoverageDraftRow[]; findings: CoverageFindingDraft[] } = {
  rows: [
    row(
      1,
      'partial',
      'medium',
      ['update_existing', 'new_faq'],
      [TEXTBOLT_H1],
      faq('How can employees get text alerts without a developer or a new app?', FAQ.employees),
      'The H1 promises no developer, but it never says employees need no new app.'
    ),
    row(
      2,
      'strong',
      'medium',
      ['update_existing'],
      [
        'How to Schedule a Text Alert From Gmail or Outlook',
        'How Do You Send One Scheduled Alert to the Whole Team?'
      ],
      null,
      'Scheduling steps are present. Outlook is less specific than Gmail.'
    ),
    row(
      3,
      'strong',
      'medium',
      ['small_update'],
      [
        '5. Connect Your Existing Business Systems',
        'Can text alerts be triggered automatically from monitoring tools or web forms?'
      ],
      null,
      'Monitoring is covered, without an example of where to paste the address.'
    ),
    row(
      4,
      'partial',
      'medium',
      ['update_existing', 'new_faq'],
      ['Why did free carrier email-to-SMS gateways like txt.att.net stop working??'],
      faq('What should replace txt.att.net for business alerts?', FAQ.carrier),
      'The FAQ explains why the gateway stopped, not how to switch.'
    ),
    row(
      5,
      'weak',
      'high',
      ['new_faq'],
      ['@vtext.com'],
      faq('What should a small business use when a carrier email gateway shuts down?', FAQ.verizon),
      'vtext.com appears in one note and has no dedicated answer.'
    ),
    row(
      6,
      'partial',
      'medium',
      ['update_existing', 'new_faq'],
      ['What About Recurring Alerts?', '5. Connect Your Existing Business Systems'],
      faq('How do scheduling-software emails become SMS reminders?', FAQ.scheduling),
      'Recurring alerts are covered, but customer reminders are not addressed to phones.'
    ),
    row(
      7,
      'strong',
      'medium',
      ['update_existing'],
      ['Does sending business text alerts require 10DLC registration?'],
      null,
      'Registration is covered, but internal alerts are not answered as a yes.'
    ),
    row(
      8,
      'partial',
      'medium',
      ['update_existing', 'new_faq'],
      [
        '3. SMS API or Workflow Automation Tool',
        'How Much Does It Cost to Set Up Business Text Alerts?'
      ],
      faq('What is a low-cost path when a team has no developers?', FAQ.twilio),
      'The API section and pricing are present, without a direct comparison.'
    ),
    row(
      9,
      'strong',
      'low',
      ['optional_faq'],
      ['Who Holds the Clock: What Happens Between Schedule Send and the Text'],
      faq('How do I send a Saturday text that I write on Friday?', FAQ.saturday),
      'The Friday-to-Saturday case is in the clock section and has no matching FAQ.'
    ),
    row(
      10,
      'strong',
      'medium',
      ['update_existing'],
      ['Where do replies to a text alert go once someone responds?'],
      null,
      'Replies are covered. The page can say more clearly that they return to email.'
    )
  ],
  findings: [
    {
      kind: 'factual_claim',
      summary: 'GSM length is stated as 155',
      detail:
        'The page says "155 characters when using standard GSM characters" and a standard SMS segment is 160.'
    },
    {
      kind: 'typo',
      summary: 'An FAQ question ends with two question marks',
      detail: 'The carrier FAQ heading ends with "stop working??" instead of one question mark.'
    },
    {
      kind: 'missing_promised_section',
      summary: 'Carrier replacement steps are thin',
      detail:
        'The page names @vtext.com and txt.att.net, but it does not walk through how a team replaces those addresses.'
    }
  ]
}

export interface CoverageFindingDraft {
  kind:
    | 'factual_claim'
    | 'missing_promised_section'
    | 'typo'
    | 'title_length'
    | 'title_meta_mismatch'
    | 'other'
  summary: string
  detail: string
}

/** Keyless Reader body recorded for the reference URL. Headers were not saved. */
export function textboltJinaBody(): string {
  return readFileSync(
    fileURLToPath(new URL('./fixtures/textbolt-jina.json', import.meta.url)),
    'utf8'
  )
}

function row(
  position: number,
  coverage: CoverageDraftRow['coverage'],
  priority: CoverageDraftRow['priority'],
  actions: CoverageDraftRow['actions'],
  whereCovered: string[],
  suggestedFaq: { question: string; answer: string } | null,
  mainGap: string
): CoverageDraftRow {
  return {
    position,
    coverage,
    whereCovered,
    currentContent: whereCovered.join('; '),
    whatToUpdate: mainGap,
    mainGap,
    priority,
    actions,
    suggestedFaq
  }
}

/**
 * The recorded TextBolt page audit (P1 `page_audit`). Every quote is on the
 * recorded page.
 */
export const TEXTBOLT_AUDIT: { findings: AuditDraftFinding[] } = {
  findings: [
    {
      type: 'factual_claim',
      text: 'The page gives the single-SMS length for GSM characters as 155; a standard segment holds 160.',
      quote: '155 characters when using standard GSM characters',
      correction: 'A single SMS segment holds 160 standard GSM characters.',
      verify: 'Re-check the GSM 03.38 single-segment length before publishing.'
    },
    {
      type: 'typo',
      text: 'An FAQ question ends with two question marks.',
      quote: 'stop working??',
      correction: 'stop working?',
      verify: null
    },
    {
      type: 'missing_promised_section',
      text: 'The intro promises a list of carrier gateways that no longer work, but the page gives no such list.',
      quote: 'which carrier email-to-text gateways no longer work',
      correction: null,
      verify: null
    }
  ]
}

/** `coverage_matrix` rows from {@link TEXTBOLT_COVERAGE}: the rating only. */
export function textboltMatrixRow(position: number): MatrixDraftRow {
  const row = recordedRow(position)
  const strong = row.coverage === 'strong'
  const actions = strong
    ? row.actions.filter((action) => action !== 'new_faq' && action !== 'optional_faq')
    : row.actions
  return {
    position,
    coverage: row.coverage as MatrixDraftRow['coverage'],
    whereCovered: row.coverage === 'none' ? [] : row.whereCovered,
    mainGap: row.mainGap,
    priority: row.priority as MatrixDraftRow['priority'],
    actions: actions.length > 0 ? actions : ['none']
  }
}

/** `coverage_fixes` rows from {@link TEXTBOLT_COVERAGE}. */
export function textboltFixRow(position: number): FixDraftRow {
  const row = recordedRow(position)
  const faq =
    row.suggestedFaq ??
    TEXTBOLT_COVERAGE.rows.find((item) => item.suggestedFaq !== null)?.suggestedFaq
  if (faq === undefined || faq === null) throw new Error('The recorded matrix has no FAQ draft.')
  return {
    position,
    currentContent: row.currentContent,
    whatToUpdate: row.whatToUpdate,
    suggestedFaq: faq
  }
}

/**
 * A fake Claude reply for the split content-gap steps, routed on the prompt's
 * `Template:` first line, with one row per numbered prompt the call lists. Null
 * for every other prompt. Tests and the e2e stand-in answer the same way.
 */
export function textboltGapReply(prompt: string): unknown | null {
  const kind = /^Template: ([a-z_]+)\.md/u.exec(prompt)?.[1]
  const positions = [...prompt.matchAll(/^(\d+)\. \[[a-z0-9_]+ · [a-z0-9_]+\] /gmu)].map((match) =>
    Number(match[1])
  )
  if (kind === 'coverage_matrix') return { rows: positions.map(textboltMatrixRow) }
  if (kind === 'coverage_fixes') return { rows: positions.map(textboltFixRow) }
  if (kind === 'page_audit') return TEXTBOLT_AUDIT
  return null
}

function recordedRow(position: number): CoverageDraftRow {
  const rows = TEXTBOLT_COVERAGE.rows
  const row = rows.find((item) => item.position === position) ?? rows[(position - 1) % rows.length]
  if (row === undefined) throw new Error('The recorded matrix is empty.')
  return row
}
