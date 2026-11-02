import { describe, expect, test } from 'vitest'
import { QUESTIONS_KIND } from './kinds/questions'
import { readReply, rejoinCells } from './reader'
import type { HelpFillSection } from './types'

const QUESTIONS = QUESTIONS_KIND.sections

function questions(text: string): string[] {
  return readReply(text, QUESTIONS).rows.map((row) => row.values.question ?? '')
}

describe('readReply: single section (questions)', () => {
  test('ChatGPT: chatter, then a fenced CSV, then an offer', () => {
    const reply = `Sure! Here are 3 new questions for TextBolt's buyers:

\`\`\`csv
question,stage,page
"AT&T email to text not working anymore, alternatives?",Problem,/email-to-text/
How to get Nagios alerts by SMS without a carrier gateway,Options,/email-to-text/
"Textmagic vs a hosted email-to-SMS service, which is cheaper?",Compare,/pricing/
\`\`\`

Let me know if you want 15 more, or a version for Canada!`
    const read = readReply(reply, QUESTIONS)
    expect(read.warnings).toEqual([])
    expect(read.rows).toEqual([
      {
        section: null,
        values: {
          question: 'AT&T email to text not working anymore, alternatives?',
          stage: 'Problem',
          page: '/email-to-text/'
        }
      },
      {
        section: null,
        values: {
          question: 'How to get Nagios alerts by SMS without a carrier gateway',
          stage: 'Options',
          page: '/email-to-text/'
        }
      },
      {
        section: null,
        values: {
          question: 'Textmagic vs a hosted email-to-SMS service, which is cheaper?',
          stage: 'Compare',
          page: '/pricing/'
        }
      }
    ])
  })

  test('Perplexity: a markdown table with citation marks, then a sources list', () => {
    const reply = `Based on current carrier changes, here are questions buyers search for[1][2]:

| **Question** | **Stage** | **Page** |
|---|:---:|---|
| Verizon vtext.com shut down, how do I keep getting server alerts?[1] | Problem | \`/email-to-text/\` |
| Best email to SMS gateway for IT alerts after carriers stopped it [2][3] | Options | /email-to-text/ |
| Is a paid email-to-text service HIPAA compliant? | Doubts | /pricing/ |

**Sources**
1. https://www.verizon.com/support/vtext
2. https://example.com/carrier-gateways
3. https://example.com/sms-alerts`
    const read = readReply(reply, QUESTIONS)
    expect(read.rows.map((row) => row.values)).toEqual([
      {
        question: 'Verizon vtext.com shut down, how do I keep getting server alerts?',
        stage: 'Problem',
        page: '/email-to-text/'
      },
      {
        question: 'Best email to SMS gateway for IT alerts after carriers stopped it',
        stage: 'Options',
        page: '/email-to-text/'
      },
      {
        question: 'Is a paid email-to-text service HIPAA compliant?',
        stage: 'Doubts',
        page: '/pricing/'
      }
    ])
  })

  test('Claude: a prose intro, a markdown table, a closing note', () => {
    const reply = `I've written these as real searches, each with a situation and a need. None of them name TextBolt.

| question | stage | page |
| --- | --- | --- |
| Our clinic's Outlook reminders stopped reaching patients by text. What can replace the carrier gateway? | Problem | /email-to-text/ |
| Do I need 10DLC registration to text my own staff from email? | Doubts | |

A note on stages: I leaned towards Problem and Doubts because your tracked list is heavy on Compare.`
    expect(readReply(reply, QUESTIONS).rows.map((row) => row.values)).toEqual([
      {
        question:
          "Our clinic's Outlook reminders stopped reaching patients by text. What can replace the carrier gateway?",
        stage: 'Problem',
        page: '/email-to-text/'
      },
      { question: 'Do I need 10DLC registration to text my own staff from email?', stage: 'Doubts' }
    ])
  })

  test('TSV pasted from Google Sheets', () => {
    const reply =
      'Query\tFunnel stage\tLanding page\nemail to sms for alarms\tproblem\t/alerts/\nsms gateway pricing small team\tdecide\t/pricing/\n'
    expect(readReply(reply, QUESTIONS).rows.map((row) => row.values)).toEqual([
      { question: 'email to sms for alarms', stage: 'problem', page: '/alerts/' },
      { question: 'sms gateway pricing small team', stage: 'decide', page: '/pricing/' }
    ])
  })

  test('semicolon CSV from European Excel', () => {
    const reply = 'question;stage;page\nWie bekomme ich Alarme per SMS?;Problem;/de/alarme/\n'
    expect(questions(reply)).toEqual(['Wie bekomme ich Alarme per SMS?'])
  })

  test('a plain numbered list with chatter around it', () => {
    const reply = `Here are some questions:

1. What replaced the AT&T email to text gateway?
2. How do I send SMS alerts from Zabbix without coding?
3) Can I text my whole crew from Gmail?

Hope this helps!`
    expect(questions(reply)).toEqual([
      'What replaced the AT&T email to text gateway?',
      'How do I send SMS alerts from Zabbix without coding?',
      'Can I text my whole crew from Gmail?'
    ])
  })

  test('bullets with bold stage labels become the stage', () => {
    const reply = `- **Problem:** Why did my carrier stop delivering email-to-text messages?
- **Compare** — Twilio or a hosted email-to-SMS service for a small office?
* How much does an email to SMS service cost per month? (Decide)`
    const rows = readReply(reply, QUESTIONS).rows.map((row) => row.values)
    expect(rows.map((row) => row.question)).toEqual([
      'Problem: Why did my carrier stop delivering email-to-text messages?',
      'Compare — Twilio or a hosted email-to-SMS service for a small office?',
      'How much does an email to SMS service cost per month? (Decide)'
    ])
    // The stage words are split off by the questions kind's clean step.
    expect(rows.map((row) => QUESTIONS_KIND.clean?.(row, CONTEXT, QUESTIONS[0]!))).toEqual([
      {
        question: 'Why did my carrier stop delivering email-to-text messages?',
        stage: 'problem',
        page: ''
      },
      {
        question: 'Twilio or a hosted email-to-SMS service for a small office?',
        stage: 'compare',
        page: ''
      },
      {
        question: 'How much does an email to SMS service cost per month?',
        stage: 'decide',
        page: ''
      }
    ])
  })

  test('bare lines with commas inside stay one question each', () => {
    const reply =
      'If my carrier gateway is gone, how do alerts reach me?\nWhich service texts a team, not one person?\nWhat is the cheapest way to send SMS from email'
    expect(questions(reply)).toEqual([
      'If my carrier gateway is gone, how do alerts reach me?',
      'Which service texts a team, not one person?',
      'What is the cheapest way to send SMS from email'
    ])
  })

  test('quoted commas, doubled quotes, CRLF line ends and a BOM', () => {
    const reply =
      '﻿question,stage,page\r\n"Is it ""free"" to send email to text, really?",Doubts,/pricing/\r\n"Best gateway, 2026",Options,\r\n'
    expect(readReply(reply, QUESTIONS).rows.map((row) => row.values)).toEqual([
      {
        question: 'Is it "free" to send email to text, really?',
        stage: 'Doubts',
        page: '/pricing/'
      },
      { question: 'Best gateway, 2026', stage: 'Options' }
    ])
  })

  test('a headerless CSV is matched by its values', () => {
    const reply =
      'how do I text alerts from email,problem,/alerts/\nwhat does an sms gateway cost,decide,/pricing/'
    expect(readReply(reply, QUESTIONS).rows.map((row) => row.values)).toEqual([
      { question: 'how do I text alerts from email', stage: 'problem', page: '/alerts/' },
      { question: 'what does an sms gateway cost', stage: 'decide', page: '/pricing/' }
    ])
  })

  test('one column under a "question" header', () => {
    expect(questions('question\nWhat replaced vtext?\nIs email to SMS reliable?')).toEqual([
      'What replaced vtext?',
      'Is email to SMS reliable?'
    ])
  })

  test('an answer with no table or list says so', () => {
    const read = readReply('Sorry, I can’t help with that.', QUESTIONS)
    expect(read.rows).toEqual([])
    expect(read.warnings).toEqual([expect.stringContaining('No table or list was found')])
    expect(readReply('', QUESTIONS).warnings).toHaveLength(1)
  })
})

