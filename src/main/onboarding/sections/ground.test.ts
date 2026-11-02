import { describe, expect, test } from 'vitest'
import { CHECK_MIN_CHARS } from '../../engine/site-grounding'
import type { SiteOutline } from '../../engine/site-outline'
import { cleanCompanyName, productOfParent } from './companies'
import { sectionDef } from './registry'
import { settleReply } from './settle'
import { row, textboltContext } from './test-context.test-helper'
import type { SetupSectionId } from '@shared/ipc'

/** A site read with enough text for the checks (prompt bench report 2026-10-31). */
const SITE: SiteOutline = {
  pages: [
    { path: '/', title: 'TextBolt · Email to text' },
    { path: '/pricing', title: 'Pricing' }
  ],
  menu: [
    { text: 'AT&T alternative', path: '/migration/att/' },
    { text: 'Gmail to text', path: '/integration/gmail-to-text/' }
  ],
  text: [
    'TextBolt turns email into text messages. Works with Gmail, Outlook and Grafana alerts.',
    'Built for healthcare teams, law firms and IT operations staff.',
    'AT&T shut down its email-to-text gateway. Switch from Text-Em-All in minutes.',
    'TextBolt Pro adds shared inboxes.'
  ]
    .join('\n')
    .padEnd(CHECK_MIN_CHARS + 10, ' more words about texting.'),
  facts: {
    brands: ['TextBolt', 'TextBolt Pro'],
    products: [],
    audiences: [],
    comparedWith: ['Text-Em-All'],
    switchingFrom: [],
    integrations: []
  }
}

const settle = (
  section: SetupSectionId,
  text: string,
  site: SiteOutline | null = SITE
): ReturnType<typeof settleReply> =>
  settleReply(sectionDef(section), textboltContext(), [], text, 'run', site)

