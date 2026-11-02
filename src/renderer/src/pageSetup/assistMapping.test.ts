import { describe, expect, it } from 'vitest'
import type { BuyerProfileBody } from '@shared/domain'
import {
  parseNamedReason,
  profilePartOf,
  profilePatchFromText,
  profilePatchOf,
  promptFromItem
} from './assistMapping'

const PROFILE: BuyerProfileBody = {
  who: 'IT leads',
  environment: 'Monitoring tools',
  segments: [{ name: 'MSPs', reason: 'Many clients' }],
  triggers: ['A gateway shut down'],
  values: ['No code'],
  poorFit: [{ name: 'Marketers', reason: 'Promo sends' }]
}

describe('assist mapping', () => {
  it('reads the profile part from camelCase tags and labels', () => {
    expect(profilePartOf('poorFit')).toBe('poorFit')
    expect(profilePartOf('Trigger events')).toBe('triggers')
    expect(profilePartOf('nope')).toBeNull()
    expect(profilePartOf(null)).toBeNull()
  })

  it('turns full new values into a profile update', () => {
    expect(profilePatchFromText('triggers', '- One\n\nTwo\n')).toEqual({ triggers: ['One', 'Two'] })
    expect(profilePatchFromText('segments', 'MSPs: many clients\nClinics — reminders')).toEqual({
      segments: [
        { name: 'MSPs', reason: 'many clients' },
        { name: 'Clinics', reason: 'reminders' }
      ]
    })
    expect(profilePatchFromText('who', '  Owners  ')).toEqual({ who: 'Owners' })
    expect(parseNamedReason('Only a name')).toEqual({ name: 'Only a name', reason: '' })
  })

  it('builds the undo from the previous profile', () => {
    expect(profilePatchOf(PROFILE, 'values')).toEqual({ values: ['No code'] })
    expect(profilePatchOf(PROFILE, 'poorFit')).toEqual({ poorFit: PROFILE.poorFit })
  })

  it('turns a prompts.more item into a question', () => {
    expect(
      promptFromItem({
        id: 'a',
        text: 'How do I text my crew?',
        detail: 'Source: trigger event · Maps to: Step 2 heading',
        tag: 'Problem',
        verify: null,
        sign: null
      })
    ).toEqual({
      label: 'How do I text my crew?',
      text: 'How do I text my crew?',
      source: 'trigger_event',
      intentStage: 'problem',
      mappedElement: 'Step 2 heading'
    })
    expect(
      promptFromItem({
        id: 'b',
        text: 'x',
        detail: null,
        tag: 'Evaluation',
        verify: null,
        sign: null
      })
    ).toMatchObject({ source: 'detail_check', intentStage: 'unset', mappedElement: '' })
  })
})