const PROJECT: readonly HelpFillSection[] = [
  { id: 'products', title: 'PRODUCTS', columns: ['name', 'url', 'one_line'], entity: 'products' },
  { id: 'buyers', title: 'BUYERS', columns: ['who', 'problem', 'trigger'], entity: null },
  {
    id: 'competitors',
    title: 'COMPETITORS',
    columns: ['name', 'domain', 'competes_with'],
    entity: 'competitors'
  },
  { id: 'markets', title: 'MARKETS', columns: ['country', 'language'], entity: 'markets' },
  {
    id: 'questions',
    title: 'QUESTIONS',
    columns: ['question', 'stage', 'product'],
    entity: 'questions'
  }
]

describe('readReply: multi-section (New project)', () => {
  test('five ### sections, chatter between them, one in a fence', () => {
    const reply = `Great, I visited textbolt.com. Here is the setup:

### PRODUCTS
name,url,one_line
Email to SMS,/email-to-sms/,Send texts from any email app
Text alerts,/text-alerts/,Alert a team by text

### BUYERS
who,problem,trigger
IT and ops teams,carrier email-to-text stopped,Verizon shut down vtext.com

**COMPETITORS**
\`\`\`
name,domain,competes_with
Twilio,twilio.com,Email to SMS
SimpleTexting,simpletexting.com,Text alerts
\`\`\`

## Markets
| country | language |
|---|---|
| US | en |
| CA | en |

### QUESTIONS
question,stage,product
What replaced AT&T email to text?,Problem,Email to SMS

Let me know if you'd like more questions per product.`
    const read = readReply(reply, PROJECT)
    expect(read.warnings).toEqual([])
    const by = (id: string): Record<string, string>[] =>
      read.rows.filter((row) => row.section === id).map((row) => ({ ...row.values }))
    expect(by('products')).toEqual([
      { name: 'Email to SMS', url: '/email-to-sms/', one_line: 'Send texts from any email app' },
      { name: 'Text alerts', url: '/text-alerts/', one_line: 'Alert a team by text' }
    ])
    expect(by('buyers')).toEqual([
      {
        who: 'IT and ops teams',
        problem: 'carrier email-to-text stopped',
        trigger: 'Verizon shut down vtext.com'
      }
    ])
    expect(by('competitors')).toEqual([
      { name: 'Twilio', domain: 'twilio.com', competes_with: 'Email to SMS' },
      { name: 'SimpleTexting', domain: 'simpletexting.com', competes_with: 'Text alerts' }
    ])
    expect(by('markets')).toEqual([
      { country: 'US', language: 'en' },
      { country: 'CA', language: 'en' }
    ])
    expect(by('questions')).toEqual([
      { question: 'What replaced AT&T email to text?', stage: 'Problem', product: 'Email to SMS' }
    ])
  })

  test('a missing section is a warning, the others still read', () => {
    const read = readReply('### MARKETS\ncountry,language\nUS,en\n', PROJECT)
    expect(read.rows).toEqual([{ section: 'markets', values: { country: 'US', language: 'en' } }])
    expect(read.warnings).toContain('No PRODUCTS section was found in the answer.')
    expect(read.warnings).not.toContain('No MARKETS section was found in the answer.')
  })

  test('a CSV header holding a section word stays the header, not a heading', () => {
    const sections: readonly HelpFillSection[] = [
      { id: 'products', title: 'PRODUCTS', columns: ['name'], entity: 'products' },
      {
        id: 'questions',
        title: 'QUESTIONS',
        synonyms: ['question'],
        columns: ['question', 'stage', 'product'],
        entity: 'questions'
      }
    ]
    const read = readReply(
      '### QUESTIONS\nquestion,stage,product\nWhat replaced vtext?,Problem,Email to SMS\n',
      sections
    )
    expect(read.rows).toEqual([
      {
        section: 'questions',
        values: { question: 'What replaced vtext?', stage: 'Problem', product: 'Email to SMS' }
      }
    ])
  })
})

