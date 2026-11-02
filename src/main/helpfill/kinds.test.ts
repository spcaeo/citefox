import type { PageSummary } from '@shared/domain'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SEED, seedAssistProject, type AssistSeed } from '../assist/assist.test-helper'
import { insertPage } from '../storage/pages'
import { readProductCatalog, replaceProductCatalog } from '../storage/products'
import { describeHelpFill } from './service'

/**
 * The places helpfill-lists adds (Docs/HELPFILL.md): Competitors (✦ Help me find
 * them) and Add questions → ✦ Match pages, through the real handlers on the seeded
 * TextBolt project. Claude is the scripted stand-in (recorded fixtures); the
 * competitor domain check uses a fake DNS, so nothing leaves the test.
 */

const TOPIC = 'topic-1'
const QUESTIONS = [
  'How much does it cost to text a whole crew from email every month?',
  'How do I set up text alerts for my business without a developer?',
  'Can church volunteers reply to a group text sent from the office?'
]

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
  insertPage(
    seed.projectDb,
    page({ id: 'page-2', url: 'https://textbolt.com/pricing/', label: 'Pricing' })
  )
  insertPage(seed.projectDb, page({ id: TOPIC, url: null, kind: 'topic', title: 'Crew alerts' }))
  replaceProductCatalog(seed.projectDb, {
    products: [
      {
        id: 'prod-1',
        name: 'Email to SMS',
        job: 'text alerts from email',
        buyer: 'office managers'
      }
    ],
    competitors: [
      {
        name: 'SimpleTexting',
        domain: 'simpletexting.com',
        productId: null,
        tier: 'direct',
        startingPrice: null,
        sources: []
      }
    ]
  })
})

afterEach(() => {
  seed.close()
})

describe('competitors', () => {
  test('the prompt: who they lose deals to, the reply header and the saved ones', async () => {
    const { prompt, columns, tracked } = await seed.handlers['helpfill:prompt']({
      kind: 'competitors',
      projectId: SEED.projectId,
      scope: { pageId: null },
      count: null
    })
    expect(columns).toEqual(['name', 'domain', 'competes_with'])
    expect(tracked).toBe(1)
    expect(prompt.split('\n')[0]).toBe('You help a company list the competitors it loses deals to.')
    expect(prompt).toContain('List 15 companies a buyer weighs against TextBolt (textbolt.com)')
    expect(prompt).toContain('Never list textbolt.com itself.')
    expect(prompt).toContain('competes_with = Email to SMS (the product it competes with)')
    expect(prompt).toContain('Reply with CSV only, this header:\nname,domain,competes_with')
    expect(prompt).toContain("Already tracked, don't repeat: 1 competitor, listed below.")
    expect(prompt).toContain('- SimpleTexting (simpletexting.com)')
    expect(prompt).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/iu)
  })

  test('reads a pasted answer: saved ones merged, own brand set aside, hosts and products tidied', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'competitors',
      projectId: SEED.projectId,
      scope: { pageId: null },
      text: `Here are competitors I found:

| Name | Domain | Competes with |
| --- | --- | --- |
| Textmagic | https://www.textmagic.com/email-to-sms/ | email to sms |
| SimpleTexting | simpletexting.com | |
| TextBolt | textbolt.com | |
| Alerts Hub | https://alerts.textbolt.com/ | |
| ClickSend | [ClickSend](https://clicksend.com) | Fax |
| Textmagic | textmagic.com | |

Sources: G2, Capterra.`
    })
    expect(result.counts).toEqual({ read: 5, tracked: 1, repeats: 1, setAside: 1, ready: 2 })
    expect(result.setAside.map((row) => row.values.name)).toEqual(['TextBolt'])
    expect(result.rows.map((row) => row.values)).toEqual([
      { name: 'Textmagic', domain: 'textmagic.com', competes_with: 'Email to SMS' },
      // The reader keeps a markdown link's text, so the website is left for the preview to flag.
      { name: 'ClickSend', domain: '', competes_with: '' }
    ])
    expect(result.noun).toEqual(['competitor', 'competitors'])
  })

  test('Describe runs the web-search competitor finding with the sentence', async () => {
    const host = {
      ...seed.host,
      pageDns: { lookup: async () => ['93.184.216.34'] }
    }
    const sentence = 'We lose deals to cheap SMS apps and developer APIs.'
    const result = await describeHelpFill(host, {
      kind: 'competitors',
      projectId: SEED.projectId,
      scope: { pageId: null },
      sentence,
      count: 20
    })
    const request = seed.claude.requests.at(-1)
    expect(request?.prompt.startsWith('Assist: project.productCompetitors')).toBe(true)
    expect(request?.prompt).toContain(`In the owner's words: ${sentence}`)
    expect(request?.prompt).toContain("textbolt.com's Email to SMS")
    expect(result.counts.tracked).toBe(1)
    expect(result.rows.length).toBe(result.counts.read - 1)
    expect(result.rows[0]?.values).toEqual({
      name: 'TXTImpact',
      domain: 'txtimpact.com',
      competes_with: 'Email to SMS'
    })
    // SimpleTexting is saved already: merged, not offered again.
    expect(result.rows.map((row) => row.values.name)).not.toContain('SimpleTexting')
  })
})

