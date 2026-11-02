import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import type { FillFromWebsiteResult, OnboardingDraft } from '@shared/ipc'
import { MAX_DRAFT_BYTES, readOnboardingDraft } from '../storage/onboarding-draft'
import { ownedEntries } from '../reset/perform'
import { cleanupHarness, harness, keyRequest, profile, SECRET } from './test-harness'

afterEach(cleanupHarness)

function fill(): FillFromWebsiteResult {
  return {
    domain: 'textbolt.com',
    pagesRead: [{ role: 'home', url: 'https://textbolt.com/', ok: true }],
    brands: [{ id: 'b1', name: 'TextBolt', reason: 'Site name on the homepage.' }],
    competitors: [],
    switchingFrom: [],
    integrations: [],
    suggestedMarket: null,
    message: 'Found 1 suggestion.',
    nextStep: null
  } as unknown as FillFromWebsiteResult
}

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    view: 'profile',
    profile: {
      userName: 'Ada',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      brands: ['TextBolt'],
      brandDraft: 'Text Bo',
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
    fill: fill(),
    budget: '',
    ...overrides
  }
}

describe('IPC handlers: onboarding draft (feedback batch 2 row 4)', () => {
  test('getDraft is null until a draft is saved, then returns it after a restart', async () => {
    const first = harness()
    expect(await first.handlers['onboarding:getDraft']()).toBeNull()
    await expect(first.handlers['onboarding:saveDraft'](draft())).resolves.toEqual({
      saved: true
    })
    const file = first.storage.paths.onboardingDraftFile
    expect(existsSync(file)).toBe(true)
    // A restart reads the same file.
    expect(readOnboardingDraft(file)).toEqual(draft())
    expect(await first.handlers['onboarding:getDraft']()).toEqual(draft())
    await first.handlers['onboarding:saveDraft'](draft({ view: 'serpapi', budget: '250' }))
    expect((await first.handlers['onboarding:getDraft']())?.view).toBe('serpapi')
  })

  test('the draft lives in the data folder, so a reset moves it aside', async () => {
    const { handlers, storage } = harness()
    await handlers['onboarding:saveDraft'](draft())
    expect(ownedEntries(storage.paths.root)).toContain('onboarding-draft.json')
  })

  test('finish clears the draft and later saves are ignored', async () => {
    const { handlers, storage } = harness()
    await handlers['onboarding:saveDraft'](draft())
    await handlers['onboarding:saveProfile'](profile())
    await handlers['keys:add'](keyRequest('serpapi', SECRET))
    await handlers['onboarding:finish']()
    expect(existsSync(storage.paths.onboardingDraftFile)).toBe(false)
    expect(await handlers['onboarding:getDraft']()).toBeNull()
    await expect(handlers['onboarding:saveDraft'](draft())).resolves.toEqual({ saved: false })
    expect(existsSync(storage.paths.onboardingDraftFile)).toBe(false)
  })

  test('saveDraft refuses extra fields, so a key cannot ride along', async () => {
    const { handlers, storage } = harness()
    await expect(
      handlers['onboarding:saveDraft']({ ...draft(), secret: SECRET } as OnboardingDraft)
    ).rejects.toThrow('onboarding:saveDraft: Invalid request')
    await expect(
      handlers['onboarding:saveDraft']({
        ...draft(),
        profile: { ...draft().profile, apiKey: SECRET }
      } as OnboardingDraft)
    ).rejects.toThrow('onboarding:saveDraft: Invalid request')
    expect(existsSync(storage.paths.onboardingDraftFile)).toBe(false)
  })

  test('saveDraft refuses a bad view, a non-string field, and an oversized draft', async () => {
    const { handlers } = harness()
    const bad = [
      { ...draft(), view: 'settings' },
      { ...draft(), budget: 250 },
      { ...draft(), fill: { domain: 'x.com' } },
      { ...draft(), profile: { ...draft().profile, location: 'x'.repeat(MAX_DRAFT_BYTES) } }
    ]
    for (const value of bad) {
      await expect(handlers['onboarding:saveDraft'](value as OnboardingDraft)).rejects.toThrow(
        'onboarding:saveDraft: Invalid request'
      )
    }
  })

  test('a broken draft file reads as no draft', async () => {
    const { handlers, storage } = harness()
    writeFileSync(storage.paths.onboardingDraftFile, '{not json')
    expect(await handlers['onboarding:getDraft']()).toBeNull()
    writeFileSync(storage.paths.onboardingDraftFile, JSON.stringify({ view: 'profile' }))
    expect(await handlers['onboarding:getDraft']()).toBeNull()
  })

  test('the saved file holds only the draft fields', async () => {
    const { handlers, storage } = harness()
    await handlers['onboarding:saveDraft'](draft())
    const saved = JSON.parse(readFileSync(storage.paths.onboardingDraftFile, 'utf8')) as object
    expect(Object.keys(saved).sort()).toEqual(['budget', 'fill', 'profile', 'view'])
  })
})