const CONTEXT = {
  projectId: 'proj-1',
  domain: 'textbolt.com',
  brands: ['TextBolt'],
  target: null,
  blocks: [],
  pagePaths: [],
  targetQuestions: [],
  projectQuestions: [],
  promptId: null,
  subject: null
}

const PRODUCTS: readonly HelpFillSection[] = [
  { id: 'main', title: null, columns: ['name', 'job', 'url'], entity: 'products', neutral: false }
]

function products(text: string): Record<string, string>[] {
  return readReply(text, PRODUCTS).rows.map((row) => row.values)
}

describe('readReply: typographic quotes as CSV quotes', () => {
  test('the Claude.ai reply: ” opens and closes each job; all 3 rows keep the full job and url', () => {
    const reply = `name,job,url
email to text service,”Lets business staff send texts from Gmail, Outlook or any email client and receive replies back in their inbox”,/integration/gmail-to-text/
email to SMS alerting,”Sends alerts from monitoring tools, alarm panels, IoT sensors and web forms to on-call phones as texts without code”,/use-case/server-monitoring-text-alerts/
carrier email-to-text gateway replacement,”Replaces retired AT&T, Verizon and T-Mobile email-to-SMS gateways so existing email alerts keep reaching phones”,/migration/`
    const read = readReply(reply, PRODUCTS)
    expect(read.warnings).toEqual([])
    expect(read.rows.map((row) => row.values)).toEqual([
      {
        name: 'email to text service',
        job: 'Lets business staff send texts from Gmail, Outlook or any email client and receive replies back in their inbox',
        url: '/integration/gmail-to-text/'
      },
      {
        name: 'email to SMS alerting',
        job: 'Sends alerts from monitoring tools, alarm panels, IoT sensors and web forms to on-call phones as texts without code',
        url: '/use-case/server-monitoring-text-alerts/'
      },
      {
        name: 'carrier email-to-text gateway replacement',
        job: 'Replaces retired AT&T, Verizon and T-Mobile email-to-SMS gateways so existing email alerts keep reaching phones',
        url: '/migration/'
      }
    ])
  })

  test('ChatGPT: “ ” pairs around fields, with chatter around the CSV', () => {
    const reply = `Here are the products:

name,job,url
“Email to text”,“Send texts from Gmail, Outlook or any inbox”,/email-to-text/
SMS alerts,“Alerts from monitoring tools, alarms and forms, as texts”, /alerts/

Let me know if you want more.`
    expect(products(reply)).toEqual([
      {
        name: 'Email to text',
        job: 'Send texts from Gmail, Outlook or any inbox',
        url: '/email-to-text/'
      },
      {
        name: 'SMS alerts',
        job: 'Alerts from monitoring tools, alarms and forms, as texts',
        url: '/alerts/'
      }
    ])
  })

  test('a markdown table with curly-quoted cells', () => {
    const reply = `| name | job | url |
|---|---|---|
| Email to text | “Send texts from Gmail, Outlook or any inbox” | /email-to-text/ |
| SMS alerts | ”Alerts from monitoring tools, as texts” | /alerts/ |`
    expect(products(reply)).toEqual([
      {
        name: 'Email to text',
        job: 'Send texts from Gmail, Outlook or any inbox',
        url: '/email-to-text/'
      },
      { name: 'SMS alerts', job: 'Alerts from monitoring tools, as texts', url: '/alerts/' }
    ])
  })

  test('curly quotes inside ordinary text stay; plain quotes still work', () => {
    const reply = `name,job,url
Email to text,Called “the easy way” by staff,/email-to-text/
"Alerts, by text","Says ""no code"" and means it",/alerts/`
    expect(products(reply)).toEqual([
      { name: 'Email to text', job: 'Called “the easy way” by staff', url: '/email-to-text/' },
      { name: 'Alerts, by text', job: 'Says "no code" and means it', url: '/alerts/' }
    ])
  })

  test('headerless lines with curly-quoted fields split evenly, each field whole', () => {
    const reply = `Email to text,“Send texts from Gmail, Outlook or any inbox”,/email-to-text/
SMS alerts,“Alerts from monitoring tools, alarms and forms”,/alerts/`
    const rows = products(reply)
    expect(rows.map((row) => row.url)).toEqual(['/email-to-text/', '/alerts/'])
    // Without a header the columns are guessed; the quoted field stays one cell either way.
    expect(rows.map((row) => Object.values(row).find((value) => value.includes(',')))).toEqual([
      'Send texts from Gmail, Outlook or any inbox',
      'Alerts from monitoring tools, alarms and forms'
    ])
  })
})

