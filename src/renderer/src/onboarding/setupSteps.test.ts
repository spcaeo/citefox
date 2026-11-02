import { describe, expect, it } from 'vitest'
import type { SetupRow } from '@shared/ipc'
import { emptySetupDraft } from './setupDraft'
import { itemOf } from './setupApply'
import {
  canReach,
  furthestStep,
  parseSetupHash,
  previousStep,
  siteErrors,
  stepHash,
  stepKicker,
  type SetupProgress
} from './setupSteps'

const NONE: SetupProgress = { profileSaved: false, searchReady: false }
const row = (name: string): SetupRow => ({ name, detail: '', url: null, tag: null })

describe('a new setup', () => {
  it('starts with Google AI Overview only, checked every 7 days (owner, 2026-11-01)', () => {
    expect(emptySetupDraft().search).toEqual({
      provider: 'cloro',
      engines: ['google_aio'],
      everyDays: 7
    })
  })
})

describe('setup step URLs', () => {
  it('writes and reads #/setup/<step>, ignoring the query', () => {
    expect(stepHash('read')).toBe('#/setup/read')
    expect(stepHash('welcome')).toBe('#/welcome')
    expect(parseSetupHash('#/setup/competitors?open=competitors.redo&edit=i-1')).toBe('competitors')
    expect(parseSetupHash('#/welcome')).toBe('welcome')
    expect(parseSetupHash('#/setup/profile')).toBeNull()
    expect(parseSetupHash('#/pages')).toBeNull()
    expect(previousStep('site')).toBe('welcome')
    expect(previousStep('engines')).toBe('competitors')
    expect(stepKicker('read')).toBe('Step 3 of 9')
  })
})

describe('what each step needs', () => {
  it('asks only for a website, a country and a language on step 1', () => {
    const site = emptySetupDraft().site
    expect(Object.keys(siteErrors(site))).toEqual(['domain'])
    expect(Object.keys(siteErrors({ ...site, country: '', language: '' })).sort()).toEqual([
      'country',
      'domain',
      'language'
    ])
    expect(
      siteErrors({ ...site, domain: 'https://x.com/a', country: 'US', language: 'en' })
    ).toEqual({})
    expect(
      siteErrors({
        ...site,
        domain: 'not a domain',
        country: 'other',
        countryCode: 'ZZZ',
        language: 'en'
      })
    ).toMatchObject({ domain: expect.any(String), country: expect.any(String) })
  })

  it('opens a step only when the steps before it are complete', () => {
    let draft = emptySetupDraft()
    expect(furthestStep(draft, NONE)).toBe('site')
    expect(canReach('claude', draft, NONE)).toBe(false)
    draft = {
      ...draft,
      site: { ...draft.site, domain: 'textbolt.com', country: 'US', language: 'en' }
    }
    // Claude is optional, so the read opens right after the site.
    expect(furthestStep(draft, NONE)).toBe('read')
    expect(canReach('brand', draft, NONE)).toBe(false)
    draft = { ...draft, readDone: true, summary: 'Texts from email.' }
    expect(furthestStep(draft, NONE)).toBe('brand')
    draft = { ...draft, lists: { ...draft.lists, brands: [itemOf(row('TextBolt'), 'ai')] } }
    expect(furthestStep(draft, NONE)).toBe('buyers')
    const unticked = { ...itemOf(row('Sysadmin'), 'ai'), kept: false }
    draft = { ...draft, lists: { ...draft.lists, buyers: [unticked] } }
    expect(furthestStep(draft, NONE)).toBe('buyers')
    draft = { ...draft, lists: { ...draft.lists, buyers: [{ ...unticked, kept: true }] } }
    expect(furthestStep(draft, NONE)).toBe('competitors')
    expect(furthestStep(draft, { profileSaved: true, searchReady: false })).toBe('engines')
    expect(furthestStep(draft, { profileSaved: true, searchReady: true })).toBe('shapes')
    expect(canReach('questions', draft, { profileSaved: true, searchReady: true })).toBe(false)
    // Step 8's Continue sets the mix the prompts are written to.
    draft = { ...draft, questionsMix: draft.mix }
    expect(furthestStep(draft, { profileSaved: true, searchReady: true })).toBe('questions')
  })
})
