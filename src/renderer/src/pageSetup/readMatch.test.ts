import { describe, expect, it } from 'vitest'
import type { BuyerPrompt, CoverageMatrix } from '@shared/domain'
import { faqPromptIds, phraseMatches, phrasePromptIds, sectionPromptIds } from './readMatch'

function prompt(id: string, label: string, mappedElement: string, text = label): BuyerPrompt {
  return {
    id,
    position: Number(id.slice(1)),
    label,
    source: id === 'p3' ? 'trigger_event' : 'title_meta_h1',
    intentStage: 'problem',
    mappedElement,
    enabled: true,
    variants: [{ marketId: 'm', language: 'en', text, originalText: null }]
  }
}

const prompts = [
  prompt('p1', 'Alerts without a developer', 'intro, At a Glance, no-code FAQ'),
  prompt('p2', 'Schedule from Gmail', 'H2 · How to Schedule a Text Alert from Gmail or Outlook'),
  prompt(
    'p3',
    'txt.att.net stopped working',
    'carrier FAQ, Step 5 note',
    'My email-to-text through txt.att.net stopped working.'
  )
]

const matrix = {
  rows: [{ promptId: 'p3', whereCovered: ['Step 10 table'] }]
} as unknown as CoverageMatrix

describe('read matching', () => {
  it('matches whole words, not a prefix such as Step 1 in Step 10', () => {
    expect(phraseMatches('Step 1', 'Step 10 table')).toBe(false)
    expect(phraseMatches('Step 10', 'Step 10 table')).toBe(true)
  })

  it('finds the questions that use a heading through the mapped element or the coverage note', () => {
    expect(sectionPromptIds('At a Glance', prompts, null)).toEqual(['p1'])
    expect(
      sectionPromptIds('How to Schedule a Text Alert from Gmail or Outlook', prompts, null)
    ).toEqual(['p2'])
    expect(sectionPromptIds('Step 10', prompts, matrix)).toEqual(['p3'])
  })

  it('finds the questions an FAQ answers from the word before "FAQ"', () => {
    expect(faqPromptIds('Why did my carrier address stop working??', prompts, null)).toEqual(['p3'])
    expect(faqPromptIds('Can I set up alerts without any code?', prompts, null)).toEqual(['p1'])
    expect(faqPromptIds('Do I need 10DLC registration?', prompts, null)).toEqual([])
  })

  it('finds questions that mention a profile phrase, limited to a source when asked', () => {
    const trigger = 'Their carrier email-to-text address stopped delivering'
    expect(phrasePromptIds(trigger, prompts)).toEqual(['p3'])
    expect(phrasePromptIds(trigger, prompts, { source: 'title_meta_h1' })).toEqual([])
  })
})
