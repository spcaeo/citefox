import { describe, expect, test } from 'vitest'
import type { BuyerProfile, Market } from '@shared/domain'
import { marketPromptSuffix } from './setup'

const MARKET = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false
} as unknown as Market

const PROFILE = {
  who: 'Ops leads',
  environment: 'Outlook',
  segments: [{ name: 'Clinics', reason: 'Alerts' }],
  triggers: ['Carrier gateway shut down'],
  values: ['Price'],
  poorFit: [{ name: 'Marketers', reason: 'Bulk promos' }]
} as unknown as BuyerProfile

describe('marketPromptSuffix', () => {
  test('tells Claude how a 1- or 2-prompt set picks its sources', () => {
    // Live: a page tracked with 1 prompt per page got 3 prompts back and never set up.
    expect(marketPromptSuffix(MARKET, PROFILE, null, 1)).toContain(
      'This set has only 1 prompt, so it cannot use every source. Write exactly 1 prompt, using title_meta_h1.'
    )
    expect(marketPromptSuffix(MARKET, PROFILE, null, 2)).toContain(
      'Write exactly 2 prompts, using title_meta_h1 then trigger_event.'
    )
  })

  test('leaves switch-from options and tools to the competitor block (P1)', () => {
    const suffix = marketPromptSuffix(MARKET, PROFILE, null, 5)
    expect(suffix).not.toContain('What buyers switch from')
    expect(suffix).toContain('Buyer profile:\nWho: Ops leads')
  })

  test('adds nothing for three or more prompts or when the count is not given', () => {
    const base = marketPromptSuffix(MARKET, PROFILE, null)
    expect(marketPromptSuffix(MARKET, PROFILE, null, 3)).toBe(base)
    expect(marketPromptSuffix(MARKET, PROFILE, null, 5)).toBe(base)
    expect(base).not.toContain('This set has only')
  })
})
