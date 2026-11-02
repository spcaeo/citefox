import { afterEach, describe, expect, test } from 'vitest'
import type {
  CompanySuggestion,
  FillFromWebsiteResult,
  OnboardingDraft,
  SaveProfileRequest
} from '@shared/ipc'
import {
  cleanupHarness,
  harness,
  keyRequest,
  noSecret,
  profile,
  rejected,
  SECRET,
  treeHas
} from './test-harness'

afterEach(cleanupHarness)

describe('IPC handlers: onboarding', () => {
  test('onboarding:getState starts on the profile step', async () => {
    const { handlers, logs } = harness()
    const state = await handlers['onboarding:getState']()
    expect(state.finished).toBe(false)
    expect(state.currentStep).toBe('profile')
    expect(state.profile).toBeNull()
    expect(state.steps.map((step) => step.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending'
    ])
    expect(noSecret(state, logs, SECRET)).toBe(true)
  })

  test('onboarding:saveProfile writes the project, userName, and UK as given', async () => {
    const { handlers, storage, logs } = harness({
      locations: [{ country: 'US', query: 'Austin', canonicalName: 'Austin,Texas,United States' }]
    })
    const state = await handlers['onboarding:saveProfile'](profile())
    expect(state.currentStep).toBe('serpapi')
    expect(state.profile?.userName).toBe('Ada')
    expect(state.profile?.project.slug).toBe('textbolt')
    expect(state.profile?.project.domain).toBe('textbolt.com')
    expect(state.profile?.includeSubdomains).toBe(true)
    expect(state.profile?.defaultMarket).toMatchObject({
      country: 'UK',
      language: 'en',
      device: 'desktop',
      location: 'London',
      localWording: false,
      serpapiLocation: null
    })
    expect(storage.readSettings()).toMatchObject({
      userName: 'Ada',
      defaultCountry: 'UK',
      defaultLanguage: 'en',
      defaultLocation: 'London',
      defaultDevice: 'desktop',
      defaultIntervalDays: 7
    })

    const omitted = profile()
    delete (omitted as { includeSubdomains?: boolean }).includeSubdomains
    delete (omitted as { device?: string }).device
    omitted.projectName = 'TextBolt'
    omitted.country = 'US'
    omitted.location = 'Austin'
    const again = await handlers['onboarding:saveProfile'](omitted)
    expect(again.profile?.includeSubdomains).toBe(true)
    expect(again.profile?.defaultMarket.device).toBe('desktop')
    expect(again.profile?.defaultMarket.serpapiLocation).toBe('Austin,Texas,United States')
    expect(again.profile?.defaultMarket.country).toBe('US')
    expect(storage.readSettings().defaultCountry).toBe('UK')

    await expect(
      handlers['onboarding:saveProfile']({ ...profile(), extra: SECRET } as SaveProfileRequest)
    ).rejects.toThrow('onboarding:saveProfile: Invalid request')
    expect(noSecret(again, logs, SECRET)).toBe(true)
    expect(treeHas(storage.paths.root, SECRET)).toBe(false)
  })

  test('onboarding:saveProfile keeps what buyers switch from and integrations apart (feedback 3)', async () => {
    const { handlers } = harness()
    const first = await handlers['onboarding:saveProfile']({
      ...profile(),
      switchingFrom: ['AT&T email-to-text gateway', 'Verizon vtext.com'],
      integrations: ['WIN-911']
    })
    expect(first.profile?.switchingFrom).toEqual([
      'AT&T email-to-text gateway',
      'Verizon vtext.com'
    ])
    expect(first.profile?.integrations).toEqual(['WIN-911'])
    expect(first.profile?.competitors).not.toContain('WIN-911')
    // Saving again without the lists keeps the notes.
    const again = await handlers['onboarding:saveProfile'](profile())
    expect(again.profile?.switchingFrom).toEqual([
      'AT&T email-to-text gateway',
      'Verizon vtext.com'
    ])
    const cleared = await handlers['onboarding:saveProfile']({ ...profile(), integrations: [] })
    expect(cleared.profile?.integrations).toEqual([])
    await expect(
      handlers['onboarding:saveProfile']({
        ...profile(),
        switchingFrom: Array.from({ length: 13 }, (_, index) => `Old ${index}`)
      })
    ).rejects.toThrow('onboarding:saveProfile: Invalid request')
  })

  test('onboarding:finish requires a profile and a SerpApi key and skips Jina', async () => {
    const { handlers, logs } = harness()
    await expect(handlers['onboarding:finish']()).rejects.toThrow(
      'onboarding:finish: A saved profile and a search key (cloro or SerpApi) are required'
    )
    await handlers['onboarding:saveProfile'](profile())
    await expect(handlers['onboarding:finish']()).rejects.toThrow(/search key/)
    await handlers['keys:add'](keyRequest('serpapi', SECRET))
    const finished = await handlers['onboarding:finish']()
    expect(finished.finished).toBe(true)
    expect(finished.currentStep).toBeNull()
    expect(finished.steps.find((step) => step.id === 'jina')?.status).toBe('skipped')
    expect(finished.steps.find((step) => step.id === 'claude')?.status).toBe('pending')
    expect(noSecret(finished, logs, SECRET)).toBe(true)
    await expect(rejected(handlers, 'onboarding:finish', [SECRET])).resolves.toMatch(
      /unexpected arguments/
    )
  })

  test('onboarding:finish saves the Fill read’s products and the kept competitors by product (PC)', async () => {
    const { handlers } = harness()
    const state = await handlers['onboarding:saveProfile']({
      ...profile(),
      competitors: ['txtimpact.com', 'SimpleTexting', 'OtherCo']
    })
    const projectId = state.profile?.project.id ?? ''
    await handlers['onboarding:saveDraft'](fillDraft())
    await handlers['keys:add'](keyRequest('serpapi', SECRET))
    await handlers['onboarding:finish']()
    const catalog = await handlers['products:get']({ projectId })
    expect(catalog.products.map((item) => [item.id, item.name, item.evidencePath])).toEqual([
      ['prod-gw', 'Email-to-SMS gateway', '/email-to-sms/'],
      ['prod-bulk', 'Bulk SMS', null]
    ])
    expect(
      catalog.competitors.map((item) => [item.name, item.domain, item.productId, item.tier])
    ).toEqual([
      ['TXTImpact', 'txtimpact.com', 'prod-gw', 'direct'],
      ['SimpleTexting', 'simpletexting.com', 'prod-gw', 'partial'],
      ['SimpleTexting', 'simpletexting.com', 'prod-bulk', 'direct'],
      ['OtherCo', null, null, 'direct']
    ])
    // Not added on the profile step: not saved.
    expect(catalog.competitors.some((item) => item.name === 'Notifyre')).toBe(false)
    expect(catalog.competitors[0]?.startingPrice).toBe('$29/mo')
  })

  test('onboarding:finish still finishes when the Fill read cannot be saved', async () => {
    const { handlers } = harness()
    const state = await handlers['onboarding:saveProfile'](profile())
    const broken = fillDraft()
    const fill = broken.fill as unknown as { products: { id: string; name: string }[] }
    fill.products = [{ id: 'bad id!', name: 'Gateway' }]
    await handlers['onboarding:saveDraft'](broken)
    await handlers['keys:add'](keyRequest('serpapi', SECRET))
    await expect(handlers['onboarding:finish']()).resolves.toMatchObject({ finished: true })
    const catalog = await handlers['products:get']({ projectId: state.profile?.project.id ?? '' })
    expect(catalog.products).toEqual([])
    expect(catalog.competitors.map((item) => item.name)).toEqual(['OtherCo'])
  })
})

