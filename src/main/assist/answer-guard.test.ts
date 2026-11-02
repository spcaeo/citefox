import { describe, expect, it } from 'vitest'
import { isNotAnAnswer } from './answer-guard'

describe('the text answer guard', () => {
  it('turns away a reply where Claude refuses or asks', () => {
    expect(
      isNotAnAnswer(
        "I don't have reliable information about what TextBolt.com sells, and I can't open the site from here. Can you give me one line on the product?"
      )
    ).toBe(true)
    expect(isNotAnAnswer("As an AI, I can't browse.")).toBe(true)
    expect(isNotAnAnswer('Could you share the homepage?')).toBe(true)
  })

  it('keeps a plain description of the business', () => {
    expect(
      isNotAnAnswer(
        'TextBolt sells a cloud email-to-text service for US and Canada businesses. IT teams use it to send system alerts by text.'
      )
    ).toBe(false)
    expect(isNotAnAnswer('Email to text for small businesses')).toBe(false)
    expect(isNotAnAnswer('')).toBe(false)
  })
})
