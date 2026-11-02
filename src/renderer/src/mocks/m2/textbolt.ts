import type { TemplateVariable } from '@shared/domain'
import type { AioCitedSource } from '@shared/ipc'

/** Reference page from Docs/textbolt-reference.md. Dev and test output only. */
export const TEXTBOLT_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

export const TEXTBOLT_PROMPTS = [
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

const PROFILE_PARTS = [
  [
    'Who',
    'Operations managers, office managers, IT leads and owner-operators at US and Canadian businesses with about 10–250 employees. No developer on call; they live in Gmail or Outlook.'
  ],
  [
    'Environment',
    'Systems that already send email (scheduling, Datadog or Grafana, help desks, forms, alarm hardware). Recipients are away from their desks.'
  ],
  [
    'Strongest segments',
    'Field service and facilities; IT and MSPs; multi-site or regulated teams (banks, healthcare, schools, churches); teams whose carrier email-to-text gateways broke.'
  ],
  [
    'Trigger events',
    'A missed alert caused real damage. A carrier email-to-text address stopped delivering. They hit a 10DLC registration wall. A developer quote for Twilio came back too high.'
  ],
  [
    'What they value',
    'About 30 minutes to set up, nothing new for staff to install, replies back to the inbox, compliance handled, and a price around $29–$49 a month.'
  ],
  [
    'Poor fit',
    'SMS marketers running promo campaigns, developers building SMS into a product, and teams that need acknowledgment and escalation (PagerDuty or Opsgenie).'
  ]
] as const

export interface CoverageFixture {
  n: number
  prompt: string
  coverage: 'Strong' | 'Partial' | 'Weak' | 'None'
  where: string
  gap: string
  action: string
}

export const COVERAGE_ROWS: readonly CoverageFixture[] = [
  {
    n: 1,
    prompt: TEXTBOLT_PROMPTS[0],
    coverage: 'Partial',
    where: 'Title/H1, intro, At a Glance, no-code FAQ, Method 2, CTA',
    gap: 'No "hiring a developer" framing, and it never says employees need no app',
    action: 'Update FAQ + new FAQ'
  },
  {
    n: 2,
    prompt: TEXTBOLT_PROMPTS[1],
    coverage: 'Strong',
    where: 'Scheduling steps, Whole Team H3, contact group tip, time-zone note',
    gap: 'Outlook steps are vague, and the FAQ lacks scheduling',
    action: 'Update steps + FAQ'
  },
  {
    n: 3,
    prompt: TEXTBOLT_PROMPTS[2],
    coverage: 'Strong',
    where: 'Step 3, Step 5, IT row, monitoring FAQ, PagerDuty note',
    gap: 'No "where to paste the address" example',
    action: 'Small update'
  },
  {
    n: 4,
    prompt: TEXTBOLT_PROMPTS[3],
    coverage: 'Partial',
    where: 'Step 5 note, carrier FAQ, AT&T link',
    gap: 'The FAQ explains why it stopped, not what to switch to',
    action: 'Fix FAQ + new FAQ'
  },
  {
    n: 5,
    prompt: TEXTBOLT_PROMPTS[4],
    coverage: 'Weak',
    where: 'One clause in the carrier FAQ',
    gap: 'No dedicated answer despite the March 2027 deadline',
    action: 'New FAQ'
  },
  {
    n: 6,
    prompt: TEXTBOLT_PROMPTS[5],
    coverage: 'Partial',
    where: 'Step 5, recurring alerts, customer row',
    gap: 'Does not say how customer reminders get addressed to phones',
    action: 'Update section + new FAQ'
  },
  {
    n: 7,
    prompt: TEXTBOLT_PROMPTS[6],
    coverage: 'Strong',
    where: 'At a Glance, Step 1, 10DLC FAQ, opt-in',
    gap: 'Not "yes, even internal"; toll-free versus 10DLC is unclear',
    action: 'Update FAQ'
  },
  {
    n: 8,
    prompt: TEXTBOLT_PROMPTS[7],
    coverage: 'Partial',
    where: 'Method 3, comparison table, pricing, API link',
    gap: 'No head-to-head, and "alternative to Twilio" is never phrased',
    action: 'Comparison + new FAQ'
  },
  {
    n: 9,
    prompt: TEXTBOLT_PROMPTS[8],
    coverage: 'Strong',
    where: 'Opening scenario, steps, time-zone note, Who Holds the Clock',
    gap: 'Only in the intro, with no matching heading or FAQ',
    action: 'Optional FAQ'
  },
  {
    n: 10,
    prompt: TEXTBOLT_PROMPTS[9],
    coverage: 'Strong',
    where: 'At a Glance, Step 4, replies FAQ, benefits, stage table',
    gap: '"If two-way enabled" sounds optional, and the noreply@ case is thin',
    action: 'Update FAQ + Step 4'
  }
]

export const COVERAGE_FINDINGS = [
  'The page says a standard SMS holds 155 GSM characters. The standard is 160.',
  'The intro promises a carrier-gateway section that is not on the page.',
  'One FAQ ends in "??".'
] as const

export interface PageFacts {
  url: string
  title: string
  meta_description: string
  h1: string
  page_text: string
  brand_name: string
}

const TEXTBOLT_FACTS: PageFacts = {
  url: TEXTBOLT_URL,
  title:
    'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)',
  meta_description:
    'Learn how to set up business text alerts in 5 steps without coding. Turn emails from your existing tools into SMS notifications with TextBolt.',
  h1: 'How to Set Up Text Alerts for Business, Including Scheduled Alerts From Email (No Developer Required)',
  page_text:
    'Set up business text alerts from email without a developer. Schedule a message to the whole team from Gmail or Outlook. Turn monitoring email from Datadog or Grafana into texts. Carrier email-to-text addresses such as txt.att.net, tmomail.net and vtext.com are shutting down, including Verizon in March 2027. 10DLC registration, replies back to the inbox, and a price around $29–$49 a month. The page also claims a standard SMS holds 155 GSM characters, promises a carrier-gateway section, and one FAQ ends in "??".',
  brand_name: 'TextBolt'
}

export function isTextboltUrl(url: string): boolean {
  const trimmed = url.trim().replace(/\/+$/, '')
  return trimmed.toLowerCase() === TEXTBOLT_URL.replace(/\/+$/, '').toLowerCase()
}

export function pageFacts(url: string, brandName: string | null): PageFacts {
  if (isTextboltUrl(url)) {
    return {
      ...TEXTBOLT_FACTS,
      url: url.trim(),
      brand_name: brandName ?? TEXTBOLT_FACTS.brand_name
    }
  }
  const trimmed = url.trim()
  let host: string
  try {
    host = new URL(trimmed).hostname
  } catch {
    host = trimmed
  }
  const title = host.length > 0 ? `Page on ${host}` : 'Untitled page'
  return {
    url: trimmed,
    title,
    meta_description: `A page at ${host || 'this address'}.`,
    h1: title,
    page_text: `CiteFox read ${trimmed}. This playground sample is not the TextBolt reference page.`,
    brand_name: brandName ?? (host.split('.')[0] || 'Brand')
  }
}

export function templateValues(
  facts: PageFacts,
  promptCount: number
): Record<TemplateVariable, string> {
  return {
    url: facts.url,
    title: facts.title,
    meta_description: facts.meta_description,
    h1: facts.h1,
    page_text: facts.page_text,
    brand_name: facts.brand_name,
    prompt_count: String(promptCount),
    outline: 'No H2 or H3 headings on the page.',
    faqs: 'No FAQs on the page.',
    last_modified: 'Not stated on the page.',
    competitors: '',
    market: '',
    market_language: '',
    buyer_values: '',
    prompt: '',
    aio_text: '',
    aio_references: '',
    brand_facts: '',
    own_pages: '',
    prompt_text: '',
    overview_text: '',
    business_block: '',
    product_block: '',
    market_block: '',
    buyer_block: '',
    competitor_block: '',
    stage_rules: '',
    mode_rules: '',
    evidence: ''
  }
}

function wordingSentence(templateName: string): string {
  return templateName.length > 0 ? ` Wording from ${templateName}.` : ''
}

export function profileOutput(facts: PageFacts, templateName = ''): string {
  const wording = wordingSentence(templateName)
  return PROFILE_PARTS.map(([heading, body], index) => {
    const named = index === 0 ? `${body}${wording}` : body
    if (facts.brand_name === 'TextBolt') return `${heading}\n${named}`
    return `${heading}\n${named} Page read: ${facts.title}.`
  }).join('\n\n')
}

export function promptOutput(count: number, templateName = ''): string {
  const wording = wordingSentence(templateName)
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) {
    const known = TEXTBOLT_PROMPTS[index]
    const text = known ?? `What should a buyer ask about this page in situation ${index + 1}?`
    lines.push(`${index + 1}. ${text}${index === count - 1 ? wording : ''}`)
  }
  return lines.join('\n')
}