function company(
  name: string,
  domain: string,
  product: string,
  tier: 'direct' | 'partial'
): CompanySuggestion {
  return {
    id: `c-${name}-${product}`,
    name,
    domain,
    domainSource: 'search',
    reason: 'Same job.',
    evidence: null,
    checkDomain: false,
    product,
    tier,
    startingPrice: name === 'TXTImpact' ? '$29/mo' : null,
    sources: [{ url: `https://${domain}/pricing`, biased: true }]
  }
}

function fillDraft(): OnboardingDraft {
  const fill: FillFromWebsiteResult = {
    domain: 'textbolt.com',
    pagesRead: [{ role: 'home', url: 'https://textbolt.com/', ok: true }],
    summary: 'Email-to-SMS gateway for teams.',
    products: [
      {
        id: 'prod-gw',
        name: 'Email-to-SMS gateway',
        job: 'Send SMS from email',
        buyer: 'IT teams',
        evidence: { path: '/email-to-sms/', quote: 'Email to SMS' },
        searchNote: null
      },
      {
        id: 'prod-bulk',
        name: 'Bulk SMS',
        job: 'Text campaigns',
        buyer: 'Marketers',
        evidence: null,
        searchNote: null
      }
    ],
    brands: [],
    competitors: [
      company('TXTImpact', 'txtimpact.com', 'prod-gw', 'direct'),
      company('Notifyre', 'notifyre.com', 'prod-gw', 'direct'),
      company('SimpleTexting', 'simpletexting.com', 'prod-gw', 'partial'),
      company('SimpleTexting', 'simpletexting.com', 'prod-bulk', 'direct')
    ],
    switchingFrom: [],
    integrations: [],
    suggestedMarket: null,
    message: 'Found suggestions.',
    nextStep: null
  }
  return {
    view: 'serpapi',
    profile: {
      userName: 'Ada',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      brands: ['TextBolt'],
      brandDraft: '',
      competitors: ['txtimpact.com', 'SimpleTexting', 'OtherCo'],
      competitorDraft: '',
      switchingFrom: [],
      integrations: [],
      country: 'UK',
      countryCode: '',
      language: 'en',
      languageCode: '',
      location: 'London'
    },
    fill,
    budget: ''
  }
}
