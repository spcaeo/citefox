import { describe, expect, test } from 'vitest'
import { sectionFixtureReply } from './fixture-replies'
import { SETUP_SECTION_IDS, sectionDef } from './registry'
import { CLAUDE_NOTHING_NEW, NOTHING_NEW, settleReply, type ReplySource } from './settle'
import { row, textboltContext } from './test-context.test-helper'

const settle = (
  section: Parameters<typeof sectionDef>[0],
  text: string,
  current: readonly ReturnType<typeof row>[] = [],
  source: ReplySource = 'paste'
): ReturnType<typeof settleReply> =>
  settleReply(sectionDef(section), textboltContext(), current, text, source)

describe('onboarding v2 section replies', () => {
  test.each(SETUP_SECTION_IDS)('the recorded %s reply reads into rows or text', (section) => {
    const reply = sectionFixtureReply(`Assist: setup.${section}\n…`)
    expect(reply).not.toBeNull()
    const result = settle(section, reply ?? '')
    expect(result.section).toBe(section)
    if (sectionDef(section).kind === 'text') {
      expect(result.text?.length ?? 0).toBeGreaterThan(5)
      expect(result.rows).toEqual([])
    } else {
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.text).toBeNull()
    }
  })

  test('the ✦ Find more fixtures differ from the redo ones', () => {
    for (const section of SETUP_SECTION_IDS) {
      if (sectionDef(section).kind === 'text') continue
      const redo = settle(section, sectionFixtureReply(`Assist: setup.${section}\n`) ?? '').rows
      const more = settle(
        section,
        sectionFixtureReply(`Assist: setup.${section}\nAlready listed, don't repeat: 1 x.`) ?? '',
        redo
      )
      expect(more.rows.length, section).toBeGreaterThan(0)
    }
  })

  test('buyers: CSV with chatter around it, near-duplicates of the held rows and of each other merged out', () => {
    const reply = [
      'Sure! Here are some buyer types:',
      '',
      '```csv',
      'who,situation',
      'Office managers at clinics,Patients miss emailed reminders.',
      'office managers at clinic,Same again.',
      'IT managers at small businesses,Their gateway shut down.',
      'School administrators,Parents miss closure emails.',
      '```',
      'Let me know if you want more.'
    ].join('\n')
    const result = settle('buyers', reply, [row('IT managers at small businesses')])
    expect(result.rows.map((item) => item.name)).toEqual([
      'Office managers at clinics',
      'School administrators'
    ])
    expect(result.rows[0]?.detail).toBe('Patients miss emailed reminders.')
  })

  test('competitors: a markdown table, with the brand, carriers, listed switch-from and held rows left out', () => {
    const reply = [
      '| Name | Domain | Product | Tier | Why |',
      '|---|---|---|---|---|',
      '| Notifyre | https://www.notifyre.com/ | email-to-sms gateway | direct | Same job. |',
      '| TextBolt | textbolt.com | | direct | Itself. |',
      '| AT&T email-to-text | att.com | | direct | Shut down. |',
      '| Verizon | verizon.com | | partial | A carrier. |',
      '| TXTImpact | | | direct | Held already by name. |',
      '| Twilio | twilio.com | | Partial | Needs code. |',
      '| Mystery Co | not sure | | direct | No domain known. |'
    ].join('\n')
    const result = settle('competitors', reply, [row('TXTImpact', { url: 'txtimpact.com' })])
    expect(result.rows).toEqual([
      {
        name: 'Notifyre',
        detail: 'Same job.',
        url: 'notifyre.com',
        tag: 'Email-to-SMS gateway',
        tier: 'direct'
      },
      { name: 'Twilio', detail: 'Needs code.', url: 'twilio.com', tag: null, tier: 'partial' },
      { name: 'Mystery Co', detail: 'No domain known.', url: null, tag: null, tier: 'direct' }
    ])
  })

  test('switch-from keeps a carrier gateway (buyers move from it), integrations drop a listed competitor', () => {
    const switching = settle(
      'switchingFrom',
      'name,domain,why\nVerizon email-to-text,verizon.com,Ending.'
    )
    expect(switching.rows[0]).toMatchObject({ name: 'Verizon email-to-text', url: 'verizon.com' })
    const tools = settle(
      'integrations',
      'name,domain,why\nTXTImpact,txtimpact.com,No.\nOutlook,outlook.com,Yes.'
    )
    expect(tools.rows.map((item) => item.name)).toEqual(['Outlook'])
  })

  test('questions: stage words become stage ids, pages become paths, brand questions are set aside', () => {
    const reply = [
      'question,stage,page',
      'How do we text staff when our carrier gateway shuts down?,Problem,https://textbolt.com/guides/',
      'Is TextBolt reliable for alarms?,Doubts,/',
      'Which gateway is cheapest for 20 staff?,Decide,'
    ].join('\n')
    const result = settle('questions', reply)
    expect(result.rows).toEqual([
      {
        name: 'How do we text staff when our carrier gateway shuts down?',
        detail: 'question',
        url: '/guides/',
        tag: 'problem'
      },
      {
        name: 'Which gateway is cheapest for 20 staff?',
        detail: 'question',
        url: null,
        tag: 'decide'
      }
    ])
    expect(result.warnings).toContain('1 question named the brand and was left out.')
  })

  test('questions: the shape column is kept, and guessed when missing', () => {
    const reply = [
      'question,stage,shape,page',
      'email to text service,Options,search,/',
      'How do I send a text from Gmail?,Problem,,',
      'Our carrier shut down email-to-text. Our alerts stopped. What should we use?,Problem,,'
    ].join('\n')
    expect(settle('questions', reply).rows.map((row) => row.detail)).toEqual([
      'search',
      'question',
      'situation'
    ])
  })

  test('examples: one row per shape with what it shows; a row without a known shape is dropped', () => {
    const reply = [
      'shape,prompt,outcome,page',
      'search,email to text service,See whether Google quotes your page.,/',
      'nonsense,something,See whether.,',
      'situation,"Our gateway shut down. What now?",See whether ChatGPT names you.,/migration/'
    ].join('\n')
    expect(settle('examples', reply).rows).toEqual([
      {
        name: 'email to text service',
        detail: 'See whether Google quotes your page.',
        url: '/',
        tag: 'search'
      },
      {
        name: 'Our gateway shut down. What now?',
        detail: 'See whether ChatGPT names you.',
        url: '/migration/',
        tag: 'situation'
      }
    ])
  })

  test('a plain list reads into one-column rows; products keep their path', () => {
    expect(
      settle('brands', '1. TextBolt\n2. Text Bolt\n3. TXTBolt').rows.map((item) => item.name)
    ).toEqual(['TextBolt', 'Text Bolt', 'TXTBolt'])
    const products = settle('products', 'name,job,url\nSMS API,Texts from code.,api')
    expect(products.rows[0]).toEqual({
      name: 'SMS API',
      detail: 'Texts from code.',
      url: '/api',
      tag: null
    })
  })

  test('nothing usable says so plainly', () => {
    expect(settle('buyers', 'I could not find anything.').warnings[0]).toMatch(/No table or list/u)
    const repeats = settle('brands', 'name\nTextBolt\nText Bolt', [
      row('TextBolt'),
      row('Text Bolt')
    ])
    expect(repeats.rows).toEqual([])
    expect(repeats.warnings).toContain(NOTHING_NEW)
  })

  test('an empty in-app reply says Claude had nothing to add; a paste keeps the paste advice', () => {
    for (const reply of ['name,job,url', 'There is only one product, and it is already listed.']) {
      const run = settle('products', reply, [], 'run')
      expect(run.rows).toEqual([])
      expect(run.warnings).toEqual([CLAUDE_NOTHING_NEW])
      expect(run.warnings.join(' ')).not.toMatch(/Paste|ask the chatbot/u)
      const pasted = settle('products', reply, [], 'paste')
      expect(pasted.warnings).toEqual([
        'No table or list was found in the answer. Paste the whole reply, or ask the chatbot for CSV.'
      ])
    }
    expect(settle('summary', '   ', [], 'run').warnings.join(' ')).not.toMatch(/paste/iu)
  })

  test('the Claude.ai products reply with curly quotes keeps each full job and its page', () => {
    const reply = `name,job,url
email to text service,”Lets business staff send texts from Gmail, Outlook or any email client and receive replies back in their inbox”,/integration/gmail-to-text/
email to SMS alerting,”Sends alerts from monitoring tools, alarm panels, IoT sensors and web forms to on-call phones as texts without code”,/use-case/server-monitoring-text-alerts/
carrier email-to-text gateway replacement,”Replaces retired AT&T, Verizon and T-Mobile email-to-SMS gateways so existing email alerts keep reaching phones”,/migration/`
    expect(settle('products', reply).rows).toEqual([
      {
        name: 'email to text service',
        detail:
          'Lets business staff send texts from Gmail, Outlook or any email client and receive replies back in their inbox',
        url: '/integration/gmail-to-text/',
        tag: null
      },
      {
        name: 'email to SMS alerting',
        detail:
          'Sends alerts from monitoring tools, alarm panels, IoT sensors and web forms to on-call phones as texts without code',
        url: '/use-case/server-monitoring-text-alerts/',
        tag: null
      },
      {
        name: 'carrier email-to-text gateway replacement',
        detail:
          'Replaces retired AT&T, Verizon and T-Mobile email-to-SMS gateways so existing email alerts keep reaching phones',
        url: '/migration/',
        tag: null
      }
    ])
  })

  test('text sections drop the chatbot words around the answer; the topic is one line', () => {
    const summary = settle(
      'summary',
      'Sure! Here is the summary:\n\nTextBolt turns emails into texts.\n\nLet me know if you need more.'
    )
    expect(summary.text).toBe('TextBolt turns emails into texts.')
    const topic = settle('topic', 'Topic: "Replacing a shut-down gateway"\nWhy: it is urgent.')
    expect(topic.text).toBe('Replacing a shut-down gateway')
    expect(settle('summary', '   ').text).toBeNull()
  })
})