export function coverageOutput(facts: PageFacts, templateName = ''): string {
  const source = isTextboltUrl(facts.url)
    ? COVERAGE_ROWS
    : [
        {
          n: 1,
          prompt: `What does ${facts.title} already answer?`,
          coverage: 'Weak' as const,
          where: 'Title',
          gap: 'The playground sample has no full page text for this URL',
          action: 'Update section'
        }
      ]
  const wording = wordingSentence(templateName)
  const rows = source.map((row, index) =>
    index === 0 ? { ...row, gap: `${row.gap}${wording}` } : row
  )
  const counts = { Strong: 0, Partial: 0, Weak: 0, None: 0 }
  for (const row of rows) counts[row.coverage] += 1
  const findings = isTextboltUrl(facts.url)
    ? COVERAGE_FINDINGS
    : [`${facts.title} was read. No TextBolt findings apply to this URL.`]
  return [
    'Coverage matrix',
    `Strong ${counts.Strong} · Partial ${counts.Partial} · Weak ${counts.Weak} · None ${counts.None}`,
    '',
    '#\tPrompt\tCoverage\tWhere covered now\tMain gap\tAction',
    ...rows.map((row) =>
      [row.n, row.prompt, row.coverage, row.where, row.gap, row.action].join('\t')
    ),
    '',
    'Page-wide findings',
    `${findings.length} findings`,
    ...findings.map((finding) => `- ${finding}`)
  ].join('\n')
}