describe('competitors import', () => {
  test('rows the helper read go through the import preview; Competes with names the product', async () => {
    const read = await seed.handlers['import:read']({
      projectId: SEED.projectId,
      entity: 'competitors',
      source: {
        kind: 'paste',
        text: 'name\tdomain\tcompetes_with\nTextmagic\ttextmagic.com\tEmail to SMS\nClickSend\tclicksend.com\t'
      },
      hasHeader: null
    })
    expect(read.mapping).toEqual(['name', 'domain', 'competes_with'])
    const preview = await seed.handlers['import:preview']({
      projectId: SEED.projectId,
      entity: 'competitors',
      sourceId: read.sourceId,
      mapping: read.mapping,
      stageWords: {},
      defaults: { stage: null, page: null, market: null },
      rules: { keywords: true },
      targetId: null,
      saveMapping: false
    })
    expect(preview.rows.map((row) => row.result)).toEqual(['new', 'new'])
    const commit = await seed.handlers['import:commit']({
      projectId: SEED.projectId,
      entity: 'competitors',
      targetId: null,
      rules: { keywords: true },
      rows: preview.rows.map((row) => ({ values: row.values, keep: false }))
    })
    expect(commit.added).toBe(2)
    const saved = readProductCatalog(seed.projectDb).competitors
    expect(Object.fromEntries(saved.map((item) => [item.name, item.productId]))).toEqual({
      SimpleTexting: null,
      Textmagic: 'prod-1',
      ClickSend: null
    })
  })
})

describe('match pages', () => {
  test('the prompt lists the rows and the tracked pages, and asks for question,page', async () => {
    const { prompt, columns } = await seed.handlers['helpfill:prompt']({
      kind: 'matchPages',
      projectId: SEED.projectId,
      scope: { pageId: TOPIC },
      count: null,
      items: QUESTIONS
    })
    expect(columns).toEqual(['question', 'page'])
    expect(prompt).toContain('Topic: Crew alerts.')
    expect(prompt).toContain('- /pricing/ · Pricing')
    expect(prompt).toContain('- /blog/how-to-set-up-text-alerts-for-business/ · Alerts')
    expect(prompt).toContain(`1. ${QUESTIONS[0]}`)
    expect(prompt).toContain(`3. ${QUESTIONS[2]}`)
    expect(prompt).toContain('Reply with CSV only, this header:\nquestion,page')
    expect(prompt).not.toContain('Already tracked')
  })

  test('reads question,page: tracked pages set, an untracked one flagged, never invented', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'matchPages',
      projectId: SEED.projectId,
      scope: { pageId: TOPIC },
      items: QUESTIONS,
      text: `question,page
"${QUESTIONS[0]}",/pricing
"${QUESTIONS[1]}",https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/
"${QUESTIONS[2]}",/church-texting/`
    })
    expect(result.counts).toMatchObject({ read: 3, tracked: 0, setAside: 0, ready: 3 })
    expect(result.rows.map((row) => row.values)).toEqual([
      { question: QUESTIONS[0], page: 'https://textbolt.com/pricing/' },
      {
        question: QUESTIONS[1],
        page: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
      },
      { question: QUESTIONS[2], page: '', untracked: '/church-texting/' }
    ])
  })

  test('Describe runs questions.matchPages with the rows and the tracked pages', async () => {
    const result = await seed.handlers['helpfill:describe']({
      kind: 'matchPages',
      projectId: SEED.projectId,
      scope: { pageId: TOPIC },
      sentence: '',
      count: 40,
      items: QUESTIONS
    })
    const request = seed.claude.requests.at(-1)
    expect(request?.prompt.startsWith('Assist: questions.matchPages')).toBe(true)
    expect(request?.prompt).toContain('- /pricing/ · Pricing')
    expect(request?.prompt).toContain(`<pasted>\n1. ${QUESTIONS[0]}`)
    expect(result.rows.map((row) => row.values.page)).toEqual([
      'https://textbolt.com/pricing/',
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
      ''
    ])
  })

  test('items are checked: too many or too long are refused', async () => {
    await expect(
      seed.handlers['helpfill:prompt']({
        kind: 'matchPages',
        projectId: SEED.projectId,
        scope: { pageId: TOPIC },
        count: null,
        items: Array.from({ length: 201 }, () => 'q')
      })
    ).rejects.toThrow('helpfill:prompt: Invalid request')
    await expect(
      seed.handlers['helpfill:read']({
        kind: 'matchPages',
        projectId: SEED.projectId,
        scope: { pageId: TOPIC },
        text: 'a',
        items: ['x'.repeat(501)]
      })
    ).rejects.toThrow('helpfill:read: Invalid request')
  })
})

function page(patch: Partial<PageSummary> & { id: string }): PageSummary {
  return {
    projectId: SEED.projectId,
    url: null,
    title: null,
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 5,
    defaultMarketId: SEED.us,
    pinned: false,
    score: null,
    promptSetVersion: null,
    ...patch
  }
}
