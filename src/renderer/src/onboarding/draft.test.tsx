// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FillFromWebsiteResult, OnboardingDraft, OnboardingState } from '@shared/ipc'
import {
  DRAFT_SAVE_DELAY_MS,
  restoredSetup,
  restoredSetupView,
  toOnboardingDraft,
  useDraftAutosave
} from './draft'
import { emptySetupDraft } from './setupDraft'
import { emptyProfileDraft } from './validate'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

const FRESH: OnboardingState = {
  finished: false,
  currentStep: 'profile',
  profile: null,
  steps: []
}

const FILL: FillFromWebsiteResult = {
  domain: 'example.com',
  pagesRead: [{ url: 'https://example.com/', role: 'home', ok: true }],
  brands: [{ id: 'b1', name: 'Example Co', reason: 'Named in the page title.' }],
  competitors: [
    {
      id: 'c1',
      name: 'Rival',
      domain: 'rival.example',
      domainSource: 'site',
      reason: 'Named on the compare page.',
      evidence: { path: '/compare', quote: 'Example Co vs Rival' },
      checkDomain: false
    }
  ],
  switchingFrom: [
    {
      id: 's1',
      name: 'Old Gateway',
      domain: null,
      domainSource: null,
      reason: 'It shut down.',
      evidence: { path: '/old', quote: 'Old Gateway shut down.' },
      checkDomain: false
    }
  ],
  integrations: [],
  suggestedMarket: null,
  message: 'Read example.com.',
  nextStep: null
}

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    view: 'profile',
    profile: {
      ...emptyProfileDraft(),
      userName: 'Ada',
      projectName: 'Example',
      domain: 'example.com',
      brandDraft: 'Exam',
      competitors: ['rival.example'],
      switchingFrom: ['Old Gateway']
    },
    fill: FILL,
    budget: '',
    ...overrides
  }
}

describe('restoring a draft', () => {
  it('maps an old v1 draft into the site and the lists as the user’s own rows', () => {
    const setup = restoredSetup(draft({ view: 'claude' }), FRESH)
    expect(setup.site.domain).toBe('example.com')
    expect(setup.site.userName).toBe('Ada')
    expect(setup.site.projectName).toBe('Example')
    expect(setup.lists.competitors.map((item) => [item.name, item.url, item.origin])).toEqual([
      ['rival.example', 'rival.example', 'user']
    ])
    expect(setup.lists.switchingFrom[0]?.name).toBe('Old Gateway')
    expect(setup.readDone).toBe(false)
    expect(restoredSetupView(draft({ view: 'claude' }))).toBe('site')
    expect(restoredSetupView(draft({ view: 'welcome' }))).toBe('welcome')
    expect(restoredSetupView(null)).toBe('welcome')
  })

  it('keeps a v2 draft and its step as saved', () => {
    const setup = { ...emptySetupDraft(), readDone: true }
    const saved = toOnboardingDraft('buyers', setup)
    expect(saved.setupView).toBe('buyers')
    expect(saved.setup).toBe(setup)
    // The v1 fields go out empty, so an older main still reads the draft.
    expect(saved.profile.domain).toBe('')
    expect(saved.fill).toBeNull()
    expect(restoredSetup(saved, FRESH)).toBe(setup)
    expect(restoredSetupView(saved)).toBe('buyers')
  })

  it('starts from a saved profile when there is no draft', () => {
    const profile = {
      userName: 'Ada',
      project: {
        id: 'p1',
        name: 'Example',
        slug: 'example',
        domain: 'example.com',
        dbPath: 'projects/example.sqlite',
        clientName: null,
        status: 'active'
      },
      includeSubdomains: true,
      brandNames: ['Example Co'],
      competitors: [],
      defaultMarket: {
        id: 'm1',
        country: 'US',
        language: 'en',
        location: null,
        serpapiLocation: null,
        device: 'desktop',
        localWording: false
      }
    } as unknown as NonNullable<OnboardingState['profile']>
    const setup = restoredSetup(null, { ...FRESH, profile })
    expect(setup.site).toMatchObject({ domain: 'example.com', country: 'US', language: 'en' })
    expect(setup.lists.brands.map((item) => item.name)).toEqual(['Example Co'])
  })
})

describe('useDraftAutosave', () => {
  it('saves once after typing stops, not on mount, and stop() cancels a pending save', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => Promise.resolve())
    const hook = renderHook(({ value }) => useDraftAutosave(save, value), {
      initialProps: { value: draft() }
    })
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS * 2))
    expect(save).not.toHaveBeenCalled()

    hook.rerender({ value: draft({ budget: '2' }) })
    hook.rerender({ value: draft({ budget: '25' }) })
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS - 1))
    expect(save).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith(draft({ budget: '25' }))

    hook.rerender({ value: draft({ budget: '250' }) })
    hook.result.current.stop()
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS * 2))
    hook.unmount()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flushes a pending save when the window closes', () => {
    vi.useFakeTimers()
    const save = vi.fn(() => Promise.resolve())
    const hook = renderHook(({ value }) => useDraftAutosave(save, value), {
      initialProps: { value: draft() }
    })
    hook.rerender({ value: draft({ view: 'serpapi' }) })
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(save).toHaveBeenCalledWith(draft({ view: 'serpapi' }))
    act(() => vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS * 2))
    expect(save).toHaveBeenCalledTimes(1)
  })
})