export interface AioFixture {
  summary: string
  cited: boolean
  position: number | null
  sources: readonly AioCitedSource[]
}

const PROMPT_ONE_SOURCES: readonly AioCitedSource[] = [
  {
    position: 1,
    domain: 'simpletexting.com',
    url: 'https://simpletexting.com/blog/text-employees/'
  },
  {
    position: 2,
    domain: 'textbolt.com',
    url: TEXTBOLT_URL
  },
  {
    position: 3,
    domain: 'twilio.com',
    url: 'https://www.twilio.com/en-us/blog/employee-sms-notifications'
  },
  {
    position: 4,
    domain: 'clicksend.com',
    url: 'https://www.clicksend.com/us/email-to-sms/'
  },
  {
    position: 5,
    domain: 'officeops-journal.com',
    url: 'https://officeops-journal.com/reach-deskless-staff/'
  },
  {
    position: 6,
    domain: 'textmagic.com',
    url: 'https://www.textmagic.com/email-to-sms/'
  }
]

export function aioForPrompt(prompt: string, pageUrl: string): AioFixture {
  if (prompt === TEXTBOLT_PROMPTS[0] && isTextboltUrl(pageUrl)) {
    return {
      cited: true,
      position: 2,
      summary:
        "You can text employees without a developer, and without asking them to install anything, by turning email from tools you already use into SMS. Messages arrive in each person's normal texting app.",
      sources: PROMPT_ONE_SOURCES
    }
  }
  if (prompt.includes('Verizon') || prompt.includes('vtext.com')) {
    return {
      cited: false,
      position: null,
      summary:
        'Verizon is winding down email delivery to vtext.com addresses. Businesses are told to move automated alerts to a registered SMS provider before the cutoff.',
      sources: [
        {
          position: 1,
          domain: 'verizon.com',
          url: 'https://www.verizon.com/support/email-to-text/'
        },
        {
          position: 2,
          domain: 'clicksend.com',
          url: 'https://www.clicksend.com/us/email-to-sms/'
        }
      ]
    }
  }
  const cited = isTextboltUrl(pageUrl)
  return {
    cited,
    position: cited ? 1 : null,
    summary: cited
      ? `Google's overview answers "${prompt}" and lists this page among the sources.`
      : `Google's overview answers "${prompt}" without citing ${pageUrl}.`,
    sources: cited
      ? [{ position: 1, domain: 'textbolt.com', url: pageUrl }]
      : [
          {
            position: 1,
            domain: 'example.com',
            url: 'https://example.com/alerts'
          }
        ]
  }
}

/** Display name of the mock SerpApi key. Never a secret. */
export const PLAYGROUND_KEY_LABEL = 'Work SerpApi'
export const PLAYGROUND_KEY_ID = 'serpapi-work'
