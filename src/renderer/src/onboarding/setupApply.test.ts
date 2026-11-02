import { describe, expect, it } from 'vitest'
import type { FillFromWebsiteResult, SetupDraft, SetupRow } from '@shared/ipc'
import { MOCK_CHATBOT_ANSWER } from './mockSetupServices'
import {
  applyChatbotAnswer,
  applyFill,
  finishRequest,
  itemOf,
  profileRequest,
  replaceAiRows
} from './setupApply'
import { emptySetupDraft } from './setupDraft'

const row = (name: string, url: string | null = null): SetupRow => ({
  name,
  detail: '',
  url,
  tag: null
})

const FILL: FillFromWebsiteResult = {
  domain: 'textbolt.com',
  pagesRead: [],
  summary: 'Turns an email into a text.',
  products: [
    {
      id: 'p1',
      name: 'Gateway',
      job: 'Email to text',
      buyer: '',
      evidence: { path: '/g/', quote: 'q' },
      searchNote: null
    }
  ],
  brands: [{ id: 'b1', name: 'TextBolt', reason: '' }],
  competitors: [
    {
      id: 'c1',
      name: 'Textmagic',
      domain: 'textmagic.com',
      domainSource: 'search',
      reason: 'Same job.',
      evidence: null,
      checkDomain: false,
      product: 'p1',
      tier: 'partial'
    }
  ],
  switchingFrom: [
    {
      id: 's1',
      name: 'AT&T gateway',
      domain: null,
      domainSource: null,
      reason: '',
      evidence: null,
      checkDomain: false
    }
  ],
  integrations: [],
  suggestedMarket: null,
  message: '',
  nextStep: null
}

describe('applying AI answers', () => {
  it('replaces untouched AI rows and keeps the user’s rows and edits', () => {
    const mine = itemOf(row('Mine'), 'user')
    const edited = { ...itemOf(row('Edited'), 'ai'), edited: true }
    const old = itemOf(row('Old AI'), 'ai')
    const next = replaceAiRows([mine, old, edited], [row('mine'), row('New AI')])
    expect(next.map((item) => [item.name, item.origin, item.kept])).toEqual([
      ['Mine', 'user', true],
      ['Edited', 'ai', true],
      ['New AI', 'ai', true]
    ])
  })

  it('puts the website read into the summary and the lists, ticked', () => {
    const draft = applyFill(emptySetupDraft(), FILL)
    expect(draft.summary).toBe('Turns an email into a text.')
    expect(draft.lists.brands.map((item) => item.name)).toEqual(['TextBolt'])
    expect(draft.lists.products[0]).toMatchObject({
      name: 'Gateway',
      detail: 'Email to text',
      url: '/g/'
    })
    expect(draft.lists.competitors[0]).toMatchObject({
      name: 'Textmagic',
      url: 'textmagic.com',
      tag: 'Gateway',
      tier: 'partial',
      kept: true,
      origin: 'ai'
    })
    expect(draft.lists.switchingFrom[0]?.name).toBe('AT&T gateway')
    // A summary the user wrote is not replaced.
    const own = { ...emptySetupDraft(), summary: 'Mine', summaryOrigin: 'user' as const }
    expect(applyFill(own, FILL).summary).toBe('Mine')
  })

  it('puts a chatbot answer into products, buyers, triggers, competitors and questions', () => {
    const draft = applyChatbotAnswer(emptySetupDraft(), MOCK_CHATBOT_ANSWER)
    expect(draft.lists.products.map((item) => item.name)).toEqual([
      'Email-to-SMS gateway',
      'Business texting'
    ])
    expect(draft.lists.buyers[0]?.detail).toMatch(/on-call texts stopped/)
    expect(draft.lists.triggers.map((item) => item.name)).toEqual([
      'AT&T gateway shut down June 2025',
      'Verizon vtext sunset 2027'
    ])
    expect(draft.lists.competitors.map((item) => item.url)).toEqual([
      'textmagic.com',
      'clicksend.com'
    ])
    expect(draft.lists.questions.map((item) => item.tag)).toEqual(['problem', 'decide'])
  })
})

describe('requests from the draft', () => {
  function draft(): SetupDraft {
    const empty = emptySetupDraft()
    return {
      ...empty,
      site: {
        ...empty.site,
        domain: 'https://TextBolt.com/',
        country: 'other',
        countryCode: 'gb',
        language: 'en'
      },
      summary: ' Texts. ',
      lists: {
        ...empty.lists,
        brands: [itemOf(row('TextBolt'), 'ai'), { ...itemOf(row('Unticked'), 'ai'), kept: false }],
        competitors: [
          itemOf(row('Textmagic', 'textmagic.com'), 'ai'),
          itemOf(row('No domain'), 'ai')
        ],
        switchingFrom: [itemOf(row('AT&T gateway'), 'user')],
        questions: [itemOf(row('What changed?'), 'ai')]
      }
    }
  }

  it('builds saveProfile from the site and the kept rows', () => {
    expect(profileRequest(draft())).toMatchObject({
      userName: '',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      brandNames: ['TextBolt'],
      competitors: ['textmagic.com'],
      country: 'GB',
      language: 'en',
      location: null,
      switchingFrom: ['AT&T gateway'],
      integrations: []
    })
  })

  it('builds finishSetup from the kept rows', () => {
    const request = finishRequest(draft(), true)
    expect(request.summary).toBe('Texts.')
    expect(request.runFirstCheck).toBe(true)
    expect(request.competitors.map((item) => item.name)).toEqual(['Textmagic', 'No domain'])
    expect(request.questions).toEqual([{ name: 'What changed?', detail: '', url: null, tag: null }])
  })
})