describe('rejoinCells: an unquoted comma in a free-text cell', () => {
  test('a question cut at its commas keeps its stage and page', () => {
    const reply = `question,stage,page
We are choosing between Rippling, Papaya Global and others. We need compliance, payouts and HR. Which fits?,Compare,/deel-vs-competitors/
How do I pay contractors abroad?,Options,/solutions/payroll/`
    expect(readReply(reply, QUESTIONS).rows.map((row) => row.values)).toEqual([
      {
        question:
          'We are choosing between Rippling, Papaya Global and others. We need compliance, payouts and HR. Which fits?',
        stage: 'Compare',
        page: '/deel-vs-competitors/'
      },
      {
        question: 'How do I pay contractors abroad?',
        stage: 'Options',
        page: '/solutions/payroll/'
      }
    ])
  })

  test('the last free-text column takes the extra cells', () => {
    expect(
      rejoinCells(
        ['Airbase', 'airbase.com', '', 'direct', 'Cards', ' expense management', ' bill pay.'],
        ['name', 'domain', 'product', 'tier', 'why']
      )
    ).toEqual(['Airbase', 'airbase.com', '', 'direct', 'Cards, expense management, bill pay.'])
  })

  test('a middle free-text column takes them when the pieces start there', () => {
    expect(
      rejoinCells(
        [
          'situation',
          'What service should we use?',
          'See whether AI names Remote',
          ' Oyster',
          '/hire/'
        ],
        ['shape', 'prompt', 'outcome', 'page']
      )
    ).toEqual([
      'situation',
      'What service should we use?',
      'See whether AI names Remote, Oyster',
      '/hire/'
    ])
  })

  test('a short column (stage, page) never swallows a sentence', () => {
    expect(
      rejoinCells(['Which tools', 'and how', 'Compare', '/switch'], ['question', 'stage', 'page'])
    ).toEqual(['Which tools,and how', 'Compare', '/switch'])
  })

  test('thousands commas still join, and rows that fit are left alone', () => {
    expect(
      rejoinCells(['IT leads at 1', '000+ firms', 'Alerts', 'IT'], ['who', 'situation', 'evidence'])
    ).toEqual(['IT leads at 1,000+ firms', 'Alerts', 'IT'])
    expect(rejoinCells(['a', 'b'], ['name', 'why'])).toEqual(['a', 'b'])
  })
})
