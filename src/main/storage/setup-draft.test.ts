import { describe, expect, test } from 'vitest'
import type { OnboardingDraft, SetupDraft, SetupItem } from '@shared/ipc'
import { OnboardingDraftError, parseOnboardingDraft } from './onboarding-draft'

function item(overrides: Partial<SetupItem> = {}): SetupItem {
  return {
    id: 'i-1',
    name: 'TXTImpact',
    detail: 'Same job.',
    url: 'txtimpact.com',
    tag: 'Email-to-SMS gateway',
    tier: 'direct',
    origin: 'ai',
    kept: true,
    edited: false,
    fresh: false,
    ...overrides
  }
}

function setup(): SetupDraft {
  return {
    site: {
      domain: 'textbolt.com',
      projectName: 'TextBolt',
      userName: '',
      country: 'US',
      countryCode: '',
      language: 'en',
      languageCode: '',
      location: ''
    },
    readWay: 'claude',
    readDone: true,
    summary: 'TextBolt sells an email-to-SMS gateway.',
    summaryOrigin: 'ai',
    lists: {
      brands: [item({ id: 'b-1', name: 'TextBolt', url: null, tag: null, tier: undefined })],
      products: [],
      buyers: [],
      triggers: [],
      competitors: [item()],
      switchingFrom: [],
      integrations: [],
      examples: [],
      questions: [
        item({
          id: 'q-1',
          name: 'How do we text staff?',
          url: '/',
          tag: 'problem',
          tier: undefined,
          origin: 'user'
        })
      ]
    },
    topic: 'Gateway shutdown',
    topicOrigin: 'user',
    prompts: { competitors: 'Only US competitors, please.' },
    search: { provider: 'cloro', engines: ['google_aio', 'chatgpt'], everyDays: 14 },
    mix: { search: 4, question: 4, situation: 4 },
    questionsMix: null
  }
}

function v1(): OnboardingDraft {
  return {
    view: 'profile',
    profile: {
      userName: 'Ada',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      brands: ['TextBolt'],
      brandDraft: '',
      competitors: [],
      competitorDraft: '',
      switchingFrom: [],
      integrations: [],
      country: 'US',
      countryCode: '',
      language: 'en',
      languageCode: '',
      location: ''
    },
    fill: null,
    budget: ''
  }
}

/** JSON drops `tier: undefined`, as the renderer's save does. */
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('onboarding draft: v2 setup', () => {
  test('an old v1 draft still parses, with no setup fields', () => {
    const parsed = parseOnboardingDraft(v1())
    expect(parsed.setup).toBeUndefined()
    expect(parsed.setupView).toBeUndefined()
  })

  test('a v2 draft keeps its step and setup as saved', () => {
    const draft = roundTrip({ ...v1(), setupView: 'competitors' as const, setup: setup() })
    const parsed = parseOnboardingDraft(draft)
    expect(parsed.setupView).toBe('competitors')
    expect(parsed.setup).toEqual(draft.setup)
  })

  test('a row CiteFox AI filled in keeps its mark across a restart; older rows have none', () => {
    const filled = item({
      id: 'p-1',
      name: 'Mass texting',
      origin: 'user',
      detail: 'Sends texts',
      aiFilled: true
    })
    const draft = roundTrip({
      ...v1(),
      setupView: 'brand' as const,
      setup: { ...setup(), lists: { ...setup().lists, products: [filled, item({ id: 'p-2' })] } }
    })
    const parsed = parseOnboardingDraft(draft)
    expect(parsed.setup?.lists.products[0]?.aiFilled).toBe(true)
    expect(parsed.setup?.lists.products[1]).not.toHaveProperty('aiFilled')
    expect(parsed.setup).toEqual(draft.setup)
  })

  test('aiFilled must be a boolean', () => {
    const bad = roundTrip({
      ...v1(),
      setupView: 'brand' as const,
      setup: { ...setup(), lists: { ...setup().lists, products: [{ ...item(), aiFilled: 'yes' }] } }
    })
    expect(() => parseOnboardingDraft(bad)).toThrow(OnboardingDraftError)
  })

  test.each([
    ['an unknown step', (d: Record<string, unknown>) => ({ ...d, setupView: 'profile' })],
    [
      'an unknown read way',
      (d: Record<string, unknown>) => ({ ...d, setup: { ...setup(), readWay: 'magic' } })
    ],
    [
      'a missing list',
      (d: Record<string, unknown>) => {
        const lists: Record<string, unknown> = { ...setup().lists }
        delete lists.questions
        return { ...d, setup: { ...setup(), lists } }
      }
    ],
    [
      'a bad origin',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: {
          ...setup(),
          lists: { ...setup().lists, buyers: [item({ origin: 'robot' as never })] }
        }
      })
    ],
    [
      'a repeated item id',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: { ...setup(), lists: { ...setup().lists, buyers: [item(), item()] } }
      })
    ],
    [
      'too many items',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: {
          ...setup(),
          lists: {
            ...setup().lists,
            buyers: Array.from({ length: 101 }, (_, i) => item({ id: `b-${i}` }))
          }
        }
      })
    ],
    [
      'a long name',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: {
          ...setup(),
          lists: { ...setup().lists, buyers: [item({ name: 'x'.repeat(501) })] }
        }
      })
    ],
    [
      'an unknown engine',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: { ...setup(), search: { provider: 'cloro', engines: ['altavista'], everyDays: 14 } }
      })
    ],
    [
      'a bad schedule',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: { ...setup(), search: { provider: 'serpapi', engines: [], everyDays: -1 } }
      })
    ],
    [
      'a prompt for an unknown section',
      (d: Record<string, unknown>) => ({
        ...d,
        setup: { ...setup(), prompts: { pricing: 'x' } }
      })
    ],
    ['an extra key', (d: Record<string, unknown>) => ({ ...d, setup: { ...setup(), secret: 'x' } })]
  ])('refuses %s', (_label, change) => {
    const draft = change(roundTrip({ ...v1(), setupView: 'site', setup: setup() }) as never)
    expect(() => parseOnboardingDraft(draft)).toThrow(OnboardingDraftError)
  })
})