describe('setup answers held to the site read', () => {
  test('brands: no legal or cut-short names, nothing the pages never say; read names added back', () => {
    const result = settle(
      'brands',
      'name\nTextBolt\nText Bolt\nTextBolt Inc\nTextBolt SMS Gateway\nText\nTextbolt.com'
    )
    expect(result.rows.map((item) => item.name)).toEqual(['TextBolt', 'Text Bolt', 'TextBolt Pro'])
    expect(result.warnings.join(' ')).toContain('TextBolt SMS Gateway')
  })

  test('brands: a dotted main name and its own dotted product stay; the bare domain twin goes', () => {
    const cal: SiteOutline = {
      ...SITE,
      text: 'Cal.com scheduling. Try Cal.ai calls. Supabase sync.'.padEnd(
        CHECK_MIN_CHARS + 5,
        ' x'
      ),
      facts: { ...(SITE.facts as NonNullable<SiteOutline['facts']>), brands: ['Cal.com', 'Cal.ai'] }
    }
    const result = settleReply(
      sectionDef('brands'),
      { ...textboltContext(), domain: 'cal.com', brands: ['Cal.com'] },
      [],
      'name\nCal.com\nCal.ai\nCal\nCal.com, Inc.',
      'run',
      cal
    )
    expect(result.rows.map((item) => item.name)).toEqual(['Cal.com', 'Cal.ai'])
  })

  test('buyers: evidence must be on the site; guessed sizes come out', () => {
    const result = settle(
      'buyers',
      [
        'who,situation,evidence',
        'Practice managers at healthcare clinics (20-200 staff),Staff miss emailed changes.,healthcare teams',
        'IT managers at MSPs running Nagios,Alerts sit unread.,Nagios monitoring',
        '"IT operations staff at enterprises with 1,000+ employees",Alerts stopped.,IT operations staff'
      ].join('\n')
    )
    expect(result.rows.map((item) => item.name)).toEqual([
      'Practice managers at healthcare clinics',
      'IT operations staff at enterprises'
    ])
  })

  test('buyers: an unquoted thousands comma no longer splits the row', () => {
    const result = settle(
      'buyers',
      'who,situation,evidence\nIT leads at enterprises with 1,000+ employees,Alerts stopped.,IT operations staff',
      null
    )
    expect(result.rows[0]).toMatchObject({
      name: 'IT leads at enterprises',
      detail: 'Alerts stopped.'
    })
  })

  test('questions and examples: a page that is not on the site is blanked', () => {
    const result = settle(
      'questions',
      'question,stage,shape,page\nhow do I text from gmail?,Options,question,/integration/gmail-to-text\nis email to text reliable?,Doubts,question,/email-to-text-guide/'
    )
    expect(result.rows.map((item) => item.url)).toEqual(['/integration/gmail-to-text', null])
  })

  test('integrations: never its own product; at most four the pages do not name, marked', () => {
    const result = settle(
      'integrations',
      'name,domain,source,why\nGrafana,grafana.com,/,Alerts.\nTextBolt Pro,,known,Own.\nNagios,,known,x\nZabbix,,known,x\nPRTG,,known,x\nSplunk,,known,x\nOpsgenie,,known,x\nOutlook,,/,Mail.'
    )
    expect(result.rows.map((item) => item.name)).toEqual([
      'Grafana',
      'Outlook',
      'Nagios',
      'Zabbix',
      'PRTG',
      'Splunk'
    ])
    expect(result.warnings.join(' ')).toContain(
      'Not named on the pages read, check them: Nagios, Zabbix, PRTG, Splunk.'
    )
  })

  test('switch-from: a live product only when the site helps buyers leave it, tagged by kind', () => {
    const result = settle(
      'switchingFrom',
      'name,domain,kind,why\nText-Em-All,text-em-all.com,migration,Site offers a switch.\nCalendly,,migration,Not on the site.\nOld Gateway,,retired,It shut down.'
    )
    expect(result.rows.map((item) => [item.name, item.tag])).toEqual([
      ['Text-Em-All', 'migration'],
      ['Old Gateway', 'retired']
    ])
  })

  test('switch-from: a live rival or imported tool on the site stays; a retired product of a rival maker stays', () => {
    const context = {
      ...textboltContext(),
      competitors: [row('Zendesk', { url: 'zendesk.com' }), row('Text-Em-All')],
      integrations: ['Gmail']
    }
    const result = settleReply(
      sectionDef('switchingFrom'),
      context,
      [],
      'name,domain,kind,why\nText-Em-All,text-em-all.com,migration,The site has a switch page.\nGmail,gmail.com,migration,Named on the site, imports from it.\nZendesk Sell,zendesk.com,retired,Zendesk is shutting down Sell.\nZendesk,zendesk.com,retired,Not retired.',
      'run',
      SITE
    )
    expect(result.rows.map((item) => [item.name, item.tag])).toEqual([
      ['Text-Em-All', 'migration'],
      ['Gmail', 'migration'],
      ['Zendesk Sell', 'retired']
    ])
  })

  test('switch-from: a retired and a live product of one maker are two rows', () => {
    const result = settle(
      'switchingFrom',
      'name,domain,kind,why\nText-Em-All Classic,text-em-all.com,retired,It shut down.\nText-Em-All,text-em-all.com,migration,Switch page.'
    )
    expect(result.rows.map((item) => item.name)).toEqual(['Text-Em-All Classic', 'Text-Em-All'])
  })

  test('switch-from: a short live name must match its case on the site', () => {
    const site: SiteOutline = {
      ...SITE,
      text: `${SITE.text ?? ''} Add a README file.`,
      facts: { ...(SITE.facts as NonNullable<SiteOutline['facts']>), comparedWith: [] }
    }
    const result = settle(
      'switchingFrom',
      'name,domain,kind,why\nReadMe,readme.com,migration,x',
      site
    )
    expect(result.rows).toEqual([])
  })

  test('brands: the brand plus a word the pages show is kept, and the bare word goes', () => {
    const site: SiteOutline = {
      ...SITE,
      text: `${SITE.text ?? ''} Featured apps: Inbox Shield keeps your texts safe.`,
      facts: {
        ...(SITE.facts as NonNullable<SiteOutline['facts']>),
        brands: ['TextBolt', 'Shield']
      }
    }
    const result = settle('brands', 'name\nTextBolt\nTextBolt Shield', site)
    expect(result.rows.map((item) => item.name)).toEqual(['TextBolt', 'TextBolt Shield'])
  })

  test('brands: ordinary words and plan names are left out, product names stay', () => {
    const result = settle('brands', 'name\nTextBolt\nPremium\nInboxes\nTextBolt Pro')
    expect(result.rows.map((item) => item.name)).toEqual(['TextBolt', 'TextBolt Pro'])
  })

  test('competitors: "X alternative Y" is Y; its own products are never competitors', () => {
    const result = settle(
      'competitors',
      'name,domain,product,tier,why\nTextBolt alternative SimpleTexting,simpletexting.com,,direct,"Texts, alerts, inboxes."\nTextBolt Pro,,,direct,x'
    )
    expect(result.rows.map((item) => [item.name, item.detail])).toEqual([
      ['SimpleTexting', 'Texts, alerts, inboxes.']
    ])
    expect(cleanCompanyName('Mercury (Ramp alternative)')).toBe('Mercury')
  })

  test('competitors: a name with a colon is dropped, a bare parent company becomes its product', () => {
    const result = settle(
      'competitors',
      'name,domain,product,tier,why\nTrello Alternative: Teamwork.com,teamwork.com,,direct,x\nMicrosoft,microsoft.com,,partial,Microsoft Teams Phone sends texts too.'
    )
    expect(result.rows.map((item) => item.name)).toEqual(['Microsoft Teams Phone'])
    expect(productOfParent('Google', 'Search ads.')).toBe('Google')
  })

  test('topic: the name only; a source path the site lacks gets a warning', () => {
    const good = settle('topic', 'AT&T email to text alternative\n/migration/att/')
    expect(good).toMatchObject({ text: 'AT&T email to text alternative', warnings: [] })
    const bad = settle('topic', 'Nagios alert texting\n/nagios/')
    expect(bad.text).toBe('Nagios alert texting')
    expect(bad.warnings[0]).toContain('/nagios/ is not on the site')
  })

  test('summary: labels the site never uses come out and it ends at a sentence', () => {
    const result = settle(
      'summary',
      'TextBolt sells a cloud email-to-text platform. It is used by 90,000 teams. It sends replies back to the inbox.'
    )
    expect(result.text).toBe(
      'TextBolt sells an email-to-text product. It sends replies back to the inbox.'
    )
  })

  test('no site read: rows pass as before', () => {
    const result = settle('buyers', 'who,situation\nIT managers,Alerts stopped.', null)
    expect(result.rows).toEqual([row('IT managers', { detail: 'Alerts stopped.' })])
  })
})
