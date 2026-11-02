import { describe, expect, test } from 'vitest'
import { checkNoRepeats, competitorNamedAsOption, optionKeys } from './rules'

const TEXTBOLT = {
  switchingFrom: ['Verizon vtext.com email-to-text gateway', 'AT&T txt.att.net gateway'],
  integrations: ['Gmail', 'Outlook', 'WIN-911', 'Zapier']
}

describe('competitorNamedAsOption', () => {
  test.each([
    [
      'Is vtext or ClickSend more reliable for our plant alarms?',
      'Verizon vtext.com email-to-text gateway'
    ],
    ['Is Zapier or Textmagic better for sending staff text alerts from our forms?', 'Zapier'],
    ['ClickSend vs WIN-911 for alarm texts to night operators: which costs less?', 'WIN-911'],
    [
      'Which is more reliable for urgent alerts, txt.att.net compared to Notifyre?',
      'AT&T txt.att.net gateway'
    ]
  ])('flags a choice: %s', (text, expected) => {
    expect(competitorNamedAsOption(text, TEXTBOLT)).toBe(expected)
  })

  test.each([
    'Our Verizon vtext gateway is shutting down; is ClickSend or Textmagic better for alarm texts?',
    'We send alerts from Gmail or Outlook. Is Notifyre or Textmagic simpler for a crew of twelve?',
    'What are the best alternatives to vtext.com now that Verizon is ending it?',
    'Our WIN-911 alarms email a carrier address. Which email-to-SMS service handles that best?',
    'Is an email-to-SMS gateway or a paging app better for weekend on-call alerts?'
  ])('allows the situation: %s', (text) => {
    expect(competitorNamedAsOption(text, TEXTBOLT)).toBeNull()
  })

  test('keys are domains and their first label, capitalised names, or a short name', () => {
    expect(optionKeys('Verizon vtext.com email-to-text gateway')).toEqual([
      'vtext.com',
      'vtext',
      'Verizon'
    ])
    expect(optionKeys('AT&T txt.att.net gateway')).toEqual(['txt.att.net', 'AT&T'])
    expect(optionKeys('Microsoft Outlook')).toEqual(['Microsoft Outlook', 'Outlook'])
    expect(optionKeys('WIN-911')).toEqual(['WIN-911'])
    expect(optionKeys('A long description with no domain at all')).toEqual([])
  })
})

describe('checkNoRepeats', () => {
  const saved = ['How do I text my crew when a Saturday shift changes at the last minute?']

  test('a saved prompt with only case, a year, an article or a plural changed is a repeat', () => {
    expect(
      checkNoRepeats(
        ['how do I text my crew when the Saturday shifts change at last minute 2026'],
        saved
      )
    ).toMatch(/repeats a saved prompt/u)
    // Another word ("our") is another wording: Claude's own judgement, not a code repeat.
    expect(
      checkNoRepeats(
        ['How do I text our crew when a Saturday shift changes at the last minute?'],
        saved
      )
    ).toBeNull()
    expect(
      checkNoRepeats(
        ['HOW DO I TEXT MY CREW WHEN A SATURDAY SHIFT CHANGES AT THE LAST MINUTE (2026)'],
        saved
      )
    ).toMatch(/repeats a saved prompt/u)
  })

  test('two items of one reply that are the same question are a repeat; new ones pass', () => {
    expect(
      checkNoRepeats(
        ['What tool texts staff from Outlook?', 'What tools text staff from Outlook?'],
        []
      )
    ).toMatch(/repeats/u)
    expect(checkNoRepeats(['What tool texts staff from Outlook?', ''], saved)).toBeNull()
  })
})
